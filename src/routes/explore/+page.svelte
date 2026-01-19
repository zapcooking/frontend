<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { recipeTags, CURATED_TAG_SECTIONS, type recipeTagSimple } from '$lib/consts';
  import { computePopularTags, type TagWithCount } from '$lib/tagUtils';
  import {
    fetchCollectionsWithImages,
    fetchPopularCooks,
    fetchDiscoverRecipes,
    type Collection,
    type PopularCook
  } from '$lib/exploreUtils';
  import TagSectionCard from '../../components/TagSectionCard.svelte';
  import TagChip from '../../components/TagChip.svelte';
  import CollectionCard from '../../components/CollectionCard.svelte';
  import ProfileAvatar from '../../components/ProfileAvatar.svelte';
  import TrendingRecipeCard from '../../components/TrendingRecipeCard.svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { init, markOnce } from '$lib/perf/explorePerf';
  import { userPublickey } from '$lib/nostr';
  import type { PageData } from './$types';

  // Accept SvelteKit props to prevent warnings
  export let data: PageData;

  // Pull-to-refresh refs
  let pullToRefreshEl: PullToRefresh;

  // t0_explore_nav_start: Earliest point for the Explore route
  init();
  markOnce('t0_explore_nav_start');
  let popularTags: TagWithCount[] = [];
  let loadingPopular = true;
  let popularTagCounts = new Map<string, number>();

  // New data for Explore sections
  let collections: Collection[] = [];
  let popularCooks: PopularCook[] = [];
  let discoverRecipes: NDKEvent[] = [];
  let loadingCollections = true;
  let loadingCooks = true;
  let loadingDiscover = true;
  let cultureExpanded = false;

  // Compute section references reactively
  $: intentSection = CURATED_TAG_SECTIONS.find((s) => s.title === 'Why are you cooking?');
  $: cultureSection = CURATED_TAG_SECTIONS.find((s) => s.title === 'Explore by culture');
  $: collapsibleSections = CURATED_TAG_SECTIONS.filter(
    (s) => s.title !== 'Why are you cooking?' && s.title !== 'Explore by culture'
  );

  // t2_explore_first_content_rendered: When Explore renders its first recipe cards
  // Track when discoverRecipes first becomes non-empty (matches template condition)
  let t2Marked = false;
  $: if (!t2Marked && discoverRecipes?.length > 0) {
    markOnce('t2_explore_first_content_rendered');
    t2Marked = true;
  }

  async function loadExploreData() {
    // t1_explore_shell_rendered: When Explore UI shell is mounted
    markOnce('t1_explore_shell_rendered');

    // Reset loading states
    loadingCollections = true;
    loadingCooks = true;
    loadingDiscover = true;
    loadingPopular = true;

    // Load collections immediately (static data, no network)
    collections = await fetchCollectionsWithImages();
    loadingCollections = false;

    // Start discover recipes immediately (don't block on other data)
    fetchDiscoverRecipes(12).then((discoverData) => {
      discoverRecipes = discoverData;
      loadingDiscover = false;
    });

    // Load popular cooks (uses cache for instant load)
    fetchPopularCooks(12).then((cooksData) => {
      popularCooks = cooksData;
      loadingCooks = false;
    });

    // Load popular tags (non-blocking)
    computePopularTags(12).then((tags) => {
      popularTags = tags;
      popularTagCounts.clear();
      popularTags.forEach((tag) => {
        if (tag.count !== undefined) {
          popularTagCounts.set(tag.title, tag.count);
        }
      });
      loadingPopular = false;
    });
  }

  async function handleRefresh() {
    try {
      await loadExploreData();
      // Wait a bit for data to load
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      // Always complete the pull-to-refresh
      pullToRefreshEl?.complete();
    }
  }

  onMount(async () => {
    await loadExploreData();
  });

  function navigateToTag(tag: recipeTagSimple) {
    goto(`/tag/${tag.title}`);
  }

  function handleCollectionClick(collection: Collection) {
    if (collection.tag) {
      goto(`/tag/${collection.tag}`);
    }
  }

  function getSectionTags(sectionTitle: string): recipeTagSimple[] {
    const section = CURATED_TAG_SECTIONS.find((s) => s.title === sectionTitle);
    if (!section) return [];

    return section.tags
      .map((tagName) => recipeTags.find((t) => t.title === tagName))
      .filter((tag): tag is recipeTagSimple => tag !== undefined);
  }

  function getCultureTags(showAll: boolean): recipeTagSimple[] {
    const cultureSection = CURATED_TAG_SECTIONS.find((s) => s.title === 'Explore by culture');
    if (!cultureSection) return [];

    const allTags = cultureSection.tags
      .map((tagName) => recipeTags.find((t) => t.title === tagName))
      .filter((tag): tag is recipeTagSimple => tag !== undefined);

    return showAll ? allTags : allTags.slice(0, 10);
  }
</script>

<svelte:head>
  <title>Explore - zap.cooking</title>
  <meta name="description" content="Discover recipes, collections, and cooks on zap.cooking" />
  <meta property="og:url" content="https://zap.cooking/explore" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Explore - zap.cooking" />
  <meta
    property="og:description"
    content="Discover recipes, collections, and cooks on zap.cooking"
  />
  <meta property="og:image" content="https://zap.cooking/logo_with_text.png" />

  <meta name="twitter:card" content="summary" />
  <meta property="twitter:domain" content="zap.cooking" />
  <meta property="twitter:url" content="https://zap.cooking/explore" />
  <meta name="twitter:title" content="Explore - zap.cooking" />
  <meta
    name="twitter:description"
    content="Discover recipes, collections, and cooks on zap.cooking"
  />
  <meta property="twitter:image" content="https://zap.cooking/logo_with_text.png" />
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
  <div class="flex flex-col">
    <!-- Orientation text for signed-out users -->
    {#if $userPublickey === ''}
      <div class="mb-4 pt-1">
        <p class="text-sm text-gray-400">Curated recipes and popular cooks.</p>
        <p class="text-xs text-gray-300 mt-0.5">
          A starting point for discovering people and ideas.
        </p>
      </div>
    {/if}

    <!-- Explore Content -->
    <div class="flex flex-col gap-8">
      <!-- Top Collections -->
      <section class="flex flex-col gap-4">
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <span>📚</span>
          <span>Top Collections</span>
        </h2>
        {#if loadingCollections}
          <div class="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4">
            {#each Array(5) as _}
              <div class="flex-shrink-0 w-64 h-40 rounded-xl animate-pulse skeleton-bg"></div>
            {/each}
          </div>
        {:else if collections.length > 0}
          <div class="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide touch-pan-x">
            {#each collections as collection}
              <CollectionCard
                title={collection.title}
                subtitle={collection.subtitle}
                imageUrl={collection.imageUrl}
                onClick={() => handleCollectionClick(collection)}
              />
            {/each}
          </div>
        {/if}
      </section>

      <!-- Popular Cooks -->
      <section class="flex flex-col gap-4">
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <span>👨‍🍳</span>
          <span>Popular Cooks</span>
        </h2>
        {#if loadingCooks}
          <div class="flex gap-4 overflow-x-auto overflow-y-visible py-2 -mx-4 px-4">
            {#each Array(6) as _}
              <div class="flex-shrink-0 w-20 flex flex-col items-center gap-2">
                <div class="w-16 h-16 rounded-full animate-pulse skeleton-bg"></div>
                <div class="h-4 w-16 rounded animate-pulse skeleton-bg"></div>
              </div>
            {/each}
          </div>
        {:else if popularCooks.length > 0}
          <div
            class="flex gap-4 overflow-x-auto overflow-y-visible py-2 -mx-4 px-4 scrollbar-hide touch-pan-x"
          >
            {#each popularCooks as cook}
              <ProfileAvatar pubkey={cook.pubkey} showZapIndicator={false} />
            {/each}
          </div>
        {/if}
      </section>

      <!-- Fresh from the kitchen -->
      <section class="flex flex-col gap-4">
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <span>🍳</span>
          <span>Fresh from the kitchen</span>
        </h2>
        {#if loadingDiscover}
          <div class="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4">
            {#each Array(6) as _}
              <div class="flex-shrink-0 w-56 h-72 rounded-xl animate-pulse skeleton-bg"></div>
            {/each}
          </div>
        {:else if discoverRecipes.length > 0}
          <div class="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide touch-pan-x">
            {#each discoverRecipes.filter((r) => r && r.author?.pubkey) as recipe (recipe.id || recipe.created_at)}
              <TrendingRecipeCard event={recipe} />
            {/each}
          </div>
        {/if}
      </section>

      <!-- Hot Tags -->
      <section class="flex flex-col gap-4">
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <span>⭐</span>
          <span>Hot Tags</span>
        </h2>
        {#if loadingPopular}
          <div class="flex flex-wrap gap-2">
            {#each Array(10) as _}
              <div class="h-9 w-24 rounded-full animate-pulse skeleton-bg"></div>
            {/each}
          </div>
        {:else if popularTags.length > 0}
          <div class="flex flex-wrap gap-2">
            {#each popularTags.slice(0, 12) as tag}
              <TagChip
                {tag}
                count={popularTagCounts.get(tag.title)}
                onClick={() => navigateToTag(tag)}
              />
            {/each}
          </div>
        {/if}
      </section>

      <!-- Explore More (Below the fold) -->
      <div
        class="flex flex-col gap-6 pt-4 border-t"
        style="border-color: var(--color-input-border)"
      >
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <span>🔍</span>
          <span>Explore More</span>
        </h2>

        <!-- Intent Section -->
        {#if intentSection}
          <TagSectionCard
            emoji={intentSection.emoji}
            title={intentSection.title}
            helperText="Browse by intention, not ingredients."
            tags={getSectionTags(intentSection.title).slice(0, 8)}
            alwaysExpanded={true}
            previewCount={8}
            onTagClick={navigateToTag}
          />
        {/if}

        <!-- Culture Section -->
        {#if cultureSection}
          <div
            class="rounded-xl shadow-sm p-5 md:p-6 transition-all duration-300"
            style="border: 1px solid var(--color-input-border); background-color: var(--color-bg-secondary)"
          >
            <div class="flex items-start justify-between gap-4 mb-4">
              <div class="flex-1">
                <h2 class="text-2xl font-bold flex items-center gap-2 mb-1.5">
                  <span>{cultureSection.emoji}</span>
                  <span>{cultureSection.title}</span>
                </h2>
              </div>
              {#if getCultureTags(false).length < getCultureTags(true).length}
                <button
                  on:click={() => (cultureExpanded = !cultureExpanded)}
                  type="button"
                  class="flex-shrink-0 text-sm text-primary hover:text-[#d64000] transition-colors font-medium"
                >
                  {cultureExpanded ? 'Show less' : 'Show all cultures'}
                </button>
              {/if}
            </div>
            <div class="flex flex-wrap gap-2 transition-all duration-300">
              {#each getCultureTags(cultureExpanded) as tag (tag.title)}
                <TagChip {tag} onClick={() => navigateToTag(tag)} />
              {/each}
            </div>
          </div>
        {/if}

        <!-- Collapsible Sections -->
        {#each collapsibleSections as section}
          <TagSectionCard
            emoji={section.emoji}
            title={section.title}
            tags={getSectionTags(section.title)}
            alwaysExpanded={false}
            previewCount={8}
            onTagClick={navigateToTag}
          />
        {/each}
      </div>
    </div>
  </div>
</PullToRefresh>

<style>
  /* Hide scrollbar but keep functionality */
  :global(.scrollbar-hide) {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  :global(.scrollbar-hide::-webkit-scrollbar) {
    display: none;
  }

  /* Smooth horizontal scroll */
  :global(.scrollbar-hide) {
    scroll-behavior: smooth;
  }

  /* Mobile-first tap targets */
  @media (max-width: 640px) {
    button {
      min-height: 44px;
    }
  }
</style>
