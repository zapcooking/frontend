<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { recipeTags, type recipeTagSimple, RECIPE_TAGS } from '$lib/consts';
  import { ndk, userPublickey } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { get } from 'svelte/store';
  import { searchProfiles, getDisplayName, type SearchProfile } from '$lib/profileSearchService';
  import { feedCacheService } from '$lib/feedCache';

  export let placeholderString: string;
  export let autofocus = false;
  export let action: (query: string) => void;

  let tagquery = '';
  let showAutocomplete = false;
  let inputFocused = false;

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

  // Recipe cache for fast client-side search
  let recipeCache: Array<{ title: string; summary: string; naddr: string; author: string }> = [];
  let recipeCacheLoaded = false;
  let recipeCacheLoading = false;
  let recipeSubscription: any = null;

  function handleInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    tagquery = input.value;

    const rawQuery = tagquery.trim();
    const normalizedQuery = rawQuery.toLowerCase();

    // Clear previous timeout
    if (searchTimeout) clearTimeout(searchTimeout);

    // If query is empty or only whitespace, reset state
    if (normalizedQuery.length === 0) {
      searchResults = { tags: [], recipes: [], users: [], note: null };
      showAutocomplete = false;
      return;
    }

    // Check for note identifiers (note1 or nevent1)
    if (normalizedQuery.startsWith('note1') || normalizedQuery.startsWith('nevent1')) {
      try {
        // Validate it's a proper nip19 identifier - use rawQuery for decoding
        const decoded = nip19.decode(rawQuery);
        if (decoded.type === 'note' || decoded.type === 'nevent') {
          searchResults.note = { id: rawQuery };
          searchResults.tags = [];
          searchResults.recipes = [];
          searchResults.users = [];
          showAutocomplete = true;
          return;
        }
      } catch {
        // Invalid identifier, continue with normal search
      }
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

    // Debounced user search (API call)
    searchTimeout = setTimeout(async () => {
      isSearching = true;
      try {
        await searchUsers(normalizedQuery);
      } catch (e) {
        console.debug('Search error:', e);
      } finally {
        isSearching = false;
      }
    }, 300);
  }

  // Load recipes progressively using subscription (like /recent page)
  async function preloadRecipes() {
    if (recipeCacheLoading || recipeCacheLoaded) {
      return;
    }

    recipeCacheLoading = true;

    try {
      // Try to get cached recipes from IndexedDB (same cache as /recent page)
      const cacheFilter = { kinds: [30023], '#t': RECIPE_TAGS };
      const cachedEvents = await feedCacheService.getCachedFeed({
        filter: cacheFilter,
        backgroundRefresh: false
      });

      if (cachedEvents && cachedEvents.length > 0) {
        const map = new Map<string, (typeof recipeCache)[0]>();
        for (const event of cachedEvents) {
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
  });
</script>

<div class="relative flex-1 print:hidden">
  <form
    class="flex rounded-xl shadow-sm bg-input"
    on:submit|preventDefault={() => {
      if (tagquery) {
        // If it's a note identifier, navigate directly
        if (searchResults.note) {
          selectNote(searchResults.note.id);
          return;
        }

        // Select first result from search results (priority: recipes > users > tags)
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
        action(tagquery);
        tagquery = '';
        searchResults = { tags: [], recipes: [], users: [], note: null };
      }
    }}
  >
    <div class="flex mx-0.5 items-stretch flex-grow focus-within:z-10">
      <input
        bind:value={tagquery}
        on:input={handleInputChange}
        on:focus={handleInputFocus}
        on:blur={handleInputBlur}
        class="block w-full input"
        placeholder={placeholderString}
        {autofocus}
      />
    </div>
    <input type="submit" class="hidden" />
  </form>

  {#if showAutocomplete && (searchResults.note || searchResults.tags.length > 0 || searchResults.recipes.length > 0 || searchResults.users.length > 0 || isSearching)}
    <ul
      class="max-h-[320px] overflow-y-auto absolute top-full left-0 w-full bg-input border shadow-lg rounded-xl mt-1 z-[60]"
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
          📖 Recipes
        </li>
        {#each searchResults.recipes as recipe (recipe.naddr)}
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

      {#if searchResults.users.length > 0}
        <li
          class="px-3 py-1.5 text-xs font-semibold text-caption bg-accent-gray border-b border-t"
          style="border-color: var(--color-input-border)"
        >
          👤 Users
        </li>
        {#each searchResults.users as user (user.npub)}
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
