<script lang="ts">
  import FoodstrFeedOptimized from '../../components/FoodstrFeedOptimized.svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';
  import GroupList from '$lib/components/groups/GroupList.svelte';
  import GroupThread from '$lib/components/groups/GroupThread.svelte';
  import CreateGroupModal from '$lib/components/groups/CreateGroupModal.svelte';
  import {
    initGroupSubscription,
    groupsInitialized,
    groupsLoading,
    groupsInitAnonymous,
    setActiveGroup,
    clearGroups
  } from '$lib/stores/groups';

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
  // Default to global — faster load, more variety on login
  let activeTab: FilterMode = 'global';

  // Check if user has active membership (for Pantry tab)
  let hasActiveMembership = false;
  let checkingMembership = false;

  // Key to force component recreation
  let feedKey = 0;

  // Groups state (for Pantry tab)
  let selectedGroupId: string | null = null;
  let createGroupOpen = false;

  $: showThread = selectedGroupId !== null;
  $: isLoggedIn = !!$userPublickey;

  function handleSelectGroup(e: CustomEvent<{ groupId: string }>) {
    selectedGroupId = e.detail.groupId;
  }

  function handleBack() {
    selectedGroupId = null;
    setActiveGroup(null);
  }

  function handleCreateGroup() {
    createGroupOpen = true;
  }

  function handleGroupCreated(e: CustomEvent<{ groupId: string }>) {
    selectedGroupId = e.detail.groupId;
  }

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

    // Show tabs when scrolling up or near top
    if (currentScrollY < scrollThreshold) {
      tabsVisible = true;
    } else if (!scrollingDown) {
      // Scrolling up - show tabs immediately
      tabsVisible = true;
    } else if (scrollingDown && currentScrollY > scrollThreshold) {
      // Scrolling down - hide tabs
      tabsVisible = false;
    }

    lastScrollY = currentScrollY;

    // Always reset the "show after scroll stops" timeout
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }

    // Show tabs after scrolling stops
    scrollTimeout = setTimeout(() => {
      tabsVisible = true;
    }, 400);
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

    // Signed out: default to garden tab (following is disabled when signed out)
    if (!$userPublickey && (activeTab === 'following' || !tab)) {
      activeTab = 'garden';
      goto('/community?tab=garden', { noScroll: true, replaceState: true });
    }

    if ($userPublickey) {
      checkMembership();
    }

    // Initialize group subscription for Pantry tab
    if (browser && !$groupsInitialized && !$groupsLoading) {
      initGroupSubscription($ndk, $userPublickey || undefined);
    }

    // Setup scroll listener for tab fade
    if (typeof window !== 'undefined') {
      // Find the scrollable container (app-scroll from layout)
      scrollContainer = document.getElementById('app-scroll');

      if (scrollContainer) {
        // Initialize lastScrollY with current position
        lastScrollY = scrollContainer.scrollTop;

        // Simple scroll handler with requestAnimationFrame throttling
        let ticking = false;
        throttledScrollHandler = () => {
          if (!ticking) {
            ticking = true;
            window.requestAnimationFrame(() => {
              handleScroll();
              ticking = false;
            });
          }
        };

        scrollContainer.addEventListener('scroll', throttledScrollHandler, { passive: true });
      }
    }
  });

  // Re-initialize groups when user logs in after anonymous browsing
  $: if (browser && isLoggedIn && $groupsInitialized && $groupsInitAnonymous) {
    clearGroups();
    initGroupSubscription($ndk, $userPublickey!);
  }

  onDestroy(() => {
    // Cleanup scroll listener and timeout
    if (scrollContainer && throttledScrollHandler) {
      scrollContainer.removeEventListener('scroll', throttledScrollHandler);
    }
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
    setActiveGroup(null);
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
  <div class="px-4 max-w-2xl mx-auto community-page w-full">
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
      class="mb-4 border-b tabs-container transition-all duration-300 ease-in-out"
      style="border-color: var(--color-input-border); opacity: {tabsVisible
        ? 1
        : 0}; pointer-events: {tabsVisible ? 'auto' : 'none'}; transform: translateY({tabsVisible
        ? '0'
        : '-10px'});"
    >
      <div class="flex overflow-x-auto flex-nowrap scrollbar-hide">
        <button
          on:click={() => setTab('global')}
          class="flex-1 py-2 text-sm font-medium transition-colors relative text-center"
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
          class="flex-1 py-2 text-sm font-medium transition-colors relative text-center"
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
          class="flex-1 py-2 text-sm font-medium transition-colors relative text-center"
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
          class="flex-1 py-2 text-sm font-medium transition-colors relative text-center"
          style="color: {activeTab === 'members'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          Groups
          {#if activeTab === 'members'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>

        <button
          on:click={() => setTab('garden')}
          class="flex-1 py-2 text-sm font-medium transition-colors relative text-center"
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

    <!-- Pantry tab: Groups UI -->
    {#if activeTab === 'members'}
      <div
        class="flex rounded-xl overflow-hidden border"
        style="height: calc(100vh - 10rem); border-color: var(--color-input-border); background-color: var(--color-bg-secondary);"
      >
        <!-- Group List (left panel) -->
        <div
          class="w-full lg:w-80 xl:w-96 flex-shrink-0 border-r {showThread
            ? 'hidden lg:block'
            : 'block'}"
          style="border-color: var(--color-input-border); background-color: var(--color-bg-primary);"
        >
          <GroupList
            {selectedGroupId}
            {isLoggedIn}
            on:select={handleSelectGroup}
            on:createGroup={handleCreateGroup}
          />
        </div>

        <!-- Group Thread (right panel) -->
        <div
          class="flex-1 min-w-0 {showThread ? 'block' : 'hidden lg:block'}"
          style="background-color: var(--color-bg-primary);"
        >
          {#if selectedGroupId}
            <GroupThread groupId={selectedGroupId} {isLoggedIn} on:back={handleBack} />
          {:else}
            <div class="flex items-center justify-center h-full">
              <p class="text-sm" style="color: var(--color-caption);">
                {isLoggedIn ? 'Select a group or create a new one.' : 'Select a group to view.'}
              </p>
            </div>
          {/if}
        </div>
      </div>

      {#if isLoggedIn}
        <CreateGroupModal bind:open={createGroupOpen} on:created={handleGroupCreated} />
      {/if}
    {:else}
      {#key feedKey}
        <FoodstrFeedOptimized bind:this={feedComponent} filterMode={activeTab} />
      {/key}
    {/if}
  </div>
</PullToRefresh>

<style>
  /* Keep relay tabs pinned below the glass header */
  .tabs-container {
    position: sticky;
    /* Position below the glass header (~60px on desktop) */
    top: 60px;
    z-index: 15; /* Below header (z-20) but above content */
    /* Frosted glass effect - matches header */
    /* Fallback for browsers that don't support color-mix */
    background-color: var(--color-bg-primary);
    background-color: color-mix(in srgb, var(--color-bg-primary) 70%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    padding-top: 0.5rem;
    padding-bottom: 0.25rem;
    /* Smooth transitions for show/hide */
    transition:
      opacity 0.3s ease-in-out,
      transform 0.3s ease-in-out;
    will-change: opacity, transform;
  }

  /* On mobile, account for safe area inset that the header uses */
  @media (max-width: 1023px) {
    .tabs-container {
      top: calc(56px + env(safe-area-inset-top, 0px));
    }
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

</style>
