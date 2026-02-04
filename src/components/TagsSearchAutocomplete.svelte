<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { recipeTags, type recipeTagSimple } from '$lib/consts';
  import { ndk, userPublickey } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { get } from 'svelte/store';
  import { searchProfiles, getDisplayName, type SearchProfile } from '$lib/profileSearchService';
  import { getPrimalCache } from '$lib/primalCache';

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

  function handleInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    tagquery = input.value.trim();
    const queryLower = tagquery.toLowerCase();
    
    // Clear previous timeout
    if (searchTimeout) clearTimeout(searchTimeout);
    
    if (tagquery.length === 0) {
      searchResults = { tags: [], recipes: [], users: [], note: null };
      showAutocomplete = false;
      return;
    }
    
    // Check for note identifiers (note1 or nevent1)
    if (tagquery.startsWith('note1') || tagquery.startsWith('nevent1')) {
      try {
        // Validate it's a proper nip19 identifier
        const decoded = nip19.decode(tagquery);
        if (decoded.type === 'note' || decoded.type === 'nevent') {
          searchResults.note = { id: tagquery };
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
      .filter(tag => tag.title.toLowerCase().includes(queryLower))
      .slice(0, 5);
    
    showAutocomplete = true;
    
    // Debounced relay search for recipes and users
    searchTimeout = setTimeout(async () => {
      isSearching = true;
      try {
        await Promise.all([searchRecipes(queryLower), searchUsers(queryLower)]);
      } catch (e) {
        console.debug('Search error:', e);
      } finally {
        isSearching = false;
      }
    }, 300);
  }

  async function searchRecipes(query: string) {
    try {
      const primalCache = getPrimalCache();
      
      // Try Primal Cache first (supports NIP-50 search)
      if (primalCache) {
        try {
          const primalEvents = await primalCache.fetchArticles({
            limit: 50,
          }, 5000);
          
          // Filter by title or content on client-side
          const queryLower = query.toLowerCase();
          const filtered = primalEvents.events
            .filter(event => {
              const title = event.tags.find(t => t[0] === 'title')?.[1] || '';
              const summary = event.tags.find(t => t[0] === 'summary')?.[1] || '';
              return title.toLowerCase().includes(queryLower) || 
                     summary.toLowerCase().includes(queryLower);
            })
            .slice(0, 5);
          
          searchResults.recipes = filtered.map(event => {
            const title = event.tags.find(t => t[0] === 'title')?.[1] || 'Untitled';
            const d = event.tags.find(t => t[0] === 'd')?.[1] || '';
            const naddr = nip19.naddrEncode({
              kind: 30023,
              pubkey: event.pubkey,
              identifier: d
            });
            return { title, naddr, author: event.pubkey };
          });
          
          searchResults = searchResults;
          return;
        } catch (primalError) {
          console.debug('Primal recipe search failed, falling back to direct relay search:', primalError);
        }
      }
      
      // Fallback: fetch recent recipes and filter client-side
      if (!$ndk) return;
      
      const events = await $ndk.fetchEvents({
        kinds: [30023],
        limit: 100
      });
      
      // Client-side filtering by title and summary
      const queryLower = query.toLowerCase();
      const filtered = Array.from(events)
        .filter(event => {
          const title = event.tags.find(t => t[0] === 'title')?.[1] || '';
          const summary = event.tags.find(t => t[0] === 'summary')?.[1] || '';
          return title.toLowerCase().includes(queryLower) || 
                 summary.toLowerCase().includes(queryLower);
        })
        .slice(0, 5);
      
      searchResults.recipes = filtered.map(event => {
        const title = event.tags.find(t => t[0] === 'title')?.[1] || 'Untitled';
        const d = event.tags.find(t => t[0] === 'd')?.[1] || '';
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: event.pubkey,
          identifier: d
        });
        return { title, naddr, author: event.pubkey };
      });
      
      searchResults = searchResults;
    } catch (e) {
      console.warn('Recipe search failed:', e);
    }
  }

  async function searchUsers(query: string) {
    try {
      // Use profileSearchService which leverages Primal Cache API
      const profiles = await searchProfiles(query, 5);
      
      searchResults.users = profiles.map(profile => ({
        name: getDisplayName(profile),
        npub: profile.npub,
        picture: profile.picture
      }));
      
      searchResults = searchResults;
    } catch (e) {
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
    // Initialize empty
    searchResults = { tags: [], recipes: [], users: [], note: null };
  });

  onDestroy(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
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
        autofocus={autofocus}
      />
    </div>
    <input type="submit" class="hidden" />
  </form>

  {#if showAutocomplete && (searchResults.note || searchResults.tags.length > 0 || searchResults.recipes.length > 0 || searchResults.users.length > 0 || isSearching)}
    <ul class="max-h-[320px] overflow-y-auto absolute top-full left-0 w-full bg-input border shadow-lg rounded-xl mt-1 z-[60]" style="border-color: var(--color-input-border); color: var(--color-text-primary);">

      {#if searchResults.note}
        <li class="px-3 py-1.5 text-xs font-semibold text-caption bg-accent-gray border-b" style="border-color: var(--color-input-border)">📝 Note</li>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <li
          on:click={() => selectNote(searchResults.note?.id || '')}
          class="cursor-pointer px-3 py-2 hover:bg-accent-gray"
        >
          <span class="text-sm">View note: </span>
          <span class="text-xs text-caption font-mono">{searchResults.note.id.slice(0, 24)}...</span>
        </li>
      {/if}

      {#if searchResults.tags.length > 0}
        <li class="px-3 py-1.5 text-xs font-semibold text-caption bg-accent-gray border-b" style="border-color: var(--color-input-border)">🏷️ Tags</li>
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
        <li class="px-3 py-1.5 text-xs font-semibold text-caption bg-accent-gray border-b border-t" style="border-color: var(--color-input-border)">📖 Recipes</li>
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
        <li class="px-3 py-1.5 text-xs font-semibold text-caption bg-accent-gray border-b border-t" style="border-color: var(--color-input-border)">👤 Users</li>
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

      {#if isSearching}
        <li class="px-3 py-2 text-sm text-caption text-center">Searching...</li>
      {/if}

      {#if !isSearching && !searchResults.note && searchResults.tags.length === 0 && searchResults.recipes.length === 0 && searchResults.users.length === 0 && tagquery.length > 0}
        <li class="px-3 py-2 text-sm text-caption text-center">No results found</li>
      {/if}
    </ul>
  {/if}
</div>
