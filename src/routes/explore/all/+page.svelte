<script lang="ts">
  import { recipeTags, type recipeTagSimple } from '$lib/consts';
  import { filterTags, normalizeTag } from '$lib/tagUtils';
  import { goto } from '$app/navigation';

  let searchQuery = '';
  let filteredResults: recipeTagSimple[] = [];
  let filteredAutocomplete: recipeTagSimple[] = [];
  let showAutocomplete = false;
  let inputFocused = false;

  // Group tags by first letter
  const tagsByLetter = new Map<string, recipeTagSimple[]>();
  
  // Initialize grouped tags
  recipeTags.forEach((tag) => {
    const firstLetter = tag.title.charAt(0).toUpperCase();
    if (!tagsByLetter.has(firstLetter)) {
      tagsByLetter.set(firstLetter, []);
    }
    tagsByLetter.get(firstLetter)!.push(tag);
  });

  // Sort letters
  const letters = Array.from(tagsByLetter.keys()).sort();
  
  // Sort tags within each letter
  letters.forEach((letter) => {
    tagsByLetter.get(letter)!.sort((a, b) => a.title.localeCompare(b.title));
  });

  $: {
    if (searchQuery.trim() === '') {
      filteredResults = [];
      filteredAutocomplete = [];
      showAutocomplete = false;
    } else {
      filteredResults = filterTags(searchQuery);
      filteredAutocomplete = filterTags(searchQuery).slice(0, 7);
      showAutocomplete = inputFocused && filteredAutocomplete.length > 0;
    }
  }

  function handleInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    searchQuery = input.value;
  }

  function handleInputFocus() {
    inputFocused = true;
    if (searchQuery.trim()) {
      showAutocomplete = true;
    }
  }

  function handleInputBlur() {
    inputFocused = false;
    setTimeout(() => {
      showAutocomplete = false;
    }, 200);
  }

  function handleTagSelect(tag: recipeTagSimple) {
    navigateToTag(tag);
    searchQuery = '';
  }

  function handleTagSearch() {
    if (searchQuery.trim()) {
      const normalized = normalizeTag(searchQuery);
      const tag = recipeTags.find(
        (t) => normalizeTag(t.title).toLowerCase() === normalized.toLowerCase()
      );
      if (tag) {
        goto(`/tag/${tag.title}`);
      } else {
        goto(`/tag/${searchQuery}`);
      }
      searchQuery = '';
    }
  }

  function navigateToTag(tag: recipeTagSimple) {
    goto(`/tag/${tag.title}`);
  }
</script>

<svelte:head>
  <title>All Tags - zap.cooking</title>
  <meta name="description" content="Browse all recipe tags on zap.cooking" />
  <meta property="og:url" content="https://zap.cooking/explore/all" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="All Tags - zap.cooking" />
  <meta property="og:description" content="Browse all recipe tags on zap.cooking" />
  <meta property="og:image" content="https://zap.cooking/logo_with_text.png" />

  <meta name="twitter:card" content="summary" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content="https://zap.cooking/explore/all" />
  <meta name="twitter:title" content="All Tags - zap.cooking" />
  <meta name="twitter:description" content="Browse all recipe tags on zap.cooking" />
  <meta property="twitter:image" content="https://zap.cooking/logo_with_text.png" />
</svelte:head>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-3xl font-bold">All Tags</h1>
      <a href="/explore" class="text-primary hover:underline">← Back to Explore</a>
    </div>
    
    <!-- Search -->
    <div class="relative w-full">
      <form
        class="flex rounded-xl shadow-sm bg-input"
        on:submit|preventDefault={handleTagSearch}
      >
        <div class="flex mx-0.5 items-stretch flex-grow focus-within:z-10">
          <input
            bind:value={searchQuery}
            on:input={handleInputChange}
            on:focus={handleInputFocus}
            on:blur={handleInputBlur}
            class="block w-full input"
            placeholder="Search tags…"
          />
        </div>
        <input type="submit" class="hidden" />
      </form>
      {#if showAutocomplete && filteredAutocomplete.length > 0}
        <ul
          class="max-h-[256px] overflow-y-scroll absolute top-full left-0 w-full bg-white border border-gray-300 shadow-lg rounded-xl mt-1 z-[60]"
        >
          {#each filteredAutocomplete as tag (tag.title)}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
            <li
              on:click={() => handleTagSelect(tag)}
              class="cursor-pointer p-2 hover:bg-gray-100"
            >
              {#if tag.emoji}
                <span>{tag.emoji} </span>
              {/if}
              {tag.title}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>

  <!-- Search Results -->
  {#if searchQuery.trim() !== ''}
    <div class="flex flex-col gap-4">
      <h2 class="text-xl font-semibold">
        Results ({filteredResults.length})
      </h2>
      {#if filteredResults.length > 0}
        <div class="flex flex-wrap gap-2">
          {#each filteredResults as tag}
            <button
              on:click={() => navigateToTag(tag)}
              class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-input hover:bg-accent-gray transition duration-300 text-sm font-medium cursor-pointer"
            >
              {#if tag.emoji}
                <span class="text-base">{tag.emoji}</span>
              {/if}
              <span>{tag.title}</span>
            </button>
          {/each}
        </div>
      {:else}
        <p class="text-gray-600">No tags found matching "{searchQuery}"</p>
      {/if}
    </div>
  {:else}
    <!-- A-Z Listing -->
    <div class="flex flex-col gap-6">
      {#each letters as letter}
        <div class="flex flex-col gap-3">
          <h2 class="text-2xl font-bold border-b pb-2">{letter}</h2>
          <div class="flex flex-wrap gap-2">
            {#each tagsByLetter.get(letter) || [] as tag}
              <button
                on:click={() => navigateToTag(tag)}
                class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-input hover:bg-accent-gray transition duration-300 text-sm font-medium cursor-pointer"
              >
                {#if tag.emoji}
                  <span class="text-base">{tag.emoji}</span>
                {/if}
                <span>{tag.title}</span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Ensure proper spacing and mobile-first design */
  @media (max-width: 640px) {
    button {
      min-height: 44px; /* Mobile tap target */
    }
  }
</style>

