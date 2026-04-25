<script lang="ts">
  import { browser } from '$app/environment';
  import { ndk, ndkReady, userPublickey } from '$lib/nostr';
  import { get } from 'svelte/store';
  import FoodstrFeedOptimized from '../../components/FoodstrFeedOptimized.svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';

  // Pull-to-refresh refs
  let pullToRefreshEl: PullToRefresh;
  let feedComponent: FoodstrFeedOptimized;

  async function handleRefresh() {
    try {
      if (feedComponent) {
        await feedComponent.refresh();
      }
    } finally {
      pullToRefreshEl?.complete();
    }
  }

  // Tab state
  type FilterMode = 'global' | 'following' | 'replies';
  let activeTab: FilterMode = 'global';

  function setTab(tab: FilterMode) {
    if (tab === activeTab) return;
    activeTab = tab;
  }

</script>

<svelte:head>
  <title>The Kitchen - zap.cooking</title>
  <meta name="description" content="The Kitchen is Zap Cooking's primary public feed relay. Discover global food content, follow your favorite cooks, and engage with the community." />
  <meta property="og:url" content="https://zap.cooking/kitchen" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="The Kitchen - zap.cooking" />
  <meta property="og:description" content="The Kitchen is Zap Cooking's primary public feed relay. Discover global food content, follow your favorite cooks, and engage with the community." />
  <meta property="og:image" content="https://zap.cooking/logo_with_text.png" />

  <meta name="twitter:card" content="summary" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content="https://zap.cooking/kitchen" />
  <meta name="twitter:title" content="The Kitchen - zap.cooking" />
  <meta name="twitter:description" content="The Kitchen is Zap Cooking's primary public feed relay. Discover global food content, follow your favorite cooks, and engage with the community." />
  <meta property="twitter:image" content="https://zap.cooking/logo_with_text.png" />
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
<div class="container mx-auto px-4 max-w-2xl kitchen-page">
  <div class="flex flex-col gap-8">
    <!-- Hero Section -->
    <section class="flex flex-col gap-4">
      <div class="text-center py-8">
        <h1 class="text-4xl md:text-5xl font-bold mb-3" style="color: var(--color-text-primary)">
          The Kitchen 🍳
        </h1>
        <p class="text-xl md:text-2xl font-medium mb-2" style="color: var(--color-text-secondary)">
          Zap Cooking's primary public feed
        </p>
        <p class="text-base md:text-lg max-w-2xl mx-auto" style="color: var(--color-text-secondary)">
          Discover recipes, food posts, and culinary conversations from across Nostr. The Kitchen serves as our outbox relay for global food content, following, and replies.
        </p>
      </div>
    </section>

    <!-- Community Relays Card -->
    <section class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300" style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)">
      <h2 class="text-2xl font-bold mb-4 flex items-center gap-2" style="color: var(--color-text-primary)">
        <span>🔌</span>
        <span>Community Relays</span>
      </h2>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col sm:flex-row sm:items-center gap-2">
          <span class="font-medium text-sm" style="color: var(--color-text-secondary)">Garden Relay:</span>
          <code class="text-sm px-3 py-1.5 rounded bg-input-bg font-mono" style="color: var(--color-text-primary); border: 1px solid var(--color-input-border)">
            wss://garden.zap.cooking
          </code>
        </div>
        <p class="text-sm" style="color: var(--color-text-secondary)">
          Add this relay to your client for the best Zap Cooking experience. The Garden is our community relay for food content, recipes, and culinary conversations.
        </p>
      </div>
    </section>
  </div>

  <!-- Filter Tabs -->
  <div class="mb-4 border-b kitchen-tabs" style="border-color: var(--color-input-border)">
    <div class="flex gap-1">
      <button
        on:click={() => setTab('global')}
        class="px-4 py-2 text-sm font-medium transition-colors relative cursor-pointer"
        style="color: {activeTab === 'global' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
      >
        Global Food
        {#if activeTab === 'global'}
          <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
        {/if}
      </button>

      <button
        on:click={() => setTab('following')}
        class="px-4 py-2 text-sm font-medium transition-colors relative"
        style="color: {activeTab === 'following' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
        disabled={!$userPublickey}
        class:opacity-50={!$userPublickey}
        class:cursor-not-allowed={!$userPublickey}
        class:cursor-pointer={$userPublickey}
      >
        Following
        {#if activeTab === 'following'}
          <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
        {/if}
      </button>

      <button
        on:click={() => setTab('replies')}
        class="px-4 py-2 text-sm font-medium transition-colors relative cursor-pointer"
        style="color: {activeTab === 'replies' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
      >
        Notes & Replies
        {#if activeTab === 'replies'}
          <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
        {/if}
      </button>
    </div>
  </div>

  <!-- Show login prompt for Following tab if not logged in -->
  {#if activeTab === 'following' && !$userPublickey}
    <div class="mb-4 p-4 bg-accent-gray rounded-lg" style="border: 1px solid var(--color-input-border)">
      <p class="text-sm" style="color: var(--color-text-primary)">
        <a href="/login" class="font-medium underline hover:opacity-80">Log in</a> to see posts from people you follow.
      </p>
    </div>
  {/if}

  <FoodstrFeedOptimized bind:this={feedComponent} filterMode={activeTab} />
</div>
</PullToRefresh>

<style>
  /* Keep relay tabs pinned; feed scrolls beneath them */
  .kitchen-tabs {
    position: sticky;
    top: 0;
    z-index: 20;
    background-color: var(--color-bg-primary);
  }

  /* Bottom padding to prevent fixed mobile nav from covering content */
  .kitchen-page {
    padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  }
  
  /* Desktop doesn't need bottom nav spacing */
  @media (min-width: 768px) {
    .kitchen-page {
      padding-bottom: 2rem;
    }
  }
</style>
