<script lang="ts">
  import FoodstrFeedOptimized from '../../components/FoodstrFeedOptimized.svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import { userPublickey } from '$lib/nostr';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import PostComposer from '../../components/PostComposer.svelte';

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

  // Check if user has active membership (for Members tab)
  let hasActiveMembership = false;
  let checkingMembership = false;

  // Key to force component recreation
  let feedKey = 0;

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
  <div class="container mx-auto px-4 max-w-2xl community-page">
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

    <PostComposer {activeTab} />

    <!-- Filter Tabs -->
    <div class="mb-4 border-b" style="border-color: var(--color-input-border)">
      <div class="flex gap-1">
        <button
          on:click={() => setTab('global')}
          class="px-4 py-2 text-sm font-medium transition-colors relative"
          style="color: {activeTab === 'global'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          Global Food
          {#if activeTab === 'global'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>

        <button
          on:click={() => setTab('following')}
          class="px-4 py-2 text-sm font-medium transition-colors relative"
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
          class="px-4 py-2 text-sm font-medium transition-colors relative"
          style="color: {activeTab === 'replies'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          Notes & Replies
          {#if activeTab === 'replies'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>

        <!-- Members tab hidden for now - keeping functionality intact -->
        <!-- {#if hasActiveMembership}
        <button
          on:click={() => setTab('members')}
          class="px-4 py-2 text-sm font-medium transition-colors relative"
          style="color: {activeTab === 'members' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
        >
          Members
          {#if activeTab === 'members'}
            <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
          {/if}
        </button>
      {/if} -->

        <button
          on:click={() => setTab('garden')}
          class="px-4 py-2 text-sm font-medium transition-colors relative"
          style="color: {activeTab === 'garden'
            ? 'var(--color-text-primary)'
            : 'var(--color-text-secondary)'}"
        >
          The Garden
          {#if activeTab === 'garden'}
            <span
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"
            ></span>
          {/if}
        </button>
      </div>
    </div>

    <!-- Show login prompt for Following/Replies tabs if not logged in -->
    {#if (activeTab === 'following' || activeTab === 'replies') && !$userPublickey}
      <div
        class="mb-4 p-4 bg-accent-gray rounded-lg"
        style="border: 1px solid var(--color-input-border)"
      >
        <p class="text-sm" style="color: var(--color-text-primary)">
          <a href="/login" class="font-medium underline hover:opacity-80">Log in</a> to see {activeTab ===
          'following'
            ? 'posts from people you follow'
            : 'replies from people you follow'}.
        </p>
      </div>
    {/if}

    <!-- Members tab and membership prompt hidden for now -->
    <!-- Show membership prompt for Members tab if not a member -->
    <!-- {#if activeTab === 'members' && $userPublickey && !hasActiveMembership && !checkingMembership}
    <div class="mb-4 p-4 bg-accent-gray rounded-lg" style="border: 1px solid var(--color-input-border)">
      <p class="text-sm" style="color: var(--color-text-primary)">
        <a href="/membership" class="font-medium underline hover:opacity-80">Become a member</a> to access exclusive content from the private member community.
      </p>
    </div>
  {/if} -->

    {#key feedKey}
      <FoodstrFeedOptimized bind:this={feedComponent} filterMode={activeTab} />
    {/key}
  </div>
</PullToRefresh>

<style>
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
</style>
