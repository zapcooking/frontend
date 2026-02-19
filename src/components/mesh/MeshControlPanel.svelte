<script lang="ts">
  import type { MeshVisualTheme } from '$lib/mesh/meshTypes';
  import { meshVisualTheme, meshLayers, meshFilters } from '$lib/mesh/meshStore';
  import { CURATED_TAG_SECTIONS } from '$lib/consts';
  import { theme } from '$lib/themeStore';

  export let recipeCount: number = 0;
  export let tagCount: number = 0;
  export let connectionCount: number = 0;
  export let loading: boolean = false;
  export let hasError: boolean = false;

  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';
  $: visualTheme = $meshVisualTheme;
  $: layers = $meshLayers;
  $: filters = $meshFilters;
  $: isConstellation = visualTheme === 'constellation';

  let searchValue = '';
  let showFilters = false;

  // Get cuisine tags from curated sections
  $: cuisineTags = CURATED_TAG_SECTIONS.find((s) => s.title === 'Explore by culture')?.tags || [];
  $: dietaryTags = CURATED_TAG_SECTIONS.find((s) => s.title === 'Dietary')?.tags || [];

  function handleSearch() {
    meshFilters.update((f) => ({ ...f, search: searchValue }));
  }

  function clearSearch() {
    searchValue = '';
    meshFilters.update((f) => ({ ...f, search: '' }));
  }

  function toggleLayer(layer: 'recipes' | 'tags' | 'chefs') {
    meshLayers.update((l) => ({ ...l, [layer]: !l[layer] }));
  }

  function toggleTheme() {
    meshVisualTheme.update((t) => t === 'default' ? 'constellation' : 'default');
  }

  function toggleCuisineFilter(tag: string) {
    meshFilters.update((f) => {
      const cuisine = f.cuisine.includes(tag)
        ? f.cuisine.filter((c) => c !== tag)
        : [...f.cuisine, tag];
      return { ...f, cuisine };
    });
  }

  function clearAllFilters() {
    searchValue = '';
    meshFilters.set({
      search: '',
      cuisine: [],
      ingredient: [],
      difficulty: [],
      time: [],
      dietary: [],
      lightningGated: null,
      membershipTier: null,
      creator: null
    });
  }

  $: hasActiveFilters = filters.search !== '' ||
    filters.cuisine.length > 0 ||
    filters.ingredient.length > 0 ||
    filters.dietary.length > 0 ||
    filters.lightningGated !== null ||
    filters.membershipTier !== null ||
    filters.creator !== null;
</script>

<div class="mesh-control-panel" class:constellation={isConstellation}>
  <!-- Header row -->
  <div class="panel-header">
    <div class="panel-title">
      <h1 class="text-lg font-bold" style="color: {isConstellation ? 'rgba(220, 230, 255, 0.9)' : 'var(--color-text-primary)'};">
        {isConstellation ? 'Star Map' : 'Culinary Mesh'}
      </h1>
      {#if !loading && !hasError}
        <p class="text-xs" style="color: {isConstellation ? 'rgba(180, 200, 240, 0.5)' : 'var(--color-caption)'};">
          {recipeCount} recipes &middot; {tagCount} tags &middot; {connectionCount} connections
        </p>
      {/if}
    </div>

    <div class="panel-actions">
      <!-- Theme toggle -->
      <button
        class="theme-toggle"
        class:active={isConstellation}
        on:click={toggleTheme}
        aria-label="Toggle constellation theme"
        title={isConstellation ? 'Default view' : 'Constellation view'}
      >
        {isConstellation ? '&#9728;' : '&#9733;'}
      </button>

      <!-- Filter toggle -->
      <button
        class="filter-toggle"
        class:active={showFilters || hasActiveFilters}
        on:click={() => showFilters = !showFilters}
        aria-label="Toggle filters"
        aria-expanded={showFilters}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 2h14l-5 6v5l-4 2V8L1 2z"/>
        </svg>
        {#if hasActiveFilters}
          <span class="filter-badge"></span>
        {/if}
      </button>
    </div>
  </div>

  <!-- Expandable filter area -->
  {#if showFilters}
    <div class="panel-filters">
      <!-- Search -->
      <div class="filter-row">
        <input
          type="text"
          placeholder="Search recipes & tags..."
          bind:value={searchValue}
          on:input={handleSearch}
          class="search-input"
          style="background-color: {isConstellation ? 'rgba(180, 200, 240, 0.08)' : 'var(--color-input-bg)'}; color: {isConstellation ? 'rgba(220, 230, 255, 0.9)' : 'var(--color-text-primary)'}; border-color: {isConstellation ? 'rgba(180, 200, 240, 0.2)' : 'var(--color-input-border)'};"
          aria-label="Search mesh"
        />
        {#if searchValue}
          <button class="clear-search" on:click={clearSearch} aria-label="Clear search">&times;</button>
        {/if}
      </div>

      <!-- Layer toggles -->
      <div class="filter-row">
        <span class="filter-label" style="color: {isConstellation ? 'rgba(180, 200, 240, 0.5)' : 'var(--color-caption)'};">Layers:</span>
        <div class="layer-pills">
          <button
            class="layer-pill"
            class:active={layers.recipes}
            class:constellation={isConstellation}
            on:click={() => toggleLayer('recipes')}
          >Recipes</button>
          <button
            class="layer-pill"
            class:active={layers.tags}
            class:constellation={isConstellation}
            on:click={() => toggleLayer('tags')}
          >Tags</button>
          <button
            class="layer-pill"
            class:active={layers.chefs}
            class:constellation={isConstellation}
            on:click={() => toggleLayer('chefs')}
          >Chefs</button>
        </div>
      </div>

      <!-- Cuisine chips -->
      {#if cuisineTags.length > 0}
        <div class="filter-row">
          <span class="filter-label" style="color: {isConstellation ? 'rgba(180, 200, 240, 0.5)' : 'var(--color-caption)'};">Cuisine:</span>
          <div class="filter-chips">
            {#each cuisineTags.slice(0, 12) as tag}
              <button
                class="filter-chip"
                class:active={filters.cuisine.includes(tag)}
                class:constellation={isConstellation}
                on:click={() => toggleCuisineFilter(tag)}
              >{tag}</button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Clear all -->
      {#if hasActiveFilters}
        <div class="filter-row">
          <button class="clear-all" on:click={clearAllFilters}>Clear all filters</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .mesh-control-panel {
    flex-shrink: 0;
    z-index: 10;
    background-color: var(--color-bg-primary);
    border-bottom: 1px solid var(--color-input-border);
  }

  .mesh-control-panel.constellation {
    background-color: rgba(10, 12, 25, 0.95);
    border-bottom-color: rgba(180, 200, 240, 0.1);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
  }

  .panel-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .theme-toggle,
  .filter-toggle {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    border: 1px solid var(--color-input-border);
    background: transparent;
    color: var(--color-text-primary);
    cursor: pointer;
    position: relative;
    font-size: 16px;
    transition: background-color 0.15s, border-color 0.15s;
  }

  .theme-toggle:hover,
  .filter-toggle:hover {
    background-color: var(--color-input-bg);
  }

  .theme-toggle.active {
    background-color: rgba(180, 200, 240, 0.15);
    border-color: rgba(180, 200, 240, 0.3);
    color: rgba(220, 230, 255, 0.9);
  }

  .filter-toggle.active {
    background-color: rgba(249, 115, 22, 0.1);
    border-color: rgba(249, 115, 22, 0.3);
  }

  .filter-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-primary);
  }

  .panel-filters {
    padding: 0 1rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
    flex-wrap: wrap;
  }

  .filter-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid;
    font-size: 13px;
    outline: none;
    min-width: 0;
  }

  .search-input:focus {
    border-color: var(--color-primary);
  }

  .clear-search {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--color-input-border);
    color: var(--color-text-primary);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }

  .layer-pills {
    display: flex;
    gap: 4px;
  }

  .layer-pill {
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    background: transparent;
    color: var(--color-caption);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .layer-pill.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .layer-pill.constellation.active {
    background: rgba(180, 200, 240, 0.2);
    border-color: rgba(180, 200, 240, 0.4);
    color: rgba(220, 230, 255, 0.9);
  }

  .filter-chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    overflow: hidden;
    max-height: 60px;
  }

  .filter-chip {
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    background: transparent;
    color: var(--color-text-primary);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .filter-chip.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .filter-chip.constellation.active {
    background: rgba(180, 200, 240, 0.2);
    border-color: rgba(180, 200, 240, 0.4);
    color: rgba(220, 230, 255, 0.9);
  }

  .clear-all {
    font-size: 12px;
    color: var(--color-primary);
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
  }

  .clear-all:hover {
    text-decoration: underline;
  }

  .constellation .mesh-control-panel .theme-toggle,
  .constellation .filter-toggle {
    border-color: rgba(180, 200, 240, 0.2);
    color: rgba(220, 230, 255, 0.7);
  }
</style>
