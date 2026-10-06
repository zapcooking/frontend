<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { recipeTags, type recipeTagSimple, RECIPE_TAGS, isHiddenRecipeEvent } from '$lib/consts';
  import { ndk, userPublickey } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import { NDKRelaySet, type NDKEvent } from '@nostr-dev-kit/ndk';
  import { get } from 'svelte/store';
  import { searchProfiles, getDisplayName, type SearchProfile } from '$lib/profileSearchService';
  import { isHumanReadablePostContent, postSnippet } from '$lib/postContentReadability';
  import { parseNip19Input, isSecretKeyInput } from '$lib/nip19Input';
  import { feedCacheService } from '$lib/feedCache';
  import { isBlockedFromReads } from '$lib/reads/moderationClient';

  export let placeholderString: string;
  export let autofocus = false;
  export let action: (query: string) => void;
  // Global search bars pass this so submitting a keyword opens the results
  // feed. Tag pickers leave it unset and keep picking the first match.
  export let onSubmitQuery: ((query: string) => void) | null = null;

  let tagquery = '';
  let showAutocomplete = false;
  let inputFocused = false;

  let inputEl: HTMLInputElement;

  // Auto-focus on mount for mobile overlays where HTML autofocus is unreliable
  $: if (autofocus && inputEl) {
    inputEl.focus();
  }

  // Multi-type search state
  let searchResults: {
    tags: recipeTagSimple[];
    recipes: { title: string; naddr: string; author: string }[];
    users: { name: string; npub: string; picture?: string }[];
    note: { id: string; preview?: string } | null;
  } = { tags: [], recipes: [], users: [], note: null };
  let isSearching = false;
  let searchTimeout: ReturnType<typeof setTimeout>;

  // Prevent stale user search results
  let userSearchVersion = 0;

  // NIP-50 full-text search relays. Both index kind-1 posts; results are
  // fanned in from both and deduped, so one being slow or down doesn't
  // blank the Posts section (verified answering {kinds:[1], search} REQs).
  const NIP50_SEARCH_RELAYS = ['wss://search.nos.today', 'wss://search.nostrarchives.com'];
  let networkSearchSub: any = null;
  let networkSearchVersion = 0;
  let networkSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  // Subscriptions still open for the current query — keeps "No results
  // found" from flashing while post results stream in.

  // Recipe cache for fast client-side search
  let recipeCache: Array<{ title: string; summary: string; naddr: string; author: string }> = [];
  let recipeCacheLoaded = false;
  let recipeCacheLoading = false;
  let recipeSubscription: any = null;

  function handleInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    tagquery = input.value;
    runSearchFor(tagquery.trim());
  }

  // The search pipeline, callable directly — the Nostr Archives consent
  // ask re-runs it after a decision without a synthetic input event.
  function runSearchFor(rawQuery: string) {
    const normalizedQuery = rawQuery.toLowerCase();

    // Clear previous timeout
    if (searchTimeout) clearTimeout(searchTimeout);

    // If query is empty or only whitespace, reset state
    if (normalizedQuery.length === 0) {
      searchResults = { tags: [], recipes: [], users: [], note: null };
      showAutocomplete = false;
      cancelNetworkSearch();
      return;
    }

    // A mis-pasted secret key must not become a relay query: NIP-50 sends
    // the term verbatim, so one keystroke of bad luck would publish it.
    if (isSecretKeyInput(rawQuery)) {
      searchResults = { tags: [], recipes: [], users: [], note: null };
      showAutocomplete = false;
      cancelNetworkSearch();
      return;
    }

    // NIP-19 identifiers, with or without NIP-21's `nostr:` scheme — which
    // is the form every client's copy button produces, so it is what people
    // actually paste.
    const target = parseNip19Input(rawQuery);
    if (target) {
      searchResults.tags = [];
      searchResults.recipes = [];
      searchResults.users = [];
      if (target.kind === 'note') {
        searchResults.note = { id: target.id };
        showAutocomplete = true;
        return;
      }
      // Profiles and addresses have no row of their own in this dropdown;
      // submitting navigates, which `action` below already handles.
      searchResults.note = null;
      showAutocomplete = false;
      cancelNetworkSearch();
      return;
    }

    // Clear note result if not a note identifier
    searchResults.note = null;

    // Immediate tag search (client-side)
    searchResults.tags = recipeTags
      .filter((tag) => tag.title.toLowerCase().includes(normalizedQuery))
      .slice(0, 5);

    showAutocomplete = true;

    // Immediate recipe search (client-side cache)
    searchRecipes(normalizedQuery);

    // Debounced network searches (user API + NIP-50 relays)
    searchTimeout = setTimeout(async () => {
      isSearching = true;
      try {
        // NIP-50 searches fire and stream results independently
        searchNetworkRecipes(normalizedQuery);
        await searchUsers(normalizedQuery);
      } catch (e) {
        console.debug('Search error:', e);
      } finally {
        isSearching = false;
      }
    }, 300);
  }

  // Load recipes progressively using subscription (like /recipes page)
  async function preloadRecipes() {
    if (recipeCacheLoading || recipeCacheLoaded) {
      return;
    }

    recipeCacheLoading = true;

    try {
      // Try to get cached recipes from IndexedDB (same cache as /recipes page)
      const cacheFilter = { kinds: [30023], '#t': RECIPE_TAGS };
      const cachedEvents = await feedCacheService.getCachedFeed({
        filter: cacheFilter,
        backgroundRefresh: false
      });

      if (cachedEvents && cachedEvents.length > 0) {
        const map = new Map<string, (typeof recipeCache)[0]>();
        for (const event of cachedEvents) {
          if (isHiddenRecipeEvent(event) || isBlockedFromReads(event)) continue;
          const title = event.tags.find((t) => t[0] === 'title')?.[1] || 'Untitled';
          const summary = event.tags.find((t) => t[0] === 'summary')?.[1] || '';
          const d = event.tags.find((t) => t[0] === 'd')?.[1] || '';
          const naddr = nip19.naddrEncode({
            kind: 30023,
            pubkey: event.pubkey,
            identifier: d
          });
          if (!map.has(naddr)) {
            map.set(naddr, { title, summary, naddr, author: event.pubkey });
          }
        }
        recipeCache = Array.from(map.values());

        recipeCacheLoaded = true;
        recipeCacheLoading = false;
        return;
      }

      // Fallback: subscribe to recipes (progressive loading)
      if (!$ndk) {
        recipeCacheLoading = false;
        setTimeout(() => preloadRecipes(), 1000);
        return;
      }

      recipeSubscription = $ndk.subscribe({
        kinds: [30023],
        '#t': RECIPE_TAGS,
        limit: 100
      });

      const tempMap = new Map<string, (typeof recipeCache)[0]>();

      recipeSubscription.on('event', (event: any) => {
        if (isHiddenRecipeEvent(event) || isBlockedFromReads(event)) return;
        const title = event.tags.find((t: any) => t[0] === 'title')?.[1] || 'Untitled';
        const summary = event.tags.find((t: any) => t[0] === 'summary')?.[1] || '';
        const d = event.tags.find((t: any) => t[0] === 'd')?.[1] || '';
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: event.pubkey,
          identifier: d
        });

        if (!tempMap.has(naddr)) {
          tempMap.set(naddr, { title, summary, naddr, author: event.pubkey });
        }

        // Update cache progressively every 10 recipes
        if (tempMap.size % 10 === 0) {
          recipeCache = Array.from(tempMap.values());

          // Mark as loaded after first batch
          if (!recipeCacheLoaded && tempMap.size >= 10) {
            recipeCacheLoaded = true;
          }
        }
      });

      recipeSubscription.on('eose', () => {
        recipeCache = Array.from(tempMap.values());
        recipeCacheLoaded = true;
        recipeCacheLoading = false;
      });

      // Timeout fallback - mark as loaded after 15s even if subscription hasn't completed
      setTimeout(() => {
        if (!recipeCacheLoaded && tempMap.size > 0) {
          recipeCache = Array.from(tempMap.values());
          recipeCacheLoaded = true;
          recipeCacheLoading = false;
        } else if (tempMap.size === 0) {
          recipeCacheLoaded = true;
          recipeCacheLoading = false;
        }
      }, 15000);
    } catch (e) {
      console.error('[RecipeSearch] Failed to load recipes:', e);
      recipeCacheLoaded = true;
      recipeCacheLoading = false;
    }
  }

  function searchRecipes(query: string) {
    // If recipes not loaded yet, return empty
    if (!recipeCacheLoaded || recipeCache.length === 0) {
      searchResults.recipes = [];
      searchResults = searchResults;
      return;
    }

    // Token-based search: all words must appear in title or summary
    const queryLower = query.toLowerCase();
    const tokens = queryLower.split(/\s+/).filter(Boolean);

    const filtered = recipeCache
      .filter((recipe) => {
        const haystack = `${recipe.title.toLowerCase()} ${recipe.summary.toLowerCase()}`;
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 5);

    searchResults.recipes = filtered.map((recipe) => ({
      title: recipe.title,
      naddr: recipe.naddr,
      author: recipe.author
    }));

    searchResults = searchResults;
  }

  async function searchUsers(query: string) {
    const thisVersion = ++userSearchVersion;
    try {
      // Use profileSearchService which leverages Primal Cache API
      const profiles = await searchProfiles(query, 5);

      // If another search started after this one, discard stale results
      if (thisVersion !== userSearchVersion) return;

      searchResults.users = profiles.map((profile) => ({
        name: getDisplayName(profile),
        npub: profile.npub,
        picture: profile.picture
      }));

      searchResults = searchResults;
    } catch (e) {
      // If request was superseded, don't overwrite
      if (thisVersion !== userSearchVersion) return;
      console.warn('User search failed:', e);
      searchResults.users = [];
      searchResults = searchResults;
    }
  }

  function handleInputFocus() {
    inputFocused = true;
    showAutocomplete = tagquery.length > 0;
  }

  function handleInputBlur() {
    inputFocused = false;
    // Delay to allow click events to propagate
    setTimeout(() => {
      showAutocomplete = false;
    }, 200);
  }

  function selectTag(title: string) {
    action(title);
    tagquery = '';
    searchResults = { tags: [], recipes: [], users: [], note: null };
    showAutocomplete = false;
  }

  function selectRecipe(naddr: string) {
    // Navigate to recipe
    window.location.href = `/recipe/${naddr}`;
    tagquery = '';
    searchResults = { tags: [], recipes: [], users: [], note: null };
    showAutocomplete = false;
  }

  function selectUser(npub: string) {
    // Navigate to user profile
    window.location.href = `/user/${npub}`;
    tagquery = '';
    searchResults = { tags: [], recipes: [], users: [], note: null };
    showAutocomplete = false;
  }

  function selectNote(noteId: string) {
    // Navigate to note
    window.location.href = `/${noteId}`;
    tagquery = '';
    searchResults = { tags: [], recipes: [], users: [], note: null };
    showAutocomplete = false;
  }

  function selectPost(postId: string) {
    // Navigate to the note thread page
    window.location.href = `/${nip19.noteEncode(postId)}`;
    tagquery = '';
    searchResults = { tags: [], recipes: [], users: [], note: null };
    showAutocomplete = false;
  }

  function cancelNetworkSearch() {
    if (networkSearchSub) {
      try { networkSearchSub.stop(); } catch { /* ignore */ }
      networkSearchSub = null;
    }
    if (networkSearchTimeout) {
      clearTimeout(networkSearchTimeout);
      networkSearchTimeout = null;
    }
  }

  async function searchNetworkRecipes(query: string) {
    const thisVersion = ++networkSearchVersion;
    cancelNetworkSearch();

    const ndkInstance = get(ndk);
    if (!ndkInstance) return;

    // Pre-connect so the first REQ doesn't miss the relays
    await Promise.all(
      NIP50_SEARCH_RELAYS.map(async (url) => {
        try {
          const relay = ndkInstance.pool.getRelay(url, true, true);
          if (relay.connectivity?.status !== 1) await relay.connect();
        } catch { /* non-fatal */ }
      })
    );

    if (thisVersion !== networkSearchVersion) return;

    const relaySet = NDKRelaySet.fromRelayUrls(NIP50_SEARCH_RELAYS, ndkInstance, false);
    const sub = ndkInstance.subscribe(
      // #t constrains the search to actual recipes at the source — a bare
      // kinds:[30023] + search matches ANY longform article (fiction,
      // spam) containing the query, which is what filled the section with
      // non-recipes.
      { kinds: [30023], search: query, limit: 50, '#t': RECIPE_TAGS },
      { closeOnEose: true },
      relaySet
    );
    networkSearchSub = sub;

      sub.on('event', (event: NDKEvent) => {
      if (thisVersion !== networkSearchVersion) return;
      const d = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
      if (!d) return;
      // Title-less long-form still searches; show the d-tag like the
      // article pages do.
      const title = event.tags.find((t: string[]) => t[0] === 'title')?.[1] || d;
      if (isHiddenRecipeEvent(event) || isBlockedFromReads(event)) return;
      // Not every search relay honors #t alongside search — re-check
      // here so untagged longform can't slip through as a recipe.
      const hasRecipeTag = event.tags.some(
        (t: string[]) => t[0] === 't' && RECIPE_TAGS.includes(t[1]?.toLowerCase() || '')
      );
      if (!hasRecipeTag) return;

      const naddr = nip19.naddrEncode({ kind: 30023, pubkey: event.pubkey, identifier: d });
      if (searchResults.recipes.some((r) => r.naddr === naddr)) return;

      searchResults.recipes = [...searchResults.recipes, { title, naddr, author: event.pubkey }].slice(0, 8);
      searchResults = searchResults;
    });

    const cleanup = () => {
      if (networkSearchTimeout) { clearTimeout(networkSearchTimeout); networkSearchTimeout = null; }
      if (networkSearchSub === sub) networkSearchSub = null;
    };

    sub.on('eose', cleanup);

    // Hard 5s timeout — matches Android app behaviour
    networkSearchTimeout = setTimeout(() => {
      cleanup();
      try { sub.stop(); } catch { /* ignore */ }
    }, 5000);
  }

  onMount(() => {
    // Initialize empty search results
    searchResults = { tags: [], recipes: [], users: [], note: null };

    // Preload recipes in background for fast search
    preloadRecipes();
  });

  onDestroy(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (recipeSubscription) {
      recipeSubscription.stop();
      recipeSubscription = null;
    }
    cancelNetworkSearch();
  });
</script>

<div class="relative flex-1 print:hidden">
  <form
    class="flex"
    on:submit|preventDefault={() => {
      if (tagquery.trim()) {
        // If it's a note identifier, navigate directly
        if (searchResults.note) {
          selectNote(searchResults.note.id);
          return;
        }

        // In a search bar, the dropdown's pick-list is for jumping to one
        // specific thing — submitting the query means "show me posts about
        // this", so hand it to the results feed.
        if (onSubmitQuery) {
          const q = tagquery.trim();
          tagquery = '';
          searchResults = { tags: [], recipes: [], users: [], note: null };
          showAutocomplete = false;
          onSubmitQuery(q);
          return;
        }

        // Tag pickers: select first result (priority: recipes > users > tags)
        if (searchResults.recipes.length > 0) {
          selectRecipe(searchResults.recipes[0].naddr);
          return;
        }

        if (searchResults.users.length > 0) {
          selectUser(searchResults.users[0].npub);
          return;
        }

        if (searchResults.tags.length > 0) {
          selectTag(searchResults.tags[0].title);
          return;
        }

        // Fallback: treat as tag search if no results
        action(tagquery.trim());
        tagquery = '';
        searchResults = { tags: [], recipes: [], users: [], note: null };
      }
    }}
  >
    <div class="flex mx-0.5 items-stretch flex-grow focus-within:z-10">
      <input
        bind:this={inputEl}
        bind:value={tagquery}
        on:input={handleInputChange}
        on:focus={handleInputFocus}
        on:blur={handleInputBlur}
        class="block w-full input"
        placeholder={placeholderString}
      />
    </div>
    <input type="submit" class="hidden" />
  </form>

  {#if showAutocomplete && (searchResults.note || searchResults.tags.length > 0 || searchResults.recipes.length > 0 || searchResults.users.length > 0 || isSearching)}
    <!--
      Section order: Users and Tags first. Typing a name is a people
      lookup first; post full-text matches buried the user rows — and on
      mobile, an iOS Safari bug (backdrop-filter on the header ancestor
      breaks touch scrolling inside this dropdown) made anything below
      the fold unreachable. Rows are capped so the priority sections fit
      without scrolling.
    -->
    <ul
      class="search-ac-list max-h-[320px] overflow-y-auto absolute top-full left-0 w-full bg-input border shadow-lg rounded-xl mt-1 z-[60]"
      style="border-color: var(--color-input-border); color: var(--color-text-primary);"
    >
      {#if searchResults.note}
        <li
          class="px-3 py-1.5 text-xs font-semibold text-caption bg-accent-gray border-b"
          style="border-color: var(--color-input-border)"
        >
          📝 Note
        </li>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <li
          on:click={() => selectNote(searchResults.note?.id || '')}
          class="cursor-pointer px-3 py-2 hover:bg-accent-gray"
        >
          <span class="text-sm">View note: </span>
          <span class="text-xs text-caption font-mono">{searchResults.note.id.slice(0, 24)}...</span
          >
        </li>
      {/if}

      {#if searchResults.users.length > 0}
        <li
          class="px-3 py-1.5 text-xs font-semibold text-caption bg-accent-gray border-b"
          style="border-color: var(--color-input-border)"
        >
          👤 Users
        </li>
        {#each searchResults.users.slice(0, 5) as user (user.npub)}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <li
            on:click={() => selectUser(user.npub)}
            class="cursor-pointer px-3 py-2 hover:bg-accent-gray flex items-center gap-2"
          >
            {#if user.picture}
              <img src={user.picture} alt="" class="w-6 h-6 rounded-full object-cover" />
            {/if}
            {user.name}
          </li>
        {/each}
      {/if}

      {#if searchResults.tags.length > 0}
        <li
          class="px-3 py-1.5 text-xs font-semibold text-caption bg-accent-gray border-b"
          style="border-color: var(--color-input-border)"
        >
          🏷️ Tags
        </li>
        {#each searchResults.tags as tag (tag.title)}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <li
            on:click={() => selectTag(tag.title)}
            class="cursor-pointer px-3 py-2 hover:bg-accent-gray"
          >
            {#if tag.emoji}<span>{tag.emoji} </span>{/if}
            {tag.title}
          </li>
        {/each}
      {/if}

      {#if searchResults.recipes.length > 0}
        <li
          class="px-3 py-1.5 text-xs font-semibold text-caption bg-accent-gray border-b border-t"
          style="border-color: var(--color-input-border)"
        >
          🍳 Recipes
        </li>
        {#each searchResults.recipes.slice(0, 3) as recipe (recipe.naddr)}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <li
            on:click={() => selectRecipe(recipe.naddr)}
            class="cursor-pointer px-3 py-2 hover:bg-accent-gray"
          >
            {recipe.title}
          </li>
        {/each}
      {/if}

      {#if recipeCacheLoading}
        <li class="px-3 py-2 text-sm text-caption text-center">⏳ Loading recipes for search...</li>
      {/if}

      {#if isSearching}
        <li class="px-3 py-2 text-sm text-caption text-center">Searching...</li>
      {/if}

      {#if !recipeCacheLoading && !isSearching && !searchResults.note && searchResults.tags.length === 0 && searchResults.recipes.length === 0 && searchResults.users.length === 0 && tagquery.length > 0}
        <li class="px-3 py-2 text-sm text-caption text-center">
          {#if !recipeCacheLoaded}
            ⏳ Loading recipes...
          {:else}
            No results found
          {/if}
        </li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  /* Touch scrolling inside this dropdown is dead on iOS Safari: the
     header ancestor carries backdrop-filter, which breaks touch scrolling
     for positioned descendants. These properties restore the pan gesture;
     the row caps above keep the priority sections fitting without needing
     it at all. */
  .search-ac-list {
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    touch-action: pan-y;
  }
</style>
