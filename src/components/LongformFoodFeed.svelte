<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey, getCurrentRelayGeneration, ndkConnected } from '$lib/nostr';
  import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { NDKRelaySet } from '@nostr-dev-kit/ndk';
  import ArticleFeed from './ArticleFeed.svelte';
  import {
    TOP_RELAY_FOOD_HASHTAGS,
    isValidLongformArticle,
    isValidLongformArticleNoFoodFilter,
    eventToArticleData,
    type ArticleData
  } from '$lib/articleUtils';
  import { articleStore, foodArticles, addArticles } from '$lib/articleStore';

  let localArticles: ArticleData[] = [];
  let loading = true;
  let subscription: NDKSubscription | null = null;
  let seenEventIds = new Set<string>();

  // Use shared store if it already has food articles (from reads page visit)
  $: sharedFoodArticles = $foodArticles;
  $: if (sharedFoodArticles.length > 0 && localArticles.length === 0) {
    localArticles = sharedFoodArticles;
    loading = false;
  }

  // Display the best source — shared store or local fetch
  $: displayArticles = sharedFoodArticles.length > localArticles.length
    ? sharedFoodArticles
    : localArticles;

  // Format for ArticleFeed component
  $: formattedArticles = displayArticles
    .filter((a) => a.imageUrl) // Require images for explore display
    .slice(0, 20)
    .map((a) => ({
      event: a.event,
      imageUrl: a.imageUrl,
      title: a.title,
      preview: a.preview,
      readTime: a.readTimeMinutes,
      tags: a.tags,
      articleUrl: a.articleUrl
    }));

  async function loadLongformArticles() {
    const startGeneration = getCurrentRelayGeneration();

    if (!$ndk || !$ndkConnected) {
      loading = false;
      return;
    }

    // If shared store already has food articles, skip fetch
    if ($foodArticles.length >= 6) {
      loading = false;
      return;
    }

    if (subscription) {
      subscription.stop();
      subscription = null;
    }

    loading = true;
    seenEventIds.clear();

    try {
      const filter: NDKFilter = {
        kinds: [30023],
        '#t': TOP_RELAY_FOOD_HASHTAGS,
        limit: 100,
        since: Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60)
      };

      const articleRelays = [
        'wss://relay.primal.net',
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://nostr.wine',
        'wss://relay.nostr.band'
      ];
      const relaySet = NDKRelaySet.fromRelayUrls(articleRelays, $ndk, true);
      subscription = $ndk.subscribe(filter, { closeOnEose: true }, relaySet);

      subscription.on('event', (event: NDKEvent) => {
        if (getCurrentRelayGeneration() !== startGeneration) return;
        if (seenEventIds.has(event.id)) return;
        seenEventIds.add(event.id);

        const articleData = eventToArticleData(event, true);
        if (articleData && isValidLongformArticle(event)) {
          localArticles = [...localArticles, articleData]
            .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
            .sort((a, b) => b.publishedAt - a.publishedAt);

          // Also push to shared store so reads page benefits
          addArticles([articleData]);
        }
      });

      subscription.on('eose', () => {
        loading = false;
      });

      setTimeout(() => {
        if (loading) {
          loading = false;
          if (subscription) {
            subscription.stop();
            subscription = null;
          }
        }
      }, 10000);
    } catch (error) {
      console.error('Error loading longform articles:', error);
      loading = false;
    }
  }

  onMount(() => {
    loadLongformArticles();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
  });
</script>

<div class="flex flex-col gap-4">
  {#if loading && formattedArticles.length === 0}
    <div class="article-feed-horizontal">
      {#each Array(6) as _}
        <div class="article-card-skeleton-wrapper">
          <div class="article-card-skeleton rounded-lg overflow-hidden animate-pulse" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);">
            <div class="w-full h-48 bg-gray-200 dark:bg-gray-700"></div>
            <div class="p-5">
              <div class="h-6 w-3/4 rounded bg-gray-200 dark:bg-gray-700 mb-3"></div>
              <div class="flex items-center gap-2 mb-3">
                <div class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700"></div>
                <div class="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700"></div>
              </div>
              <div class="h-4 w-full rounded bg-gray-200 dark:bg-gray-700 mb-2"></div>
              <div class="h-4 w-5/6 rounded bg-gray-200 dark:bg-gray-700"></div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {:else if formattedArticles.length > 0}
    <ArticleFeed articles={formattedArticles} />
  {:else}
    <div class="text-center py-8 text-caption">
      <p>No longform articles found yet.</p>
      <p class="text-sm mt-2">Check back later for food-related articles, farming tips, and homesteading stories!</p>
    </div>
  {/if}
</div>

<style>
  .article-feed-horizontal {
    display: flex;
    gap: 24px;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 8px;
    -webkit-overflow-scrolling: touch;
    scroll-behavior: smooth;
    scrollbar-width: thin;
    scrollbar-color: var(--color-input-border) transparent;
  }

  .article-feed-horizontal::-webkit-scrollbar {
    height: 8px;
  }

  .article-feed-horizontal::-webkit-scrollbar-track {
    background: transparent;
  }

  .article-feed-horizontal::-webkit-scrollbar-thumb {
    background-color: var(--color-input-border);
    border-radius: 4px;
  }

  .article-feed-horizontal::-webkit-scrollbar-thumb:hover {
    background-color: var(--color-text-secondary);
  }

  .article-card-skeleton-wrapper {
    flex: 0 0 auto;
    width: 320px;
    height: 520px;
    display: flex;
  }

  .article-card-skeleton {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  @media (min-width: 768px) {
    .article-card-skeleton-wrapper {
      width: 360px;
      height: 540px;
    }
  }

  @media (min-width: 1200px) {
    .article-card-skeleton-wrapper {
      width: 380px;
      height: 560px;
    }
  }
</style>
