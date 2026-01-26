<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { ndk, getCurrentRelayGeneration } from '$lib/nostr';
  import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
  import CoverSection from '../../components/table/CoverSection.svelte';
  import FeedSection from '../../components/table/FeedSection.svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import {
    ALL_ARTICLE_HASHTAGS,
    isValidLongformArticle,
    isValidLongformArticleNoFoodFilter,
    eventToArticleData,
    curateCover,
    clearCoverCache,
    type ArticleData,
    type CuratedCover
  } from '$lib/articleUtils';
  import { cacheFeedEvents, loadCachedFeedEvents } from '$lib/eventStore';
  import { RELAY_SETS } from '$lib/relays/relaySets';
  import { fetchArticles, backgroundArticleRefresh, type ArticleFetchStats } from '$lib/articleOutbox';
  import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';

  let articles: ArticleData[] = [];
  let cover: CuratedCover | null = null;
  let loading = true;
  let loadingMore = false;
  let subscription: NDKSubscription | null = null;
  let seenEventIds = new Set<string>();
  let pullToRefreshEl: PullToRefresh;
  
  // Pagination tracking
  let oldestTimestamp: number | null = null;
  let hasMoreArticles = true;

  // Cache freshness tracking
  const CACHE_FRESHNESS_KEY = 'zapcooking_reads_last_fetch';
  const CACHE_FRESH_DURATION_MS = 3 * 60 * 1000; // 3 minutes - skip relay fetch if cache is this fresh
  const BACKGROUND_REFRESH_DELAY_MS = 5000; // Wait 5s after initial paint before background refresh

  // Food-only toggle (defaults to ON)
  const FOOD_ONLY_KEY = 'zapcooking_reads_food_only';
  let foodOnly = true;

  // Load preference from localStorage on mount
  function loadFoodOnlyPreference() {
    if (browser) {
      const stored = localStorage.getItem(FOOD_ONLY_KEY);
      // Default to true if not set
      foodOnly = stored === null ? true : stored === 'true';
    }
  }

  function toggleFoodOnly() {
    foodOnly = !foodOnly;
    if (browser) {
      localStorage.setItem(FOOD_ONLY_KEY, String(foodOnly));
    }
    
    // Re-curate cover based on new toggle state - no need to refetch!
    // We already have all articles, just need to re-filter for the cover
    if (articles.length >= 6) {
      clearCoverCache();
      const coverArticles = foodOnly
        ? articles.filter(a => isValidLongformArticle(a.event))
        : articles;
      if (coverArticles.length >= 1) {
        cover = curateCover(coverArticles, true);
      }
    }
  }

  // Cover article IDs to exclude from feed
  $: coverArticleIds = cover
    ? [
        cover.hero?.id,
        ...(cover.secondary?.map((a) => a.id) || []),
        ...(cover.tertiary?.map((a) => a.id) || [])
      ].filter((id): id is string => !!id)
    : [];

  // Process events into articles
  // Feed shows ALL articles, cover is filtered by foodOnly toggle
  function processEvents(events: NDKEvent[], forceRefresh: boolean = false): void {
    for (const event of events) {
      if (seenEventIds.has(event.id)) continue;
      seenEventIds.add(event.id);

      // For feed: accept all valid longform articles (1 min minimum)
      const isValidForFeed = isValidLongformArticleNoFoodFilter(event);

      if (isValidForFeed) {
        const articleData = eventToArticleData(event, true); // Always get all tags
        if (articleData) {
          articles = [...articles, articleData]
            .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
            .sort((a, b) => b.publishedAt - a.publishedAt);

          // Curate cover from food-only articles when foodOnly is ON
          if (articles.length >= 6 && !cover) {
            const coverArticles = foodOnly
              ? articles.filter(a => isValidLongformArticle(a.event))
              : articles;
            if (coverArticles.length >= 6) {
              cover = curateCover(coverArticles, forceRefresh);
            }
          }
        }
      }
    }
  }

  // Check if cache is fresh enough to skip relay fetch
  function isCacheFresh(): boolean {
    if (!browser) return false;
    const lastFetch = localStorage.getItem(CACHE_FRESHNESS_KEY);
    if (!lastFetch) return false;
    const elapsed = Date.now() - parseInt(lastFetch, 10);
    return elapsed < CACHE_FRESH_DURATION_MS;
  }

  // Update cache timestamp
  function markCacheRefreshed() {
    if (browser) {
      localStorage.setItem(CACHE_FRESHNESS_KEY, String(Date.now()));
    }
  }

  async function loadArticles(forceRefresh: boolean = false) {
    const startGeneration = getCurrentRelayGeneration();

    if (!$ndk) {
      console.warn('[Reads] NDK not available');
      loading = false;
      return;
    }

    // Stop existing subscription
    if (subscription) {
      subscription.stop();
      subscription = null;
    }

    if (forceRefresh) {
      clearCoverCache();
      articles = [];
      seenEventIds.clear();
      cover = null;
      oldestTimestamp = null;
      hasMoreArticles = true;
    }

    // Always fetch all articles - feed shows all, cover filtered by foodOnly
    const cacheFilter = { kinds: [30023], hashtags: ALL_ARTICLE_HASHTAGS.slice(0, 40), limit: 150 };

    // Try to load from cache first for instant paint
    let cacheWasUsed = false;
    let cacheSufficient = false;
    
    if (!forceRefresh && browser) {
      try {
        const cachedEvents = await loadCachedFeedEvents(cacheFilter);
        if (cachedEvents.length > 0) {
          if (import.meta.env.DEV) {
            console.log(`[Reads] Loaded ${cachedEvents.length} articles from cache`);
          }
          processEvents(cachedEvents, false);
          cacheWasUsed = true;
          
          // If we have enough cached data, show it immediately
          if (articles.length >= 6) {
            const coverArticles = foodOnly
              ? articles.filter(a => isValidLongformArticle(a.event))
              : articles;
            if (coverArticles.length >= 6) {
              cover = curateCover(coverArticles, false);
            }
            loading = false;
            cacheSufficient = true;
            
            // Track oldest timestamp from cache
            if (articles.length > 0) {
              oldestTimestamp = Math.min(...articles.map(a => a.publishedAt));
            }
          }
        }
      } catch (err) {
        console.warn('[Reads] Cache load error:', err);
      }
    }

    // If cache is fresh and sufficient, skip network fetch entirely
    // Schedule a background refresh for later instead
    if (cacheSufficient && isCacheFresh() && !forceRefresh) {
      if (import.meta.env.DEV) {
        console.log('[Reads] Cache is fresh, skipping network fetch');
      }
      
      // Schedule background refresh after delay (won't block UI)
      setTimeout(() => {
        if (browser) {
          backgroundRefresh();
        }
      }, BACKGROUND_REFRESH_DELAY_MS);
      
      return;
    }

    // If cache was used but not fresh, continue with network fetch (but don't show loading spinner)
    if (!cacheSufficient) {
      loading = true;
    }

    // Use the new article outbox strategy (Primal + relays)
    fetchWithOutbox(forceRefresh, startGeneration);
  }

  // Background refresh using article outbox (Primal + relays)
  async function backgroundRefresh() {
    if (!$ndk || !browser) return;
    
    const startGeneration = getCurrentRelayGeneration();
    if (import.meta.env.DEV) {
      console.log('[Reads] Starting background refresh via outbox');
    }
    
    try {
      const newEvents = await backgroundArticleRefresh($ndk, seenEventIds, {
        hashtags: ALL_ARTICLE_HASHTAGS.slice(0, 40),
        limit: 50
      });
      
      // Check generation hasn't changed
      if (getCurrentRelayGeneration() !== startGeneration) return;
      
      // Process new events
      let hasNewArticles = false;
      const eventsToCache: NDKEvent[] = [];
      
      for (const event of newEvents) {
        if (!seenEventIds.has(event.id)) {
          seenEventIds.add(event.id);
          eventsToCache.push(event);
          
          const articleData = eventToArticleData(event, true);
          if (articleData) {
            hasNewArticles = true;
            articles = [...articles, articleData]
              .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
              .sort((a, b) => b.publishedAt - a.publishedAt);
          }
        }
      }
      
      // Update cache timestamp
      markCacheRefreshed();
      
      // Cache all events
      if (eventsToCache.length > 0) {
        cacheFeedEvents(eventsToCache).catch(() => {});
      }
      
      // Re-curate cover if we got new articles
      if (hasNewArticles && articles.length >= 6) {
        const coverArticles = foodOnly
          ? articles.filter(a => isValidLongformArticle(a.event))
          : articles;
        if (coverArticles.length >= 6) {
          cover = curateCover(coverArticles, false);
        }
      }
      
      if (import.meta.env.DEV) {
        console.log(`[Reads] Background refresh complete, ${eventsToCache.length} new articles`);
      }
      
    } catch (err) {
      console.warn('[Reads] Background refresh error:', err);
    }
  }

  // Fetch using article outbox strategy (Primal fast-path + relay fallback)
  async function fetchWithOutbox(forceRefresh: boolean, startGeneration: number) {
    try {
      const eventsToCache: NDKEvent[] = [];
      
      // Use the article outbox which tries Primal first, then relays
      const { events, stats } = await fetchArticles($ndk, {
        hashtags: ALL_ARTICLE_HASHTAGS.slice(0, 40),
        limit: 200,
        onEvent: (event: NDKEvent) => {
          // Check generation hasn't changed (relay switch)
          if (getCurrentRelayGeneration() !== startGeneration) return;
          if (seenEventIds.has(event.id)) return;
          
          seenEventIds.add(event.id);
          eventsToCache.push(event);
          
          const articleData = eventToArticleData(event, true);
          if (articleData) {
            articles = [...articles, articleData]
              .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
              .sort((a, b) => b.publishedAt - a.publishedAt);

            // Curate cover when we have enough articles
            if (articles.length >= 6 && !cover) {
              const coverArticles = foodOnly
                ? articles.filter(a => isValidLongformArticle(a.event))
                : articles;
              if (coverArticles.length >= 6) {
                cover = curateCover(coverArticles, forceRefresh);
              }
            }
          }
        }
      });

      // Final processing
      loading = false;
      markCacheRefreshed();
      
      // Track oldest timestamp for pagination
      if (articles.length > 0) {
        oldestTimestamp = Math.min(...articles.map(a => a.publishedAt));
      }
      
      // Curate cover
      if (articles.length > 0 && !cover) {
        const coverArticles = foodOnly
          ? articles.filter(a => isValidLongformArticle(a.event))
          : articles;
        if (coverArticles.length >= 1) {
          cover = curateCover(coverArticles, forceRefresh);
        }
      }

      // Cache events for next visit
      if (eventsToCache.length > 0 && browser) {
        cacheFeedEvents(eventsToCache).catch(() => {});
      }
      
      if (import.meta.env.DEV) {
        console.log(
          `[Reads] Outbox fetch complete: ${stats.totalEvents} articles ` +
          `(Primal: ${stats.primalEvents}, Relays: ${stats.relayEvents}) ` +
          `in ${stats.totalTimeMs}ms`
        );
      }
      
    } catch (error) {
      console.error('[Reads] Error loading articles:', error);
      loading = false;
    }
  }

  // Load more articles (infinite scroll) - fetches older articles
  async function loadMoreArticles() {
    if (loadingMore || !hasMoreArticles || !oldestTimestamp || !$ndk) return;
    
    loadingMore = true;
    const startGeneration = getCurrentRelayGeneration();
    const articlesBeforeLoad = articles.length;
    
    try {
      if (import.meta.env.DEV) {
        console.log(`[Reads] Loading more articles before timestamp ${oldestTimestamp}`);
      }
      
      // Use article outbox with 'until' for pagination
      const { events: moreEvents, stats } = await fetchArticles($ndk, {
        hashtags: ALL_ARTICLE_HASHTAGS.slice(0, 40),
        until: oldestTimestamp - 1, // Get events older than our oldest
        limit: 50
      });
      
      // Check generation hasn't changed
      if (getCurrentRelayGeneration() !== startGeneration) {
        loadingMore = false;
        return;
      }
      
      const newEvents: NDKEvent[] = [];
      
      // Process fetched events
      for (const event of moreEvents) {
        if (seenEventIds.has(event.id)) continue;
        
        newEvents.push(event);
        seenEventIds.add(event.id);
        
        const articleData = eventToArticleData(event, true);
        if (articleData) {
          articles = [...articles, articleData]
            .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
            .sort((a, b) => b.publishedAt - a.publishedAt);
        }
      }
      
      loadingMore = false;
      
      // Update oldest timestamp
      if (articles.length > 0) {
        const oldest = Math.min(...articles.map(a => a.publishedAt));
        oldestTimestamp = oldest;
      }
      
      // Check if we got new articles - if not, we might have reached the end
      if (articles.length === articlesBeforeLoad || newEvents.length === 0) {
        hasMoreArticles = false;
        if (import.meta.env.DEV) {
          console.log('[Reads] No more articles to load');
        }
      } else if (import.meta.env.DEV) {
        console.log(
          `[Reads] Loaded ${newEvents.length} more articles ` +
          `(Primal: ${stats.primalEvents}, Relays: ${stats.relayEvents})`
        );
      }
      
      // Cache new events
      if (newEvents.length > 0 && browser) {
        cacheFeedEvents(newEvents).catch(() => {});
      }
      
    } catch (error) {
      console.error('[Reads] Error loading more articles:', error);
      loadingMore = false;
    }
  }

  function handleLoadMore() {
    loadMoreArticles();
  }

  async function handleRefresh() {
    try {
      await loadArticles(true);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      pullToRefreshEl?.complete();
    }
  }

  function handleManualRefresh() {
    loadArticles(true);
  }

  onMount(() => {
    loadFoodOnlyPreference();
    loadArticles();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
  });
</script>

<svelte:head>
  <title>Reads - Food, Farming & Culture | zap.cooking</title>
  <meta
    name="description"
    content="Food, Farming, and Culture. Discover curated articles and stories from diverse voices on zap.cooking."
  />
  <meta property="og:url" content="https://zap.cooking/reads" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Reads - Food, Farming & Culture | zap.cooking" />
  <meta
    property="og:description"
    content="Food, Farming, and Culture. Discover curated articles and stories from diverse voices."
  />
  <meta property="og:image" content="https://zap.cooking/social-share.png" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content="https://zap.cooking/reads" />
  <meta name="twitter:title" content="Reads - Food, Farming & Culture | zap.cooking" />
  <meta
    name="twitter:description"
    content="Food, Farming, and Culture. Discover curated articles and stories from diverse voices."
  />
  <meta property="twitter:image" content="https://zap.cooking/social-share.png" />
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
  <div class="table-page">
    <!-- Page Header -->
    <header class="page-header mb-8">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-3xl md:text-4xl font-bold {foodOnly ? 'mb-2' : 'mb-0'}" style="color: var(--color-text-primary);">
            Reads
          </h1>
          {#if foodOnly}
            <p class="text-base md:text-lg max-w-2xl" style="color: var(--color-text-secondary);">
              Food, Farming, and Culture
            </p>
          {/if}
        </div>

        <div class="flex items-center gap-3 flex-shrink-0">
          <!-- Food Only Toggle (matches community feed style) -->
          <div class="flex items-center gap-2">
            {#if foodOnly}
              <span class="text-sm">
                🍳 <span class="text-caption">Only</span><span class="font-bold" style="color: var(--color-text-primary)">Food</span>
              </span>
            {:else}
              <span class="text-sm text-caption">All topics</span>
            {/if}
            <button
              on:click={toggleFoodOnly}
              disabled={loading}
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {foodOnly ? 'bg-primary' : 'bg-accent-gray'}"
              aria-pressed={foodOnly}
              aria-label="Toggle food-only filter"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {foodOnly ? 'translate-x-6' : 'translate-x-1'}"
              />
            </button>
          </div>

          <!-- Refresh Button -->
          <button
            class="refresh-button p-2 rounded-full transition-all duration-200 hover:bg-accent-gray {loading ? 'animate-spin' : ''}"
            style="color: var(--color-text-secondary);"
            on:click={handleManualRefresh}
            disabled={loading}
            aria-label="Refresh articles"
          >
            <ArrowClockwiseIcon size={24} />
          </button>
        </div>
      </div>
    </header>

    <!-- Cover Section -->
    <CoverSection {cover} {loading} />

    <!-- Feed Section -->
    <FeedSection 
      {articles} 
      {loading} 
      {coverArticleIds} 
      {foodOnly}
      {loadingMore}
      on:loadMore={handleLoadMore}
    />
  </div>
</PullToRefresh>

<style>
  .table-page {
    max-width: 1400px;
    margin: 0 auto;
    padding-top: 0.5rem;
  }

  .page-header {
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--color-input-border);
  }

  .refresh-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .animate-spin {
    animation: spin 1s linear infinite;
  }

  /* Premium reading feel - generous spacing */
  :global(.table-page article) {
    transition: transform 0.2s ease-out, box-shadow 0.2s ease-out;
  }
</style>
