<script lang="ts">
  import { ARTICLE_CATEGORY_ORDER, type SortOption } from '$lib/articleUtils';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';

  export let selectedCategory: string = 'Food'; // Default to Food
  export let selectedSort: SortOption = 'newest';

  // Use ordered categories
  const categories = ARTICLE_CATEGORY_ORDER;
  const sortOptions: { value: SortOption; label: string }[] = [
    { value: 'newest', label: 'Newest' },
    { value: 'oldest', label: 'Oldest' },
    { value: 'longest', label: 'Longest' },
    { value: 'shortest', label: 'Shortest' }
  ];

  let sortDropdownOpen = false;

  function handleCategoryClick(category: string) {
    selectedCategory = category;
  }

  function handleSortSelect(sort: SortOption) {
    selectedSort = sort;
    sortDropdownOpen = false;
  }

  function toggleSortDropdown() {
    sortDropdownOpen = !sortDropdownOpen;
  }

  // Close dropdown when clicking outside
  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.sort-dropdown')) {
      sortDropdownOpen = false;
    }
  }
</script>

<svelte:window on:click={handleClickOutside} />

<div
  class="filter-bar flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 mb-6"
  style="border-bottom: 1px solid var(--color-input-border);"
>
  <!-- Section Title -->
  <h2 class="text-2xl font-bold" style="color: var(--color-text-primary);">
    Recent Articles
  </h2>

  <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3">
    <!-- Category Pills -->
    <div class="flex flex-wrap gap-2">
      {#each categories as category}
        <button
          class="category-pill px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 {selectedCategory === category
            ? 'active'
            : ''}"
          style="
            background-color: {selectedCategory === category ? 'var(--color-primary)' : 'var(--color-input-bg)'};
            color: {selectedCategory === category ? 'white' : 'var(--color-text-secondary)'};
            border: 1px solid {selectedCategory === category ? 'var(--color-primary)' : 'var(--color-input-border)'};
          "
          on:click={() => handleCategoryClick(category)}
        >
          {category}
        </button>
      {/each}
    </div>

    <!-- Sort Dropdown -->
    <div class="sort-dropdown relative">
      <button
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        style="background-color: var(--color-input-bg); color: var(--color-text-secondary); border: 1px solid var(--color-input-border);"
        on:click|stopPropagation={toggleSortDropdown}
      >
        <span>Sort: {sortOptions.find((o) => o.value === selectedSort)?.label}</span>
        <CaretDownIcon
          size={14}
          class="transition-transform duration-200 {sortDropdownOpen ? 'rotate-180' : ''}"
        />
      </button>

      {#if sortDropdownOpen}
        <div
          class="absolute right-0 top-full mt-1 py-1 rounded-lg shadow-lg z-10 min-w-[140px]"
          style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
        >
          {#each sortOptions as option}
            <button
              class="w-full text-left px-4 py-2 text-sm transition-colors hover:bg-accent-gray {selectedSort === option.value
                ? 'font-semibold'
                : ''}"
              style="color: {selectedSort === option.value ? 'var(--color-primary)' : 'var(--color-text-primary)'};"
              on:click|stopPropagation={() => handleSortSelect(option.value)}
            >
              {option.label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .category-pill {
    cursor: pointer;
  }

  .category-pill:hover:not(.active) {
    background-color: var(--color-accent-gray) !important;
  }

  .category-pill.active {
    box-shadow: 0 2px 8px rgba(255, 107, 53, 0.3);
  }
</style>
