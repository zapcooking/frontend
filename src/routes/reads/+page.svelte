<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { ndk, getCurrentRelayGeneration, userPublickey } from '$lib/nostr';
  import { NDKRelaySet } from '@nostr-dev-kit/ndk';
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
  import { isPrimalCacheAvailable } from '$lib/primalCache';
  import { openNewDraft, drafts } from '../../components/reads/articleDraftStore';
  import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';
  import PencilSimpleLineIcon from 'phosphor-svelte/lib/PencilSimpleLine';
  import FolderIcon from 'phosphor-svelte/lib/Folder';

  $: isSignedIn = $userPublickey !== '';
  $: draftCount = $drafts.length;

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
    if (articles.length >= 1) {
      clearCoverCache();
      const coverArticles = foodOnly
        ? articles.filter(a => isValidLongformArticle(a.event))
        : articles;
      if (coverArticles.length >= 1) {
        cover = curateCover(coverArticles, true);
      } else if (foodOnly) {
        // If foodOnly is on but no food articles, clear cover
        cover = null;
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

          // Curate cover when we have enough articles (try to curate even with fewer articles)
          if (articles.length >= 1 && !cover) {
            const coverArticles = foodOnly
              ? articles.filter(a => isValidLongformArticle(a.event))
              : articles;
            // Curate if we have at least 1 article (curateCover can work with fewer)
            if (coverArticles.length >= 1) {
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
    const cacheFilter = { kinds: [30023], hashtags: ALL_ARTICLE_HASHTAGS.slice(0, 40), limit: 500 };

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
          
          // If we have cached data, show it immediately and curate cover
          if (articles.length >= 1) {
            const coverArticles = foodOnly
              ? articles.filter(a => isValidLongformArticle(a.event))
              : articles;
            // Curate cover if we have at least 1 matching article
            if (coverArticles.length >= 1) {
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
        limit: 100 // Increased for better depth
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
      if (hasNewArticles && articles.length >= 1) {
        const coverArticles = foodOnly
          ? articles.filter(a => isValidLongformArticle(a.event))
          : articles;
        if (coverArticles.length >= 1) {
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
  
  // Deep background fetch - continues loading older articles for more depth
  async function deepBackgroundFetch(startGeneration: number) {
    if (!$ndk || !browser) return;
    if (getCurrentRelayGeneration() !== startGeneration) return;
    
    console.log('[Reads] Starting deep background fetch for more food articles...');
    
    try {
      // Fetch older articles using 'until' with our oldest timestamp
      const untilTime = oldestTimestamp ? oldestTimestamp - 1 : Math.floor(Date.now() / 1000);
      
      const { events, stats } = await fetchArticles($ndk, {
        hashtags: ALL_ARTICLE_HASHTAGS.slice(0, 40),
        until: untilTime,
        limit: 300,
        skipPrimal: true
      });
      
      if (getCurrentRelayGeneration() !== startGeneration) return;
      
      let addedCount = 0;
      const eventsToCache: NDKEvent[] = [];
      
      for (const event of events) {
        if (seenEventIds.has(event.id)) continue;
        
        seenEventIds.add(event.id);
        eventsToCache.push(event);
        
        const articleData = eventToArticleData(event, true);
        if (articleData) {
          addedCount++;
          articles = [...articles, articleData]
            .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
            .sort((a, b) => b.publishedAt - a.publishedAt);
        }
      }
      
      // Update oldest timestamp
      if (articles.length > 0) {
        oldestTimestamp = Math.min(...articles.map(a => a.publishedAt));
      }
      
      // Cache events
      if (eventsToCache.length > 0) {
        cacheFeedEvents(eventsToCache).catch(() => {});
      }
      
      // Re-curate cover with the expanded article pool
      const foodArticleCount = articles.filter(a => isValidLongformArticle(a.event)).length;
      console.log(`[Reads] Deep fetch complete: ${addedCount} new articles, ${foodArticleCount} total food articles`);
      
      if (foodArticleCount >= 1) {
        const coverArticles = foodOnly
          ? articles.filter(a => isValidLongformArticle(a.event))
          : articles;
        cover = curateCover(coverArticles, false);
      }
      
      // If still not enough food articles, schedule another deep fetch
      if (foodOnly && foodArticleCount < 10 && stats.totalEvents > 0) {
        console.log('[Reads] Still need more food articles, scheduling another deep fetch...');
        setTimeout(() => deepBackgroundFetch(startGeneration), 5000);
      }
      
    } catch (err) {
      console.warn('[Reads] Deep background fetch error:', err);
    }
  }

  // Fetch using article outbox strategy (Primal fast-path + relay fallback)
  async function fetchWithOutbox(forceRefresh: boolean, startGeneration: number) {
    try {
      const eventsToCache: NDKEvent[] = [];
      
      // Use the article outbox - skip Primal cache (doesn't support kind:30023)
      // relay.primal.net is included in the relay list and works for articles
      const { events, stats } = await fetchArticles($ndk, {
        hashtags: ALL_ARTICLE_HASHTAGS.slice(0, 40),
        limit: 2000, // Request lots of articles (no longer capped in articleOutbox)
        skipPrimal: true, // Skip Primal cache API (doesn't support kind:30023)
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

            // Curate cover when we have articles (try to curate even with fewer)
            if (articles.length >= 1 && !cover) {
              const coverArticles = foodOnly
                ? articles.filter(a => isValidLongformArticle(a.event))
                : articles;
              if (coverArticles.length >= 1) {
                cover = curateCover(coverArticles, forceRefresh);
              }
            }
          }
        }
      });

      // Process any events that weren't handled by onEvent callback
      // (This can happen if onEvent isn't called or events are returned directly)
      for (const event of events) {
        if (getCurrentRelayGeneration() !== startGeneration) break;
        if (seenEventIds.has(event.id)) continue;
        
        seenEventIds.add(event.id);
        eventsToCache.push(event);
        
        const articleData = eventToArticleData(event, true);
        if (articleData) {
          articles = [...articles, articleData]
            .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
            .sort((a, b) => b.publishedAt - a.publishedAt);
        }
      }

      // Final processing
      loading = false;
      markCacheRefreshed();
      
      // Track oldest timestamp for pagination
      if (articles.length > 0) {
        oldestTimestamp = Math.min(...articles.map(a => a.publishedAt));
      }
      
      // Always try to curate cover after fetch completes (even if already set, re-curate to ensure it's correct)
      if (articles.length > 0) {
        const coverArticles = foodOnly
          ? articles.filter(a => isValidLongformArticle(a.event))
          : articles;
        if (coverArticles.length >= 1) {
          // Always re-curate to ensure cover matches current foodOnly state
          cover = curateCover(coverArticles, forceRefresh);
        } else if (foodOnly) {
          // If foodOnly is on but no food articles, clear cover
          cover = null;
        }
      }

      // Cache events for next visit
      if (eventsToCache.length > 0 && browser) {
        cacheFeedEvents(eventsToCache).catch(() => {});
      }
      
      // Log results with detailed stats
      const foodArticles = articles.filter(a => isValidLongformArticle(a.event));
      const newestDate = articles.length > 0 ? new Date(Math.max(...articles.map(a => a.publishedAt)) * 1000).toLocaleDateString() : 'N/A';
      const oldestDate = articles.length > 0 ? new Date(Math.min(...articles.map(a => a.publishedAt)) * 1000).toLocaleDateString() : 'N/A';
      
      console.log(
        `[Reads] Fetch complete: ${articles.length} total articles, ${foodArticles.length} food articles ` +
        `(from relays: ${stats.relayEvents}) in ${stats.totalTimeMs}ms`
      );
      console.log(`[Reads] Date range: ${newestDate} to ${oldestDate}`);
      
      if (stats.errors.length > 0) {
        console.warn('[Reads] Outbox fetch errors:', stats.errors);
      }
      
      // If no events were fetched, try the direct relay fallback
      if (stats.totalEvents === 0 && articles.length === 0) {
        console.warn('[Reads] No articles from outbox, trying direct relay subscription...');
        await fetchFromRelaysDirect(forceRefresh, startGeneration);
      }
      
      // Check if we need more food articles for the cover
      const foodArticleCount = articles.filter(a => isValidLongformArticle(a.event)).length;
      if (foodOnly && foodArticleCount < 10) {
        console.log(`[Reads] Only ${foodArticleCount} food articles, starting deep fetch...`);
        // Schedule a deep fetch to get more articles
        setTimeout(() => deepBackgroundFetch(startGeneration), 2000);
      }
      
    } catch (error) {
      console.error('[Reads] Error loading articles:', error);
      loading = false;
      
      // If fetch completely fails, try direct relay subscription as fallback
      if (articles.length === 0) {
        console.warn('[Reads] Outbox failed, trying direct relay subscription...');
        await fetchFromRelaysDirect(forceRefresh, startGeneration);
      }
    }
  }

  // Direct relay subscription fallback (old method)
  async function fetchFromRelaysDirect(forceRefresh: boolean, startGeneration: number) {
    try {
      // Use top food hashtags for filtering (same as articleOutbox)
      const TOP_FOOD_HASHTAGS = [
        'food', 'foodstr', 'cooking', 'recipe', 'recipes', 'chef',
        'farming', 'homesteading', 'gardening', 'foodie', 'homecooking',
        'beef', 'chicken', 'breakfast', 'dinner', 'baking', 'bbq',
        'vegan', 'keto', 'coffee'
      ];
      
      const filter: NDKFilter = {
        kinds: [30023],
        '#t': TOP_FOOD_HASHTAGS,
        limit: 200,
        since: Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60) // Last 90 days
      };
      
      // Use specific relays known to work well for articles
      const articleRelays = [
        'wss://relay.primal.net',
        'wss://nos.lol',
        'wss://relay.damus.io',
        'wss://nostr.wine'
      ];
      
      console.log('[Reads] Direct fallback: querying', articleRelays.join(', '));

      const eventsToCache: NDKEvent[] = [];
      const relaySet = NDKRelaySet.fromRelayUrls(articleRelays, $ndk, true);
      subscription = $ndk.subscribe(filter, { closeOnEose: true }, relaySet);

      subscription.on('event', (event: NDKEvent) => {
        if (getCurrentRelayGeneration() !== startGeneration) return;
        if (seenEventIds.has(event.id)) return;

        const isValid = isValidLongformArticleNoFoodFilter(event);

        if (isValid) {
          eventsToCache.push(event);
          seenEventIds.add(event.id);
          
          const articleData = eventToArticleData(event, true);
          if (articleData) {
            articles = [...articles, articleData]
              .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
              .sort((a, b) => b.publishedAt - a.publishedAt);

            // Curate cover when we have articles (try to curate even with fewer)
            if (articles.length >= 1 && !cover) {
              const coverArticles = foodOnly
                ? articles.filter(a => isValidLongformArticle(a.event))
                : articles;
              if (coverArticles.length >= 1) {
                cover = curateCover(coverArticles, forceRefresh);
              }
            }
          }
        }
      });

      subscription.on('eose', () => {
        loading = false;
        markCacheRefreshed();
        
        // Track oldest timestamp for pagination
        if (articles.length > 0) {
          oldestTimestamp = Math.min(...articles.map(a => a.publishedAt));
        }
        
        // Always try to curate cover after fetch completes (even if already set, re-curate to ensure it's correct)
        if (articles.length > 0) {
          const coverArticles = foodOnly
            ? articles.filter(a => isValidLongformArticle(a.event))
            : articles;
          if (coverArticles.length >= 1) {
            // Always re-curate to ensure cover matches current foodOnly state
            cover = curateCover(coverArticles, forceRefresh);
          } else if (foodOnly) {
            // If foodOnly is on but no food articles, clear cover
            cover = null;
          }
        }

        // Cache events for next visit
        if (eventsToCache.length > 0 && browser) {
          cacheFeedEvents(eventsToCache).catch(() => {});
        }
        
        console.log(`[Reads] Direct relay fetch complete, ${eventsToCache.length} events`);
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (loading) {
          loading = false;
          if (subscription) {
            subscription.stop();
            subscription = null;
          }
          if (articles.length > 0 && !cover) {
            const coverArticles = foodOnly
              ? articles.filter(a => isValidLongformArticle(a.event))
              : articles;
            if (coverArticles.length >= 1) {
              cover = curateCover(coverArticles, forceRefresh);
            }
          }
          if (eventsToCache.length > 0 && browser) {
            cacheFeedEvents(eventsToCache).catch(() => {});
          }
        }
      }, 15000);
    } catch (error) {
      console.error('[Reads] Error in direct relay fetch:', error);
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
          <h1 class="text-3xl md:text-4xl font-bold" style="color: var(--color-text-primary);">
            Reads
          </h1>
        </div>

        <div class="flex items-center gap-3 flex-shrink-0">
          <!-- Write Article Button (only when signed in) -->
          {#if isSignedIn}
            <button
              class="write-article-btn"
              on:click={openNewDraft}
              aria-label="Write article"
            >
              <PencilSimpleLineIcon size={18} />
              <span>Write</span>
            </button>

            <!-- My Drafts Button -->
            <a
              href="/drafts"
              class="drafts-link"
              aria-label="My Drafts"
            >
              <FolderIcon size={18} />
              <span>Drafts</span>
              {#if draftCount > 0}
                <span class="draft-badge">{draftCount}</span>
              {/if}
            </a>
          {/if}

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

  .write-article-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.875rem;
    border-radius: 9999px;
    background: linear-gradient(135deg, #f97316, #f59e0b);
    color: white;
    font-size: 0.875rem;
    font-weight: 600;
    transition: all 0.15s ease;
    box-shadow: 0 4px 12px rgba(249, 115, 22, 0.25);
  }

  .write-article-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(249, 115, 22, 0.35);
  }

  .drafts-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    border-radius: 9999px;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.15s ease;
    text-decoration: none;
  }

  .drafts-link:hover {
    background: var(--color-accent-gray);
    color: var(--color-text-primary);
    border-color: var(--color-text-secondary);
  }

  .draft-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.375rem;
    background: var(--color-primary);
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 9999px;
  }

  @media (max-width: 640px) {
    .write-article-btn span,
    .drafts-link span {
      display: none;
    }

    .write-article-btn,
    .drafts-link {
      padding: 0.5rem;
      border-radius: 9999px;
    }
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
