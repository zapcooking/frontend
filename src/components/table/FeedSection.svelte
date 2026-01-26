<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import FilterBar from './FilterBar.svelte';
  import ArticleCard from '../ArticleCard.svelte';
  import { filterByCategory, sortArticles, limitArticlesPerAuthor, type ArticleData, type SortOption } from '$lib/articleUtils';

  export let articles: ArticleData[] = [];
  export let loading: boolean = false;
  export let loadingMore: boolean = false;
  export let coverArticleIds: string[] = []; // Exclude cover articles from feed
  export let foodOnly: boolean = true; // Sync default category with toggle

  const dispatch = createEventDispatcher<{ loadMore: void }>();

  // Default category based on foodOnly toggle
  let selectedCategory = foodOnly ? 'Food' : 'All';
  let selectedSort: SortOption = 'newest';

  // Sync category when foodOnly changes
  $: selectedCategory = foodOnly ? 'Food' : 'All';

  // Filter out cover articles and apply filters
  $: feedArticles = articles.filter((a) => !coverArticleIds.includes(a.id));
  $: authorLimitedArticles = limitArticlesPerAuthor(feedArticles, 3); // Max 3 per author
  $: filteredArticles = filterByCategory(authorLimitedArticles, selectedCategory);
  $: sortedArticles = sortArticles(filteredArticles, selectedSort);

  // Pagination - show all filtered articles (infinite scroll handles fetching more)
  const ARTICLES_PER_PAGE = 12;
  let displayCount = ARTICLES_PER_PAGE;

  $: displayedArticles = sortedArticles.slice(0, displayCount);
  $: hasMoreLocal = displayCount < sortedArticles.length;

  function loadMoreLocal() {
    displayCount += ARTICLES_PER_PAGE;
    
    // If we're showing almost all articles, request more from relays
    if (displayCount >= sortedArticles.length - 3) {
      dispatch('loadMore');
    }
  }

  // Reset pagination when filters change
  $: if (selectedCategory || selectedSort) {
    displayCount = ARTICLES_PER_PAGE;
  }

  // Infinite scroll detection
  let loadMoreTrigger: HTMLDivElement;
  let observer: IntersectionObserver | null = null;

  onMount(() => {
    if (typeof window !== 'undefined' && loadMoreTrigger) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !loading && !loadingMore) {
            if (hasMoreLocal) {
              loadMoreLocal();
            } else {
              // No more local articles, fetch from relays
              dispatch('loadMore');
            }
          }
        },
        { rootMargin: '200px' } // Trigger 200px before reaching bottom
      );
      observer.observe(loadMoreTrigger);
    }
  });

  onDestroy(() => {
    if (observer) {
      observer.disconnect();
    }
  });
</script>

<section class="feed-section">
  <!-- Filter Bar -->
  <FilterBar bind:selectedCategory bind:selectedSort />

  {#if loading}
    <!-- Loading Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each Array(6) as _}
        <div
          class="rounded-xl overflow-hidden animate-pulse"
          style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
        >
          <div class="aspect-[16/9] w-full bg-gray-200 dark:bg-gray-700"></div>
          <div class="p-5">
            <div class="h-6 w-3/4 rounded bg-gray-200 dark:bg-gray-700 mb-3"></div>
            <div class="flex items-center gap-2 mb-3">
              <div class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700"></div>
              <div class="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700"></div>
            </div>
            <div class="h-4 w-full rounded bg-gray-200 dark:bg-gray-700 mb-2"></div>
            <div class="h-4 w-5/6 rounded bg-gray-200 dark:bg-gray-700"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else if sortedArticles.length === 0}
    <!-- Empty State -->
    <div class="text-center py-16">
      <div class="text-5xl mb-4">🔍</div>
      <h3 class="text-lg font-semibold mb-2" style="color: var(--color-text-primary);">
        No Articles Found
      </h3>
      <p class="text-caption">
        {#if selectedCategory !== 'All'}
          Try selecting "All" to see all available articles.
        {:else}
          No articles match your current filters. Check back later!
        {/if}
      </p>
    </div>
  {:else}
    <!-- Article Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each displayedArticles as article (article.id)}
        <div class="article-card-wrapper">
          <ArticleCard
            event={article.event}
            imageUrl={article.imageUrl}
            title={article.title}
            preview={article.preview}
            readTime={article.readTimeMinutes}
            tags={article.tags}
            articleUrl={article.articleUrl}
          />
        </div>
      {/each}
    </div>

    <!-- Infinite scroll trigger -->
    <div bind:this={loadMoreTrigger} class="h-4"></div>

    <!-- Loading More Indicator -->
    {#if loadingMore}
      <div class="flex justify-center py-8">
        <div class="flex items-center gap-3">
          <div class="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
          <span class="text-sm text-caption">Loading more articles...</span>
        </div>
      </div>
    {:else if hasMoreLocal}
      <!-- Manual load more button as fallback -->
      <div class="flex justify-center mt-8">
        <button
          class="px-6 py-3 rounded-full font-medium transition-all duration-200 hover:scale-105"
          style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
          on:click={loadMoreLocal}
        >
          Load More ({sortedArticles.length - displayCount} remaining)
        </button>
      </div>
    {/if}

    <!-- Article Count -->
    <div class="text-center mt-6 text-sm text-caption">
      Showing {displayedArticles.length} of {sortedArticles.length} articles
      {#if selectedCategory !== 'All'}
        in "{selectedCategory}"
      {/if}
    </div>
  {/if}
</section>

<style>
  .feed-section {
    margin-top: 2rem;
  }

  .article-card-wrapper {
    display: flex;
    min-height: 480px;
  }

  @media (min-width: 768px) {
    .article-card-wrapper {
      min-height: 520px;
    }
  }
</style>
