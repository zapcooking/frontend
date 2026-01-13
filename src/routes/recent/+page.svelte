<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { onMount, onDestroy } from 'svelte';
  import Feed from '../../components/Feed.svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import { validateMarkdownTemplate } from '$lib/parser';
  import type { PageData } from './$types';
  import TagsSearchAutocomplete from '../../components/TagsSearchAutocomplete.svelte';
  import { goto } from '$app/navigation';
  import { RECIPE_TAGS } from '$lib/consts';

  export const data: PageData = {} as PageData;

  // Pull-to-refresh refs
  let pullToRefreshEl: PullToRefresh;
  let subscription: NDKSubscription | null = null;

  type TabType = 'recent' | 'all';
  let activeTab: TabType = 'recent';
  let events: NDKEvent[] = [];
  let allEvents: NDKEvent[] = [];
  let loaded = false;
  let showSearch = false;

  // Sort events by created_at descending (most recent first)
  $: sortedEvents = [...events].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  
  // For "All" tab, we show the same events but with search visible
  $: displayEvents = sortedEvents;

  function openTag(query: string) {
    showSearch = false;
    if (query.startsWith('npub')) {
      goto(`/user/${query}`);
    } else if (query.startsWith('naddr')) {
      goto(`/recipe/${query}`);
    } else {
      goto(`/tag/${query}`);
    }
  }

  function loadRecipes() {
    try {
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
      
      // Reset state
      events = [];
      loaded = false;
      
      let filter: NDKFilter = { limit: 256, kinds: [30023], '#t': RECIPE_TAGS };
      subscription = $ndk.subscribe(filter);

      subscription.on('event', (event: NDKEvent) => {
        if (validateMarkdownTemplate(event.content) !== null) {
          events = [...events, event];
        }
      });

      subscription.on('eose', () => {
        loaded = true;
        console.log('End of stored events');
      });

    } catch (error) {
      console.error(error);
      loaded = true;
    }
  }

  async function handleRefresh() {
    try {
      loadRecipes();
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
  });
</script>

<svelte:head>
  <title>Recipes - zap.cooking</title>
  <meta name="description" content="Browse all recipes on zap.cooking" />
  <meta property="og:url" content="https://zap.cooking/recent" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Recipes - zap.cooking" />
  <meta property="og:description" content="Browse all recipes on zap.cooking" />
  <meta property="og:image" content="https://zap.cooking/social-share.png" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content="https://zap.cooking/recent" />
  <meta name="twitter:title" content="Recipes - zap.cooking" />
  <meta name="twitter:description" content="Browse all recipes on zap.cooking" />
  <meta property="twitter:image" content="https://zap.cooking/social-share.png" />
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
<div class="flex flex-col gap-4 max-w-full md:max-w-none">
  <!-- Header with toggle -->
  <div class="flex flex-col gap-3">
    <!-- Tabs -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex gap-1 border-b" style="border-color: var(--color-input-border)">
        <button
          on:click={() => { activeTab = 'recent'; showSearch = false; }}
          class="px-4 py-2 text-sm font-medium transition-colors relative cursor-pointer"
          style="color: {activeTab === 'recent' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
        >
          Recent
          {#if activeTab === 'recent'}
            <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
          {/if}
        </button>
        <button
          on:click={() => { activeTab = 'all'; showSearch = true; }}
          class="px-4 py-2 text-sm font-medium transition-colors relative cursor-pointer"
          style="color: {activeTab === 'all' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'}"
        >
          All
          {#if activeTab === 'all'}
            <span class="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 to-amber-500"></span>
          {/if}
        </button>
      </div>
    </div>

    <!-- Search bar (shown on All tab) -->
    {#if activeTab === 'all'}
      <div class="max-w-md">
        <TagsSearchAutocomplete
          placeholderString={"Search recipes, tags, or users..."}
          action={openTag}
        />
      </div>
    {/if}

    <!-- Orientation text for signed-out users -->
    {#if $userPublickey === ''}
      <div class="pt-1">
        <p class="text-sm text-caption">
          {#if activeTab === 'recent'}
            Latest recipes, freshly published.
          {:else}
            All recipes, shared openly. Search by name, tag, or cook.
          {/if}
        </p>
      </div>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    <Feed events={displayEvents} hideHide={true} {loaded} />
  </div>
</div>
</PullToRefresh>