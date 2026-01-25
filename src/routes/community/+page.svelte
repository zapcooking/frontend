<script lang="ts">
  import FoodstrFeedOptimized from '../../components/FoodstrFeedOptimized.svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import { userPublickey } from '$lib/nostr';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';

  // Pull-to-refresh refs
  let pullToRefreshEl: PullToRefresh;
  let feedComponent: FoodstrFeedOptimized;

  async function handleRefresh() {
    try {
      if (feedComponent) {
        await feedComponent.refresh();
      }
    } finally {
      // Always complete the pull-to-refresh, even if refresh throws
      pullToRefreshEl?.complete();
    }
  }

  export const data: PageData = {} as PageData;

  // Tab state - use local state for immediate reactivity
  type FilterMode = 'global' | 'following' | 'replies' | 'members' | 'garden';

  // Local state for immediate UI updates
  let activeTab: FilterMode = 'following';

  // Check if user has active membership (for Pantry tab)
  let hasActiveMembership = false;
  let checkingMembership = false;

  // Key to force component recreation
  let feedKey = 0;

  // Scroll-based fade state
  let tabsVisible = true;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastScrollY = 0;
  let scrollContainer: HTMLElement | null = null;
  let throttledScrollHandler: (() => void) | null = null;

  // Handle scroll for tab fade
  function handleScroll() {
    if (!scrollContainer) return;

    const currentScrollY = scrollContainer.scrollTop;
    const scrollingDown = currentScrollY > lastScrollY;
    const scrollThreshold = 10; // Minimum scroll distance to trigger fade

    // Show tabs when scrolling up or at top
    if (currentScrollY < scrollThreshold || !scrollingDown) {
      tabsVisible = true;
    } else if (scrollingDown && currentScrollY > scrollThreshold) {
      tabsVisible = false;
    }

    lastScrollY = currentScrollY;

    // Clear existing timeout
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }

    // Show tabs after scrolling stops
    scrollTimeout = setTimeout(() => {
      tabsVisible = true;
    }, 150);
  }

  async function setTab(tab: FilterMode) {
    if (tab === activeTab) return;

    activeTab = tab;
    feedKey++; // This forces component recreation with new filterMode

    // Update URL for bookmarking/sharing
    const url = new URL($page.url);
    url.searchParams.set('tab', tab);
    goto(url.pathname + url.search, { noScroll: true, replaceState: true });
  }

  // Check membership status
  async function checkMembership() {
    if (!$userPublickey || checkingMembership) return;

    checkingMembership = true;
    try {
      const res = await fetch('/api/membership/check-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey: $userPublickey })
      });

      if (res.ok) {
        const data = await res.json();
        hasActiveMembership = data.isActive === true;
      }
    } catch (err) {
      console.error('Failed to check membership:', err);
    } finally {
      checkingMembership = false;
    }
  }

  onMount(() => {
    const tab = $page.url.searchParams.get('tab');
    if (
      tab === 'following' ||
      tab === 'replies' ||
      tab === 'global' ||
      tab === 'members' ||
      tab === 'garden'
    ) {
      activeTab = tab;
    }

    if ($userPublickey) {
      checkMembership();
    }

    // Setup scroll listener for tab fade
    if (typeof window !== 'undefined') {
      // Find the scrollable container (app-scroll from layout)
      scrollContainer = document.getElementById('app-scroll');
      if (scrollContainer) {
        // Throttle scroll events for performance
        let ticking = false;
        throttledScrollHandler = () => {
          if (!ticking) {
            window.requestAnimationFrame(() => {
              handleScroll();
              ticking = false;
            });
            ticking = true;
          }
        };
        scrollContainer.addEventListener('scroll', throttledScrollHandler, { passive: true });
      }
    }
  });

  onDestroy(() => {
    // Cleanup scroll listener and timeout
    if (scrollContainer && throttledScrollHandler) {
      scrollContainer.removeEventListener('scroll', throttledScrollHandler);
    }
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
  });
</script>

<svelte:head>
  <title>Community - zap.cooking</title>
  <meta
    name="description"
    content="Community - Share and discover delicious food content from the Nostr network"
  />
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
  <div class="px-4 max-w-2xl mx-auto lg:mx-0 lg:max-w-4xl community-page overflow-x-hidden w-full">
    <!-- Orientation text for signed-out users -->
    {#if $userPublickey === ''}
      <div class="mb-4 pt-1">
        <p class="text-sm text-caption">Food. Friends. Freedom.</p>
        <p class="text-xs text-caption mt-0.5">
          People share meals, recipes, and food ideas here. <a
            href="/login"
            class="text-caption hover:opacity-80 underline">Sign in</a
          > to share your own and follow cooks you like.
        </p>
      </div>
    {/if}

    <!-- Filter Tabs -->
    <div 
      class="mb-4 border-b tabs-container transition-opacity duration-300" 
      style="border-color: var(--color-input-border); opacity: {tabsVisible ? 1 : 0}; pointer-events: {tabsVisible ? 'auto' : 'none'};"
    >
      <div class="flex overflow-x-auto flex-nowrap scrollbar-hide">
        <button
          on:click={() => setTab('global')}
          class="px-2.5 py-2 text-sm font-medium transition-colors relative flex-shrink-0"
          style="color: {activeTab === 'global'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          Global
          {#if activeTab === 'global'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>

        <button
          on:click={() => setTab('following')}
          class="px-2.5 py-2 text-sm font-medium transition-colors relative flex-shrink-0"
          style="color: {activeTab === 'following'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
          disabled={!$userPublickey}
          class:opacity-50={!$userPublickey}
          class:cursor-not-allowed={!$userPublickey}
          class:cursor-pointer={$userPublickey}
        >
          Following
          {#if activeTab === 'following'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>

        <button
          on:click={() => setTab('replies')}
          class="px-2.5 py-2 text-sm font-medium transition-colors relative flex-shrink-0"
          style="color: {activeTab === 'replies'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          Replies
          {#if activeTab === 'replies'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>

        <button
          on:click={() => setTab('members')}
          class="px-2.5 py-2 text-sm font-medium transition-colors relative flex-shrink-0"
          style="color: {activeTab === 'members'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          Pantry
          {#if activeTab === 'members'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>

        <button
          on:click={() => setTab('garden')}
          class="px-2.5 py-2 text-sm font-medium transition-colors relative flex-shrink-0"
          style="color: {activeTab === 'garden'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          Garden
          {#if activeTab === 'garden'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>
      </div>
    </div>

    <!-- Pantry Coming Soon overlay -->
    {#if activeTab === 'members'}
      <div class="relative">
        <!-- Coming Soon overlay -->
        <div class="coming-soon-overlay">
          <div class="coming-soon-card">
            <span class="text-3xl mb-2">🏪</span>
            <h3 class="text-xl font-bold mb-2" style="color: var(--color-text-primary)">
              The Pantry
            </h3>
            <p class="text-sm mb-4" style="color: var(--color-caption)">
              A members-only space for exclusive content and community discussions. Coming soon!
            </p>
            <a
              href="/pantry"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-white font-medium text-sm hover:opacity-90 transition-opacity"
            >
              Learn More
            </a>
          </div>
        </div>
        <!-- Feed in background (blurred) -->
        <div class="blur-sm opacity-30 pointer-events-none">
          {#key feedKey}
            <FoodstrFeedOptimized bind:this={feedComponent} filterMode={activeTab} />
          {/key}
        </div>
      </div>
    {:else}
      {#key feedKey}
        <FoodstrFeedOptimized bind:this={feedComponent} filterMode={activeTab} />
      {/key}
    {/if}
  </div>
</PullToRefresh>

<style>
  /* Keep relay tabs pinned; feed scrolls beneath them */
  .tabs-container {
    position: sticky;
    top: 0;
    z-index: 20;
    background-color: var(--color-bg-primary);
    padding-top: 0.5rem;
    margin-top: -0.5rem;
    /* Ensure full background coverage to prevent gaps */
    box-shadow: 0 2px 4px -2px rgba(0, 0, 0, 0.1);
  }

  /* Bottom padding to prevent fixed mobile nav from covering content */
  .community-page {
    padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  }

  /* Desktop doesn't need bottom nav spacing */
  @media (min-width: 768px) {
    .community-page {
      padding-bottom: 2rem;
    }
  }

  /* Hide scrollbar for tabs but allow scrolling */
  .scrollbar-hide {
    -ms-overflow-style: none; /* IE and Edge */
    scrollbar-width: none; /* Firefox */
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }

  /* Coming Soon overlay */
  .coming-soon-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
    display: flex;
    justify-content: center;
    padding-top: 4rem;
  }

  .coming-soon-card {
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 1rem;
    padding: 2rem;
    text-align: center;
    max-width: 320px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  }
</style>
