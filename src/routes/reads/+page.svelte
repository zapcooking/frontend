<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { ndk, getCurrentRelayGeneration, userPublickey } from '$lib/nostr';
  import { NDKEvent as NDKEventClass, NDKRelaySet } from '@nostr-dev-kit/ndk';
  import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
  import CoverSection from '../../components/table/CoverSection.svelte';
  import FeedSection from '../../components/table/FeedSection.svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import {
    TOP_RELAY_FOOD_HASHTAGS,
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
  import { loadFollowListProfiles, getFollowedPubkeys, followListReady } from '$lib/followListCache';
  import { articleStore, addArticles as addToSharedStore, refreshCover as refreshSharedCover } from '$lib/articleStore';
  import { get } from 'svelte/store';
  import { fetchCuratedReads } from '$lib/reads/curatedReads';
  import { loadReadsSource, saveReadsSource, type ReadsSource } from '$lib/reads/readsSource';

  $: isSignedIn = $userPublickey !== '';
  $: draftCount = $drafts.length;

  // Load follows for "For You" ranking
  let followedPubkeys: Set<string> = new Set();
  $: if ($userPublickey) {
    loadFollowListProfiles().then(() => {
      followedPubkeys = getFollowedPubkeys();
    });
  }
  $: if ($followListReady) {
    followedPubkeys = getFollowedPubkeys();
  }

  // Two sources, kept in separate state so a late "All reads" callback can
  // never write into the curated view (and switching back keeps each one).
  //  - curated (default): the feed relay, trusted authors + its food rules.
  //  - all: the open hashtag search below (Primal + outbox), opt-in.
  let source: ReadsSource = 'curated';
  let allStarted = false;
  let curatedArticles: ArticleData[] = [];
  let curatedCover: CuratedCover | null = null;
  let curatedLoading = false;
  let curatedLoaded = false;
  let curatedComplete = true;
  let curatedRun = 0;

  let articles: ArticleData[] = [];
  let cover: CuratedCover | null = null;
  let loading = true;
  let loadingMore = false;
  let subscription: NDKSubscription | null = null;
  let seenEventIds = new Set<string>();
  let pullToRefreshEl: PullToRefresh;
  
  // Sync local articles to shared store (for explore page reuse)
  // Only sync newly added articles to avoid rebuilding on every update
  let lastSyncedArticleCount = 0;
  $: {
    if (articles.length > lastSyncedArticleCount) {
      const newArticles = articles.slice(lastSyncedArticleCount);
      if (newArticles.length > 0) {
        addToSharedStore(newArticles);
        refreshSharedCover();
      }
      lastSyncedArticleCount = articles.length;
    } else if (articles.length === 0) {
      lastSyncedArticleCount = 0;
    }
  }

  // Pagination tracking
  let oldestTimestamp: number | null = null;
  let hasMoreArticles = true;

  // Cache freshness tracking
  // Version key: bump when fetch strategy changes to invalidate stale cache
  const CACHE_VERSION = 'v2'; // v2: optimized relay hashtags + dynamic food toggle
  const CACHE_FRESHNESS_KEY = `zapcooking_reads_last_fetch_${CACHE_VERSION}`;
  const CACHE_FRESH_DURATION_MS = 3 * 60 * 1000; // 3 minutes - skip relay fetch if cache is this fresh
  const BACKGROUND_REFRESH_DELAY_MS = 5000; // Wait 5s after initial paint before background refresh

  // Primary fetch uses food hashtags to ensure cover + Food/Farming categories populate.
  // A parallel general fetch (no hashtags) fills other categories.
  function getFoodHashtags(): string[] {
    return TOP_RELAY_FOOD_HASHTAGS;
  }

  $: shownArticles = source === 'curated' ? curatedArticles : articles;
  $: shownCover = source === 'curated' ? curatedCover : cover;
  $: shownLoading = source === 'curated' ? curatedLoading && !curatedLoaded : loading;

  // Cover article IDs to exclude from feed
  $: coverArticleIds = shownCover
    ? [
        shownCover.hero?.id,
        ...(shownCover.secondary?.map((a) => a.id) || []),
        ...(shownCover.tertiary?.map((a) => a.id) || [])
      ].filter((id): id is string => !!id)
    : [];

  /** The curated tab: one anonymous REQ to the feed relay, never the open search. */
  async function loadCurated(forceRefresh: boolean = false) {
    const run = ++curatedRun;
    curatedLoading = true;
    const { events, complete } = await fetchCuratedReads();
    if (run !== curatedRun) return;
    const list: ArticleData[] = [];
    const seen = new Set<string>();
    for (const raw of events) {
      const event = new NDKEventClass($ndk ?? undefined, raw);
      const article = eventToArticleData(event, true);
      if (article && !seen.has(article.id)) {
        seen.add(article.id);
        list.push(article);
      }
    }
    list.sort((a, b) => b.publishedAt - a.publishedAt);
    curatedArticles = list;
    curatedCover = list.length ? curateCover(list, forceRefresh) : null;
    curatedComplete = complete;
    curatedLoading = false;
    curatedLoaded = true;
  }

  function startAll() {
    if (allStarted) return;
    allStarted = true;
    loadArticles();
  }

  function setSource(next: ReadsSource) {
    if (next === source) return;
    source = next;
    if (browser) saveReadsSource(localStorage, next);
    if (next === 'all') startAll();
    else if (!curatedLoaded) loadCurated();
  }

  // Process events into articles
  // Feed shows ALL articles, cover is always food-editorial
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
            const coverArticles = articles.filter(a => isValidLongformArticle(a.event));
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

    // Always fetch all articles - feed shows all, cover always food-editorial
    const cacheFilter = { kinds: [30023], hashtags: getFoodHashtags(), limit: 500 };

    // Try to hydrate from shared store first (e.g. if user visited /explore first)
    let cacheWasUsed = false;
    let cacheSufficient = false;

    if (!forceRefresh) {
      const shared = get(articleStore);
      if (shared.length > 0 && articles.length === 0) {
        for (const article of shared) {
          if (!seenEventIds.has(article.id)) {
            seenEventIds.add(article.id);
          }
        }
        articles = [...shared].sort((a, b) => b.publishedAt - a.publishedAt);
        lastSyncedArticleCount = articles.length;

        const coverArticles = articles.filter(a => isValidLongformArticle(a.event));
        if (coverArticles.length >= 1) {
          cover = curateCover(coverArticles, false);
        }
        loading = false;
        cacheWasUsed = true;
        cacheSufficient = true;

        if (articles.length > 0) {
          oldestTimestamp = Math.min(...articles.map(a => a.publishedAt));
        }
      }
    }

    // Try to load from IndexedDB cache for instant paint
    if (!forceRefresh && !cacheSufficient && browser) {
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
            const coverArticles = articles.filter(a => isValidLongformArticle(a.event));
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

    // If cache is fresh and sufficient, skip the primary food fetch
    // but still run the general fetch + background refresh so non-food categories populate
    if (cacheSufficient && isCacheFresh() && !forceRefresh) {
      if (import.meta.env.DEV) {
        console.log('[Reads] Cache is fresh, skipping primary food fetch');
      }

      const startGen = getCurrentRelayGeneration();

      // Non-food category fetch so Bitcoin/Nostr/Travel/etc. tabs aren't empty
      setTimeout(() => {
        if (getCurrentRelayGeneration() === startGen) {
          fetchNonFoodArticles(startGen);
        }
      }, 1000);

      // Schedule background refresh after delay
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
    // Primary: food-tagged articles for cover + Food/Farming categories
    fetchWithOutbox(forceRefresh, startGeneration);

    // Secondary: non-food articles (targeted category hashtags) for Bitcoin/Nostr/etc.
    // Runs in parallel, slightly delayed so food articles paint first
    setTimeout(() => {
      if (getCurrentRelayGeneration() === startGeneration) {
        fetchNonFoodArticles(startGeneration);
      }
    }, 2000);
  }

  // Non-food category hashtags (Bitcoin, Nostr, Travel, Philosophy, Health).
  // High-signal tags per category, kept under the ~25-tag relay cap. Using
  // targeted tags instead of an open firehose keeps off-topic longform (crime,
  // war news, sports, cross-posted blockchain spam) out of the feed and cache.
  const NON_FOOD_HASHTAGS = [
    'bitcoin', 'btc', 'lightning', 'sats',
    'nostr', 'grownostr', 'zap',
    'travel', 'adventure', 'wanderlust', 'roadtrip', 'backpacking',
    'philosophy', 'stoicism', 'mindfulness', 'meditation', 'ethics',
    'health', 'wellness', 'nutrition', 'fitness', 'exercise'
  ];

  // Fetch non-food category articles to fill the Bitcoin/Nostr/Travel/etc tabs
  async function fetchNonFoodArticles(startGeneration: number) {
    if (!$ndk || !browser) return;

    try {
      const newArticles: ArticleData[] = [];

      const { events } = await fetchArticles($ndk, {
        hashtags: NON_FOOD_HASHTAGS,
        limit: 500,
        skipPrimal: true,
        onEvent: (event: NDKEvent) => {
          if (getCurrentRelayGeneration() !== startGeneration) return;
          if (seenEventIds.has(event.id)) return;
          seenEventIds.add(event.id);

          const articleData = eventToArticleData(event, true);
          if (articleData) newArticles.push(articleData);
        }
      });

      // Process batch results
      for (const event of events) {
        if (getCurrentRelayGeneration() !== startGeneration) break;
        if (seenEventIds.has(event.id)) continue;
        seenEventIds.add(event.id);

        const articleData = eventToArticleData(event, true);
        if (articleData) newArticles.push(articleData);
      }

      // Merge and sort once
      if (newArticles.length > 0) {
        articles = [...articles, ...newArticles].sort((a, b) => b.publishedAt - a.publishedAt);
      }

      // Cache the non-food articles too
      if (events.length > 0 && browser) {
        cacheFeedEvents(events).catch(() => {});
      }
    } catch (err) {
      console.warn('[Reads] Non-food article fetch error:', err);
    }
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
        hashtags: getFoodHashtags(),
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
        const coverArticles = articles.filter(a => isValidLongformArticle(a.event));
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
        hashtags: getFoodHashtags(),
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
        const coverArticles = articles.filter(a => isValidLongformArticle(a.event));
        cover = curateCover(coverArticles, false);
      }
      
      // If still not enough food articles for cover, schedule another deep fetch
      if (foodArticleCount < 10 && stats.totalEvents > 0) {
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
        hashtags: getFoodHashtags(),
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
              const coverArticles = articles.filter(a => isValidLongformArticle(a.event));
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
        const coverArticles = articles.filter(a => isValidLongformArticle(a.event));
        if (coverArticles.length >= 1) {
          cover = curateCover(coverArticles, forceRefresh);
        } else {
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
      if (foodArticleCount < 10) {
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
      const filter: NDKFilter = {
        kinds: [30023],
        '#t': getFoodHashtags(),
        limit: 200,
        since: Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60) // Last 365 days
      };
      
      // Use specific relays known to work well for articles
      const articleRelays = [
        'wss://relay.primal.net',
        'wss://nos.lol',
        'wss://nostr.wine',
        'wss://antiprimal.net'
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
              const coverArticles = articles.filter(a => isValidLongformArticle(a.event));
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
          const coverArticles = articles.filter(a => isValidLongformArticle(a.event));
          if (coverArticles.length >= 1) {
            cover = curateCover(coverArticles, forceRefresh);
          } else {
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
            const coverArticles = articles.filter(a => isValidLongformArticle(a.event));
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
        hashtags: getFoodHashtags(),
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
    // The curated tab is the relay's whole archive in one answer: no paging.
    if (source === 'curated') return;
    loadMoreArticles();
  }

  async function handleRefresh() {
    try {
      if (source === 'curated') await loadCurated(true);
      else await loadArticles(true);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      pullToRefreshEl?.complete();
    }
  }

  function handleManualRefresh() {
    if (source === 'curated') loadCurated(true);
    else loadArticles(true);
  }

  onMount(() => {
    source = loadReadsSource(browser ? localStorage : null);
    // "All reads" (the open hashtag search) loads only when it's the chosen tab.
    if (source === 'all') startAll();
    else loadCurated();
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

          <!-- Refresh Button -->
          <button
            class="refresh-button p-2 rounded-full transition-all duration-200 hover:bg-accent-gray {shownLoading ? 'animate-spin' : ''}"
            style="color: var(--color-text-secondary);"
            on:click={handleManualRefresh}
            disabled={shownLoading}
            aria-label="Refresh articles"
          >
            <ArrowClockwiseIcon size={24} />
          </button>
        </div>
      </div>
    </header>

    <!-- Source: curated (feed relay) first; the open search is secondary -->
    <div class="reads-sources" role="tablist" aria-label="Reads source">
      <button
        type="button"
        role="tab"
        class="reads-source"
        class:active={source === 'curated'}
        aria-selected={source === 'curated'}
        on:click={() => setSource('curated')}
      >
        Curated
      </button>
      <button
        type="button"
        role="tab"
        class="reads-source reads-source-secondary"
        class:active={source === 'all'}
        aria-selected={source === 'all'}
        on:click={() => setSource('all')}
      >
        All reads
      </button>
    </div>
    {#if source === 'all'}
      <p class="reads-note">Everything tagged as food on Nostr, unfiltered.</p>
    {:else if curatedLoaded && curatedArticles.length === 0}
      <p class="reads-note">
        {#if curatedComplete}
          A quiet week in the kitchen.
        {:else}
          Curated reads couldn't load right now.
        {/if}
        <button type="button" class="reads-note-link" on:click={() => setSource('all')}>See All reads</button>
      </p>
    {/if}

    <!-- Cover Section -->
    <CoverSection cover={shownCover} loading={shownLoading} />

    <!-- Feed Section -->
    <FeedSection
      articles={shownArticles}
      loading={shownLoading}
      {coverArticleIds}
      loadingMore={source === 'curated' ? false : loadingMore}
      {followedPubkeys}
      {isSignedIn}
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

  .reads-sources {
    display: inline-flex;
    gap: 0.25rem;
    padding: 0.25rem;
    margin: -1rem 0 1.25rem;
    border-radius: 999px;
    background-color: var(--color-input-bg);
  }
  .reads-source {
    padding: 0.4rem 1rem;
    border-radius: 999px;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--color-text-secondary);
  }
  .reads-source.active {
    background-color: var(--color-bg-primary);
    color: var(--color-text-primary);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
  }
  /* The open search is the secondary choice: quieter, even when selected. */
  .reads-source-secondary {
    font-weight: 500;
  }
  .reads-note {
    margin: -0.5rem 0 1.25rem;
    font-size: 0.875rem;
    color: var(--color-caption);
  }
  .reads-note-link {
    margin-left: 0.25rem;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 2px;
    color: var(--color-text-primary);
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
