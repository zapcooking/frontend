<script lang="ts">
  import { ndk, userPublickey, getCurrentRelayGeneration, ensureNdkConnected } from '$lib/nostr';
  import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { onMount, onDestroy } from 'svelte';
  import Feed from '../../components/Feed.svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import { validateMarkdownTemplate } from '$lib/parser';
  import type { PageData } from './$types';
  import { RECIPE_TAGS } from '$lib/consts';
  import { feedCacheService } from '$lib/feedCache';

  export const data: PageData = {} as PageData;

  // Pull-to-refresh refs
  let pullToRefreshEl: PullToRefresh;
  let subscription: NDKSubscription | null = null;
  // Tracked so a new loadRecipes() (e.g. pull-to-refresh) or onDestroy can
  // cancel a pending safety timeout. Without this, a stale timeout from the
  // previous load fires during the next load while `loaded` is still false
  // after the reset and forces `loaded=true` prematurely.
  let loadTimeout: ReturnType<typeof setTimeout> | null = null;

  type TabType = 'recent';
  let activeTab: TabType = 'recent';
  let events: NDKEvent[] = [];
  let loaded = false;

  // Cache filter for consistent cache keys
  const cacheFilter = { kinds: [30023], '#t': RECIPE_TAGS };

  // ─── Pagination ──────────────────────────────────────────────────
  // The first page (loadRecipes) fetches 100 most-recent recipes via
  // the existing path. Once that lands, an IntersectionObserver on a
  // sentinel just below the feed fires loadMoreRecipes() to walk
  // backwards in time — `until: oldestCreatedAt - 1` — and append
  // older recipes 50 at a time until the relays return EOSE with no
  // new events.
  //
  // Cache layer is unchanged: only the first page is persisted via
  // feedCacheService. Subsequent pages re-fetch on every visit. This
  // keeps the cache bounded at the cost of re-walking history when a
  // user re-opens the page mid-deep-scroll. Acceptable for v1.
  const FOLLOWUP_PAGE_SIZE = 50;
  // Don't paginate until the first page has clearly landed. Without
  // this, a sentinel that's already in-viewport on a tiny initial
  // result set can fire a follow-up before EOSE on the first batch
  // even reaches us.
  const MIN_EVENTS_BEFORE_PAGINATION = 10;
  let loadingMore = false;
  let exhausted = false;
  // Bumped on every fresh load (mount / pull-to-refresh) so an
  // in-flight pagination request from a prior session can't write
  // its results into the new state.
  let paginationGeneration = 0;
  let sentinelEl: HTMLDivElement | null = null;
  let intersectionObserver: IntersectionObserver | null = null;

  // Sort events by created_at descending (most recent first)
  $: sortedEvents = [...events].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  $: displayEvents = sortedEvents;

  async function loadRecipes(skipCache = false) {
    const perfStart = performance.now();

    // Cancel any pending safety timeout from a prior load so it can't fire
    // during this load's `loaded=false` reset window and flip the flag early.
    if (loadTimeout) {
      clearTimeout(loadTimeout);
      loadTimeout = null;
    }

    // Invalidate any in-flight pagination so its results don't bleed
    // into this fresh load. Reset exhaustion + spinner so the sentinel
    // can re-fire once the first page settles.
    paginationGeneration++;
    loadingMore = false;
    exhausted = false;

    // Capture relay generation at start to detect stale data from relay switches
    const startGeneration = getCurrentRelayGeneration();

    try {
      // Wait for NDK to connect before subscribing. Mirrors /polls' pattern.
      // On SvelteKit client-side nav from another tab, NDK may already be
      // connected — this is a near no-op in that case.
      try {
        await ensureNdkConnected();
      } catch {
        console.warn('[Recent] NDK connection timed out, trying anyway');
      }

      if (!$ndk) {
        console.warn('NDK not available, skipping subscription');
        loaded = true;
        return;
      }
      
      // Stop existing subscription if any
      if (subscription) {
        subscription.stop();
        subscription = null;
      }
      
      // Check cache first (unless skipping for refresh)
      if (!skipCache) {
        try {
          const cached = await feedCacheService.getCachedFeed({
            filter: cacheFilter,
            backgroundRefresh: true // Will refresh in background if stale
          });
          
          if (cached && cached.length > 0) {
            // Check generation hasn't changed during cache fetch
            if (getCurrentRelayGeneration() !== startGeneration) {
              console.log('🚫 Relay changed during cache fetch, ignoring cached data');
            } else {
              // Filter cached events for valid recipes
              events = cached.filter(e => validateMarkdownTemplate(e.content) !== null);
              loaded = true;
              console.log(`⚡ Cache hit: ${events.length} recipes in ${(performance.now() - perfStart).toFixed(0)}ms`);
              return;
            }
          }
        } catch (cacheError) {
          console.warn('Cache read failed, falling back to network:', cacheError);
        }
      }
      
      // Reset state for network fetch
      events = [];
      loaded = false;
      
      // Reduced limit from 256 to 100 for faster EOSE
      let filter: NDKFilter = { limit: 100, kinds: [30023], '#t': RECIPE_TAGS };
      subscription = $ndk.subscribe(filter);
      
      const fetchedEvents: NDKEvent[] = [];

      subscription.on('event', (event: NDKEvent) => {
        // Ignore events from old relay generation (prevents stale data on relay switch)
        if (getCurrentRelayGeneration() !== startGeneration) {
          console.log('🚫 Ignoring event from old relay generation');
          return;
        }
        
        if (validateMarkdownTemplate(event.content) !== null) {
          fetchedEvents.push(event);
          events = [...fetchedEvents];

          // Progressive paint on FIRST valid event (was: >= 12). The old
          // threshold left the page stuck on skeleton if fewer than 12
          // recipes arrived before EOSE, or if EOSE fired during NDK's
          // cache-replay window and was lost to the race with handler
          // attach on SvelteKit client-side nav.
          if (!loaded) {
            loaded = true;
            console.log(`🚀 First paint: ${fetchedEvents.length} recipes in ${(performance.now() - perfStart).toFixed(0)}ms`);
          }
        }
      });

      subscription.on('eose', async () => {
        // Check generation before finalizing
        if (getCurrentRelayGeneration() !== startGeneration) {
          console.log('🚫 Relay changed during fetch, discarding results');
          return;
        }

        loaded = true;
        console.log(`📡 Network load complete: ${fetchedEvents.length} recipes in ${(performance.now() - perfStart).toFixed(0)}ms`);

        // Cache the fetched events for next time
        if (fetchedEvents.length > 0) {
          try {
            await feedCacheService.setCachedFeed(fetchedEvents, {
              filter: cacheFilter
            });
            console.log(`💾 Cached ${fetchedEvents.length} recipes`);
          } catch (cacheError) {
            console.warn('Failed to cache feed:', cacheError);
          }
        }
      });

      // Safety timeout: flip loaded after 10s if neither an event nor EOSE
      // reached us. Prevents a stuck skeleton when SvelteKit nav lands on
      // /recipes and NDK's cache replay emits before handlers can attach,
      // or when EOSE is otherwise delayed. Mirrors /polls' timeout pattern.
      // Tracked in `loadTimeout` so a subsequent loadRecipes() call or
      // onDestroy can cancel it.
      loadTimeout = setTimeout(() => {
        loadTimeout = null;
        if (!loaded) {
          console.warn(`[Recent] Load timeout after 10s with ${fetchedEvents.length} events, forcing loaded=true`);
          loaded = true;
        }
      }, 10000);

    } catch (error) {
      console.error(error);
      loaded = true;
    }
  }

  /**
   * Fetch older recipes by walking the `created_at` cursor backwards.
   * Single-flight (loadingMore guards re-entry), relay-generation +
   * paginationGeneration guards drop stale results from prior sessions
   * or relay swaps. EOSE with zero new events flips `exhausted` so the
   * sentinel stops firing.
   */
  async function loadMoreRecipes() {
    if (!$ndk || loadingMore || exhausted) return;
    if (!loaded) return;
    if (events.length < MIN_EVENTS_BEFORE_PAGINATION) return;

    // Find the oldest created_at currently displayed. `until` is
    // exclusive in some relay implementations and inclusive in others,
    // so we subtract 1 to be safe — we'd rather miss a duplicate event
    // (deduped by id below anyway) than fetch the same recipe twice.
    let oldest = Infinity;
    for (const e of events) {
      const ts = e.created_at || 0;
      if (ts && ts < oldest) oldest = ts;
    }
    if (!isFinite(oldest)) return;

    const startGeneration = getCurrentRelayGeneration();
    const localGen = ++paginationGeneration;
    loadingMore = true;

    const filter: NDKFilter = {
      kinds: [30023],
      '#t': RECIPE_TAGS,
      limit: FOLLOWUP_PAGE_SIZE,
      until: oldest - 1
    };

    let sub: NDKSubscription | null = null;
    let safetyTimeout: ReturnType<typeof setTimeout> | null = null;

    try {
      // closeOnEose so this subscription self-cleans after EOSE — we
      // don't need a long-lived sub for a one-off pagination fetch.
      sub = $ndk.subscribe(filter, { closeOnEose: true });
      const newEvents: NDKEvent[] = [];
      const seen = new Set(events.map((e) => e.id));

      sub.on('event', (event: NDKEvent) => {
        if (
          getCurrentRelayGeneration() !== startGeneration ||
          localGen !== paginationGeneration
        ) {
          return;
        }
        if (seen.has(event.id)) return;
        seen.add(event.id);
        if (validateMarkdownTemplate(event.content) !== null) {
          newEvents.push(event);
        }
      });

      await new Promise<void>((resolve) => {
        const finish = () => {
          if (safetyTimeout) {
            clearTimeout(safetyTimeout);
            safetyTimeout = null;
          }
          resolve();
        };
        sub!.on('eose', finish);
        // Safety: some relay sets never EOSE for a small window of
        // time. Cap the wait so the spinner can't spin forever.
        safetyTimeout = setTimeout(finish, 8000);
      });

      if (
        getCurrentRelayGeneration() !== startGeneration ||
        localGen !== paginationGeneration
      ) {
        return;
      }

      if (newEvents.length === 0) {
        exhausted = true;
        console.log('[Recipes] pagination exhausted — no older recipes returned');
      } else {
        events = [...events, ...newEvents];
        // Log the exact `until` we asked the relays for (oldest - 1) so
        // log lines line up with the actual subscription filter when
        // debugging "why didn't this older recipe come back?"
        console.log(
          `[Recipes] pagination +${newEvents.length} (total ${events.length}, oldest=${oldest}, until=${oldest - 1})`
        );
      }
    } catch (err) {
      console.warn('[Recipes] pagination failed:', err);
    } finally {
      try {
        sub?.stop();
      } catch {
        // Already stopped from closeOnEose — ignore.
      }
      if (safetyTimeout) clearTimeout(safetyTimeout);
      loadingMore = false;
    }
  }

  /** Tracks the DOM node we're currently observing so we can detect when
   *  Svelte has remounted the sentinel (pull-to-refresh sets loaded=false
   *  → {#if} unmounts → bind:this nulls → loaded flips back true → new
   *  node → bind:this assigns a fresh reference) and re-observe it. */
  let observedSentinel: HTMLDivElement | null = null;

  function setupIntersectionObserver() {
    if (!sentinelEl) return;
    if (typeof IntersectionObserver === 'undefined') return;
    // Idempotent: if we're already observing the current sentinel, no-op.
    if (intersectionObserver && observedSentinel === sentinelEl) return;
    teardownIntersectionObserver();
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loadMoreRecipes();
          }
        }
      },
      // Pre-fetch when the sentinel is within 400px of the viewport so
      // the next page lands before the user actually hits the bottom.
      { rootMargin: '400px' }
    );
    intersectionObserver.observe(sentinelEl);
    observedSentinel = sentinelEl;
  }

  function teardownIntersectionObserver() {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    observedSentinel = null;
  }

  // Attach / re-attach the observer based on the current sentinel.
  // Pull-to-refresh and exhaustion both unmount the sentinel via the
  // {#if loaded && !exhausted} block, which nulls `sentinelEl`. Without
  // an explicit teardown branch the old observer would keep watching
  // a now-detached node and lazy-load would silently stop working
  // after the first refresh. Combining setup + teardown in one
  // reactive statement closes that gap and also handles the case where
  // the sentinel node is replaced (svelte unmount → remount produces
  // a new HTMLElement reference).
  $: if (loaded && events.length >= MIN_EVENTS_BEFORE_PAGINATION && sentinelEl) {
    if (observedSentinel !== sentinelEl) {
      setupIntersectionObserver();
    }
  } else if (intersectionObserver) {
    teardownIntersectionObserver();
  }

  async function handleRefresh() {
    try {
      // Skip cache on pull-to-refresh to get fresh data
      await loadRecipes(true);
      // Wait a bit for events to start coming in
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      // Always complete the pull-to-refresh
      pullToRefreshEl?.complete();
    }
  }

  onMount(() => {
    loadRecipes();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
    // Cancel a pending safety timeout so it can't fire on a destroyed
    // component and log a spurious warn.
    if (loadTimeout) {
      clearTimeout(loadTimeout);
      loadTimeout = null;
    }
    // Detach the lazy-load observer so it doesn't fire callbacks
    // against a destroyed component on SPA back-nav.
    teardownIntersectionObserver();
    // Bumping the generation invalidates any in-flight pagination
    // promise so it short-circuits before mutating freed state.
    paginationGeneration++;
  });
</script>

<svelte:head>
  <title>Recipes - zap.cooking</title>
  <meta name="description" content="Browse all recipes on zap.cooking" />
  <meta property="og:url" content="https://zap.cooking/recipes" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Recipes - zap.cooking" />
  <meta property="og:description" content="Browse all recipes on zap.cooking" />
  <meta property="og:image" content="https://zap.cooking/social-share.png" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content="https://zap.cooking/recipes" />
  <meta name="twitter:title" content="Recipes - zap.cooking" />
  <meta name="twitter:description" content="Browse all recipes on zap.cooking" />
  <meta property="twitter:image" content="https://zap.cooking/social-share.png" />
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
<div class="flex flex-col gap-4 max-w-full md:max-w-none">
  <!-- Header with toggle -->
  <div class="flex flex-col gap-3">
    <!-- Tabs -->
    <div class="flex w-full border-b" style="border-color: var(--color-input-border)">
      <button
        on:click={() => { activeTab = 'recent'; }}
        class="flex-1 py-2.5 text-sm font-medium transition-colors relative cursor-pointer text-center"
        style="color: {activeTab === 'recent' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
      >
        Recipes
        {#if activeTab === 'recent'}
          <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
        {/if}
      </button>
      <a
        href="/packs"
        class="flex-1 py-2.5 text-sm font-medium transition-colors relative cursor-pointer text-center"
        style="color: var(--color-text-secondary)"
      >
        Packs
      </a>
      <a
        href="/premium"
        class="flex-1 py-2.5 text-sm font-medium transition-colors relative cursor-pointer text-center"
        style="color: var(--color-text-secondary)"
      >
        Premium ⚡️
      </a>
    </div>

    <!-- Orientation text for signed-out users -->
    {#if $userPublickey === ''}
      <div class="pt-1">
        <p class="text-sm text-caption">
          Latest recipes, freshly published.
        </p>
      </div>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    <Feed events={displayEvents} hideHide={true} {loaded} />

    {#if loaded && !exhausted}
      <!-- Sentinel: when this scrolls into view (or within 400px of it)
           the IntersectionObserver fires loadMoreRecipes(). The spinner
           inside is a visible signal during the fetch; the empty state
           when not loadingMore keeps the sentinel measurable so the
           observer can detect intersection. -->
      <div
        bind:this={sentinelEl}
        class="py-6 flex items-center justify-center text-caption text-sm"
      >
        {#if loadingMore}
          <div
            class="w-5 h-5 rounded-full border-2 border-orange-200 border-t-orange-500 animate-spin mr-2"
          ></div>
          <span>Loading more recipes…</span>
        {/if}
      </div>
    {:else if exhausted && events.length > 0}
      <p class="py-6 text-center text-xs text-caption">
        That's every recipe we know about. ⚡️
      </p>
    {/if}
  </div>
</div>
</PullToRefresh>