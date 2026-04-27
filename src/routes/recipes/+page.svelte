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
  </div>
</div>
</PullToRefresh>