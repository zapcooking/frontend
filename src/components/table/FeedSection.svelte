<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import FilterBar from './FilterBar.svelte';
  import ArticleCard from '../ArticleCard.svelte';
  import { filterByCategory, sortArticles, limitArticlesPerAuthor, deduplicatePreviewArticles, isRelevantToReads, type ArticleData, type SortOption } from '$lib/articleUtils';
  import { isBlockedFromReads, readsModerationVersion } from '$lib/reads/moderationClient';
  import { SPAM_REASON_LABELS, type SpamReason } from '$lib/reads/spamRules';
  import { readsFold, type AuthorTrustLike } from '$lib/reads/allReadsView';

  export let articles: ArticleData[] = [];
  export let loading: boolean = false;
  export let loadingMore: boolean = false;
  export let coverArticleIds: string[] = []; // Exclude cover articles from feed
  export let followedPubkeys: Set<string> = new Set(); // For "For You" sort
  export let isSignedIn: boolean = false;
  /** "All reads" only: articles the spam rules flagged (id → reason), folded under a reveal line. */
  export let spamReasons: Map<string, SpamReason> = new Map();
  /** "All reads" only: each author's trust (absent = still looking). Null: no trust fold (curated tab). */
  export let authorTrust: ReadonlyMap<string, AuthorTrustLike> | null = null;

  const dispatch = createEventDispatcher<{ loadMore: void }>();

  let selectedCategory = 'All';
  let selectedSort: SortOption = isSignedIn ? 'foryou' : 'newest';

  // When user signs in, switch to "For You" if still on unsigned default
  $: if (isSignedIn && selectedSort === 'newest') {
    selectedSort = 'foryou';
  }
  // When user signs out, reset "For You" back to default
  $: if (!isSignedIn && selectedSort === 'foryou') {
    selectedSort = 'newest';
  }

  // Filter out cover articles, articles without real images (no placeholders in
  // reads), and off-topic content that doesn't match any curated reads topic.
  $: _moderationVersion = $readsModerationVersion;
  $: feedArticles = articles.filter(
    (a) =>
      _moderationVersion >= 0 &&
      !coverArticleIds.includes(a.id) &&
      a.imageUrl &&
      isRelevantToReads(a) &&
      !isBlockedFromReads(a.event)
  );
  $: dedupedArticles = deduplicatePreviewArticles(feedArticles);
  $: authorLimitedArticles = limitArticlesPerAuthor(dedupedArticles, 3); // Max 3 per author
  $: categoryArticles = filterByCategory(authorLimitedArticles, selectedCategory);
  // Never hidden silently: spam and articles from accounts with no trust
  // connection are counted on separate lines, and shown marked on request.
  let revealSpam = false;
  let revealStrangers = false;
  $: view = readsFold(categoryArticles, spamReasons, authorTrust, { spam: revealSpam, strangers: revealStrangers });
  $: filteredArticles = view.shown;
  $: spamCount = view.spamCount;
  $: strangerCount = view.strangerCount;
  $: isStranger = (a: ArticleData) => !spamReasons.has(a.id) && authorTrust?.get(a.author.pubkey.toLowerCase()) === 'stranger';
  $: sortedArticles = sortArticles(filteredArticles, selectedSort, followedPubkeys);

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
  <FilterBar bind:selectedCategory bind:selectedSort showForYou={isSignedIn} />

  {#if !loading && spamCount > 0}
    <p class="spam-line" data-testid="spam-line">
      {#if revealSpam}
        {spamCount} likely spam shown, marked ·
        <button type="button" class="spam-toggle" on:click={() => (revealSpam = false)}>hide</button>
      {:else}
        {spamCount} hidden as likely spam ·
        <button type="button" class="spam-toggle" on:click={() => (revealSpam = true)}>show</button>
      {/if}
    </p>
  {/if}
  {#if !loading && strangerCount > 0}
    <p class="spam-line" data-testid="stranger-line">
      {#if revealStrangers}
        {strangerCount} from accounts we don't know yet, shown marked ·
        <button type="button" class="spam-toggle" on:click={() => (revealStrangers = false)}>hide</button>
      {:else}
        {strangerCount} from accounts we don't know yet ·
        <button type="button" class="spam-toggle" on:click={() => (revealStrangers = true)}>show</button>
      {/if}
    </p>
  {/if}

  {#if loading}
    <!-- Loading Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each Array(6) as _}
        <div
          class="rounded-xl overflow-hidden animate-pulse"
          style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
        >
          <div class="aspect-[16/9] w-full bg-[var(--color-skeleton-base)] dark:bg-[var(--color-bg-secondary)]"></div>
          <div class="p-5">
            <div class="h-6 w-3/4 rounded bg-[var(--color-skeleton-base)] dark:bg-[var(--color-bg-secondary)] mb-3"></div>
            <div class="flex items-center gap-2 mb-3">
              <div class="w-8 h-8 rounded-full bg-[var(--color-skeleton-base)] dark:bg-[var(--color-bg-secondary)]"></div>
              <div class="h-4 w-24 rounded bg-[var(--color-skeleton-base)] dark:bg-[var(--color-bg-secondary)]"></div>
            </div>
            <div class="h-4 w-full rounded bg-[var(--color-skeleton-base)] dark:bg-[var(--color-bg-secondary)] mb-2"></div>
            <div class="h-4 w-5/6 rounded bg-[var(--color-skeleton-base)] dark:bg-[var(--color-bg-secondary)]"></div>
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
        <div class="article-card-wrapper" class:spam-marked={spamReasons.has(article.id) || isStranger(article)}>
          {#if spamReasons.has(article.id)}
            <span class="spam-mark" data-testid="spam-mark">Likely spam: {SPAM_REASON_LABELS[spamReasons.get(article.id) ?? 'short']}</span>
          {:else if isStranger(article)}
            <span class="spam-mark" data-testid="stranger-mark">Account we don't know yet</span>
          {/if}
          <ArticleCard
            event={article.event}
            imageUrl={article.imageUrl}
            title={article.title}
            preview={article.preview}
            readTime={article.readTimeMinutes}
            tags={article.tags}
            articleUrl={article.articleUrl}
            routeImage
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

  .article-card-wrapper.spam-marked {
    flex-direction: column;
    gap: 0.375rem;
    opacity: 0.75;
  }

  .spam-line {
    margin: 1rem 0 0.75rem;
    font-size: 0.8125rem;
    color: var(--color-caption);
  }

  .spam-line + .spam-line {
    margin-top: -0.5rem;
  }

  .spam-toggle {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .spam-mark {
    align-self: flex-start;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    color: var(--color-caption);
    border: 1px solid var(--color-input-border);
  }

  @media (min-width: 768px) {
    .article-card-wrapper {
      min-height: 520px;
    }
  }
</style>
