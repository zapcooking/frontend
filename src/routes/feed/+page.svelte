<script lang="ts">
  import FoodstrFeedOptimized from '../../components/FoodstrFeedOptimized.svelte';
  import FreshFeed from '../../components/FreshFeed.svelte';
  import { initialFeedTab, readStoredFeedTab, storeFeedTab, type FeedTab } from '$lib/feedTab';
  import { isLockedPasskeySession } from '$lib/sessionLock';
  import { getVaultRecord } from '$lib/passkeyVault';
  import { freshSession } from '$lib/freshFeed/session';
  import { prefetchFirstPage } from '$lib/freshFeed/firstPage';
  import MemoriesCard from '../../components/MemoriesCard.svelte';
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
  let feedComponent: { refresh(): Promise<void> };

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
  type FilterMode = FeedTab;

  // Signed-in features (Following) need an actual session. The stored
  // pubkey alone isn't one: a locked passkey vault keeps it while staying
  // unauthenticated until the user unlocks ($lib/sessionLock).
  function hasSignedInSession(): boolean {
    if (!$userPublickey) return false;
    if (!browser) return true;
    try {
      return !isLockedPasskeySession(localStorage, getVaultRecord() !== null);
    } catch {
      return true;
    }
  }

  // Decided before the first render (not in onMount), so the landing tab's
  // feed is the only one that starts loading: ?tab= wins, then the tab this
  // device last chose, then Fresh ($lib/feedTab).
  let activeTab: FilterMode = initialFeedTab(
    $page.url.searchParams.get('tab'),
    browser ? readStoredFeedTab() : null,
    hasSignedInSession()
  );

  // Fresh is the landing tab: start its first page now, while the rest of
  // the page hydrates and mounts, instead of when the feed mounts.
  if (browser && activeTab === 'fresh') prefetchFirstPage(freshSession().client);

  // Check if user has active membership (for Pantry tab)
  let hasActiveMembership = false;
  let checkingMembership = false;

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
    // Remember the reader's choice for next time (device-local).
    storeFeedTab(tab);

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
    // Signed out: Following is disabled; a ?tab=following link lands on Fresh.
    if (tab === 'following' && !hasSignedInSession()) {
      goto('/feed?tab=fresh', { noScroll: true, replaceState: true });
    }

    if ($userPublickey) {
      checkMembership();
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

  // Groups (the Pantry tab) start when that tab is open and the reader is
  // signed in — not on every /feed mount: the pantry relay refuses a
  // signed-out reader's requests (auth-required), so those were four
  // refused subscriptions per visit, plus a live one that never closed.
  // /groups has its own start. A reader who signs in after an anonymous
  // start (from /groups) gets a fresh, authenticated one here.
  $: if (browser && activeTab === 'members' && isLoggedIn) {
    if ($groupsInitialized && $groupsInitAnonymous) {
      clearGroups();
      initGroupSubscription($ndk, $userPublickey!);
    } else if (!$groupsInitialized && !$groupsLoading) {
      initGroupSubscription($ndk, $userPublickey!);
    }
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
  <!-- Fresh reads wss://feed.zap.cooking: resolve and connect early. -->
  <link rel="preconnect" href="https://feed.zap.cooking" crossorigin="anonymous" />
  <link rel="dns-prefetch" href="https://feed.zap.cooking" />
  <title>Community - zap.cooking</title>
  <meta
    name="description"
    content="Community - Share and discover delicious food content from the Nostr network"
  />
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
  <div class="px-4 max-w-2xl community-page w-full">
    <!-- Orientation text for signed-out users -->
    {#if $userPublickey === ''}
      <div class="mb-6 pt-4 pb-2">
        <p class="text-2xl font-semibold text-white">Food is Open Source ⚡</p>
        <p class="text-sm text-caption mt-2">
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
          on:click={() => setTab('fresh')}
          class="flex-1 py-2 text-sm font-medium transition-colors relative text-center"
          style="color: {activeTab === 'fresh'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          <span class="whitespace-nowrap"
            >Fresh<sup class="ml-0.5 text-[8px] font-semibold uppercase tracking-wide opacity-70"
              >Beta</sup
            ></span
          >
          {#if activeTab === 'fresh'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>

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
    {:else if activeTab === 'fresh'}
      <FreshFeed bind:this={feedComponent} />
    {:else}
      {#if $userPublickey}
        <MemoriesCard />
      {/if}
      <FoodstrFeedOptimized bind:this={feedComponent} filterMode={activeTab} />
    {/if}
  </div>
</PullToRefresh>

<style>
  /* Keep relay tabs pinned below the glass header */
  .tabs-container {
    position: sticky;
    /* top:0 — NOT var(--header-h). The scroll container (#app-scroll) already
       reserves the header height via padding-top: var(--header-h), and a
       sticky child's offset is measured from that container's content box
       (i.e. AFTER its padding). Setting top: var(--header-h) here would stack
       a second header-height on top, pinning the tabs at 2x the header height
       and leaving a header-tall gap that clips the top of the feed. top:0 pins
       the tabs flush at the bottom of the header on every breakpoint.
       -1px — slide 1px under the header (z-30, above this z-15) so sub-pixel
       rounding between the header's painted height and the sticky pin point
       can never leave a 1px sliver of scrolled-through content visible. */
    top: -1px;
    z-index: 15; /* Below header (z-30) but above content */
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
