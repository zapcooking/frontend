<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { recipeTags, CURATED_TAG_SECTIONS, type recipeTagSimple } from '$lib/consts';
  import {
    fetchCollectionsWithImages,
    fetchPopularCooks,
    fetchDiscoverRecipes,
    type Collection,
    type PopularCook
  } from '$lib/exploreUtils';
  import TagChip from '../../components/TagChip.svelte';
  import CollectionCard from '../../components/CollectionCard.svelte';
  import ProfileAvatar from '../../components/ProfileAvatar.svelte';
  import TrendingRecipeCard from '../../components/TrendingRecipeCard.svelte';
  import BoostedRecipeCard from '../../components/BoostedRecipeCard.svelte';
  import SponsorBanner from '../../components/SponsorBanner.svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';
  import LongformFoodFeed from '../../components/LongformFoodFeed.svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { init, markOnce } from '$lib/perf/explorePerf';
  import { userPublickey, ensureNdkConnected } from '$lib/nostr';
  import { membershipStatusMap, queueMembershipLookup, type MembershipStatus } from '$lib/stores/membershipStatus';
  import { cookingToolsOpen, cookingToolsStore } from '$lib/stores/cookingToolsWidget';
  import { browser } from '$app/environment';
  import type { PageData } from './$types';
  import { exploreNavTick } from '$lib/exploreNav';

  // Accept SvelteKit props to prevent warnings
  export let data: PageData;

  // One-time Cooking Tools tip (4.2 first-60-seconds improvement)
  const COOKING_TOOLS_TIP_KEY = 'zapcooking_cooking_tools_tip_seen';
  let showCookingToolsTip = false;
  let cookingToolsTipEl: HTMLDivElement | null = null;
  let tipPointerX = '2.5rem';
  let tipTop = '0.5rem';
  let tipPointerScheduled = false;
  if (browser) {
    showCookingToolsTip = localStorage.getItem(COOKING_TOOLS_TIP_KEY) !== '1';
  }
  function dismissCookingToolsTip() {
    showCookingToolsTip = false;
    if (browser) localStorage.setItem(COOKING_TOOLS_TIP_KEY, '1');
  }
  function openCookingTools() {
    cookingToolsStore.open('timer');
    dismissCookingToolsTip();
  }

  // Portal action to render the tip at document body level (above sticky header).
  function portal(node: HTMLElement) {
    document.body.appendChild(node);

    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    };
  }

  async function syncTipPointer() {
    if (!browser || !showCookingToolsTip || tipPointerScheduled) return;
    tipPointerScheduled = true;
    await tick();
    requestAnimationFrame(() => {
      tipPointerScheduled = false;
      updateTipPointer();
    });
  }

  function updateTipPointer() {
    if (!browser || !showCookingToolsTip || !cookingToolsTipEl) return;
    const anchor = document.querySelector<HTMLElement>('[data-cooking-tools-button]');
    if (!anchor) return;

    const tipRect = cookingToolsTipEl.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const anchorCenter = anchorRect.left + anchorRect.width / 2;
    const arrowOffset = 16;
    const rawPointerX = anchorCenter - tipRect.left;
    const minPointerX = 18;
    const maxPointerX = Math.max(minPointerX, tipRect.width - 18);

    tipTop = `${Math.max(anchorRect.bottom + arrowOffset, 8)}px`;
    tipPointerX = `${Math.min(Math.max(rawPointerX, minPointerX), maxPointerX)}px`;
  }

  $: if (showCookingToolsTip) {
    syncTipPointer();
  }

  $: if (showCookingToolsTip && $cookingToolsOpen) {
    dismissCookingToolsTip();
  }

  // Pull-to-refresh refs
  let pullToRefreshEl: PullToRefresh;

  // t0_explore_nav_start: Earliest point for the Explore route
  init();
  markOnce('t0_explore_nav_start');

  // New data for Explore sections
  let collections: Collection[] = [];
  let popularCooks: PopularCook[] = [];
  let discoverRecipes: NDKEvent[] = [];
  let boostedRecipes: { naddr: string; recipeTitle: string; recipeImage: string; authorPubkey: string; tier: string; expiresAt: number }[] = [];
  let sponsorBanners: { id: string; title: string; description: string; imageUrl: string; linkUrl: string }[] = [];
  let loadingCollections = true;
  let loadingCooks = true;
  let loadingDiscover = true;
  let cultureExpanded = false;

  $: cultureSection = CURATED_TAG_SECTIONS.find((s) => s.title === 'Explore by culture');

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
    // Load collections immediately (static data, no network)
    collections = await fetchCollectionsWithImages();
    loadingCollections = false;

    // Fetch boosted recipes (no relay needed, hits our API)
    fetch('/api/boost/active')
      .then((r) => (r.ok ? r.json() : { boosts: [] }))
      .then((data) => {
        boostedRecipes = data.boosts || [];
      })
      .catch(() => {
        boostedRecipes = [];
      });

    // Fetch headline sponsor banners
    fetch('/api/sponsor/active?tier=headline')
      .then((r) => (r.ok ? r.json() : { sponsors: [] }))
      .then((data) => {
        sponsorBanners = data.sponsors || [];
      })
      .catch(() => {
        sponsorBanners = [];
      });

    // Wait for at least one relay connection before firing subscription-based fetches.
    // Without this gate, cold loads race against NDK connection and can throw.
    await ensureNdkConnected();

    // Start discover recipes immediately (don't block on other data)
    fetchDiscoverRecipes(12).then((discoverData) => {
      discoverRecipes = discoverData;
      loadingDiscover = false;
    }).catch(() => {
      loadingDiscover = false;
    });

    // Load popular cooks (uses cache for instant load)
    fetchPopularCooks(12).then((cooksData) => {
      popularCooks = cooksData;
      loadingCooks = false;
    }).catch(() => {
      loadingCooks = false;
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

  onMount(() => {
    let cleanup: (() => void) | undefined;
    void (async () => {
    syncTipPointer();
    await loadExploreData();

    if (browser) {
      let ticking = false;
      const handleLayoutChange = () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(() => {
            syncTipPointer();
            ticking = false;
          });
        }
      };
      const scrollContainer = document.getElementById('app-scroll');
      window.addEventListener('resize', handleLayoutChange);
      scrollContainer?.addEventListener('scroll', handleLayoutChange, { passive: true });
      return () => {
        window.removeEventListener('resize', handleLayoutChange);
        scrollContainer?.removeEventListener('scroll', handleLayoutChange);
      };
    }
    })().then((result) => {
      cleanup = result;
    });

    return () => {
      cleanup?.();
    };
  });

  // Logo tap while on /explore → scroll to top + refresh
  let lastExploreTick = 0;
  $: if ($exploreNavTick !== lastExploreTick) {
    lastExploreTick = $exploreNavTick;
    if (browser) {
      const el = document.getElementById('app-scroll');
      if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
      void loadExploreData();
    }
  }

  // Membership status for teaser strip
  let exploreMembershipMap: Record<string, MembershipStatus> = {};
  const unsubExploreMembership = membershipStatusMap.subscribe((value) => {
    exploreMembershipMap = value;
  });

  $: if ($userPublickey) {
    queueMembershipLookup($userPublickey);
  }

  $: exploreMembershipStatus = $userPublickey ? exploreMembershipMap[$userPublickey.trim().toLowerCase()] : undefined;
  // Only show teaser once lookup has resolved (avoid flash for members)
  $: isNonMember = exploreMembershipStatus !== undefined && !exploreMembershipStatus.active;

  onDestroy(() => { unsubExploreMembership(); });

  function navigateToTag(tag: recipeTagSimple) {
    goto(`/tag/${tag.title}`);
  }

  function handleCollectionClick(collection: Collection) {
    if (collection.tag) {
      goto(`/tag/${collection.tag}`);
    }
  }

  function getCultureTags(showAll: boolean): recipeTagSimple[] {
    const cultureSection = CURATED_TAG_SECTIONS.find((s) => s.title === 'Explore by culture');
    if (!cultureSection) return [];

    const allTags = cultureSection.tags
      .map((tagName) => recipeTags.find((t) => t.title === tagName))
      .filter((tag): tag is recipeTagSimple => tag !== undefined);

    return showAll ? allTags : allTags.slice(0, 10);
  }

  $: allCultureTags = getCultureTags(true);
  $: visibleCultureTags = cultureExpanded ? allCultureTags : allCultureTags.slice(0, 10);
  $: hasMoreCultures = allCultureTags.length > 10;
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
        <p class="text-sm" style="color: var(--color-text-secondary);">
          Recipes, ideas, and cooks from around the network.
        </p>
      </div>
    {/if}

    <!-- Explore Content -->
    <div class="flex flex-col gap-8 sm:gap-14">
      <!-- Supported by our partners -->
      {#if sponsorBanners.length > 0}
        <section class="flex flex-col gap-3" data-section="partners">
          <h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">Supported by our partners</h2>
          {#if sponsorBanners.length === 1}
            <SponsorBanner
              title={sponsorBanners[0].title}
              description={sponsorBanners[0].description}
              imageUrl={sponsorBanners[0].imageUrl}
              linkUrl={sponsorBanners[0].linkUrl}
            />
          {:else}
            <div class="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide touch-pan-x">
              {#each sponsorBanners as sponsor (sponsor.id)}
                <div class="flex-shrink-0 sponsor-scroll-item">
                  <SponsorBanner
                    title={sponsor.title}
                    description={sponsor.description}
                    imageUrl={sponsor.imageUrl}
                    linkUrl={sponsor.linkUrl}
                  />
                </div>
              {/each}
            </div>
          {/if}
          <a
            href="/sponsors"
            class="text-xs font-medium transition-colors self-start"
            style="color: var(--color-primary);"
          >
            View Sponsors &rarr;
          </a>
        </section>
      {/if}

      <!-- Fresh from the Kitchen -->
      <section class="flex flex-col gap-4" data-section="fresh-kitchen">
        <h2 class="text-2xl font-bold flex items-center gap-2">
          <span>🍳</span>
          <span>Fresh from the Kitchen</span>
        </h2>
        {#if loadingDiscover}
          <div class="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4">
            {#each Array(6) as _}
              <div class="flex-shrink-0 w-56 h-72 rounded-xl animate-pulse skeleton-bg"></div>
            {/each}
          </div>
        {:else if discoverRecipes.length > 0}
          <div class="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide touch-pan-x">
            {#each boostedRecipes as boost (boost.naddr)}
              <BoostedRecipeCard
                naddr={boost.naddr}
                title={boost.recipeTitle}
                imageUrl={boost.recipeImage}
                authorPubkey={boost.authorPubkey}
              />
            {/each}
            {#each discoverRecipes.filter((r) => r && r.author?.pubkey) as recipe (recipe.id || recipe.created_at)}
              <TrendingRecipeCard event={recipe} />
            {/each}
          </div>
        {:else}
          <!-- Friendly empty state when network returns no recipes (4.2 improvement) -->
          <div
            class="flex flex-col items-center justify-center py-8 px-4 rounded-xl text-center"
            style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
          >
            <p class="text-sm text-caption max-w-xs">
              Recipes will appear here as the community shares. Try the <strong>Timer</strong> (pot
              icon above) or <strong>Collections</strong> below.
            </p>
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
          <div class="flex gap-4 overflow-x-auto pt-8 pb-4 -mt-6 -mx-4 px-4">
            {#each Array(6) as _}
              <div class="flex-shrink-0 w-20 flex flex-col items-center gap-2">
                <div class="w-16 h-16 rounded-full animate-pulse skeleton-bg"></div>
                <div class="h-4 w-16 rounded animate-pulse skeleton-bg"></div>
              </div>
            {/each}
          </div>
        {:else if popularCooks.length > 0}
          <div
            class="flex gap-4 overflow-x-auto pt-8 pb-4 -mt-6 -mx-4 px-4 scrollbar-hide touch-pan-x"
          >
            {#each popularCooks as cook}
              <ProfileAvatar pubkey={cook.pubkey} showZapIndicator={false} />
            {/each}
          </div>
        {/if}
      </section>

      <!-- Membership teaser — premium feel -->
      {#if !$userPublickey || isNonMember}
        <section class="membership-teaser" aria-label="Membership teaser">
          <div class="membership-teaser-glow"></div>
          <div class="relative z-10 text-center px-4 py-6">
            <p class="text-xs uppercase tracking-widest font-semibold mb-2" style="color: rgba(249,115,22,0.9);">
              Kitchen+
            </p>
            <h3 class="text-lg font-bold text-white">
              Unlock your kitchen
            </h3>
            <p class="text-sm mt-1.5 text-gray-300">
              AI tools, private groups, and more.
            </p>
            <a
              href="/membership"
              class="membership-teaser-cta"
            >
              Enter the Kitchen+
            </a>
          </div>
        </section>
      {/if}

      <!-- Food Stories & Articles -->
      <section class="flex flex-col gap-4">
        <div class="px-4 -mx-4 sm:px-0 sm:mx-0">
          <h2 class="text-2xl font-bold flex items-center gap-2">
            <span>📖</span>
            <span>Food Stories & Articles</span>
          </h2>
          <p class="text-sm text-caption">
            Recent longform articles about food, farming, homesteading, and food culture.
          </p>
        </div>
        <div class="-mx-4 px-4 sm:mx-0 sm:px-0">
          <LongformFoodFeed />
        </div>
      </section>

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

      <!-- What are you cooking? — Intent Cards -->
      <section class="flex flex-col gap-3">
        <h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">
          What are you cooking?
        </h2>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {#each [
            { emoji: '⚡', label: 'Quick', sub: 'Ready in 20 min', tag: 'Quick' },
            { emoji: '🌅', label: 'Breakfast', sub: 'Start your day right', tag: 'Breakfast' },
            { emoji: '🍰', label: 'Dessert', sub: 'Something sweet', tag: 'Dessert' },
            { emoji: '🍷', label: 'Drinks', sub: 'Something to sip', tag: 'Drinks' },
            { emoji: '🥗', label: 'Easy', sub: 'Simple & satisfying', tag: 'Easy' },
            { emoji: '🍜', label: 'Lunch', sub: 'Midday meals', tag: 'Lunch' },
            { emoji: '🍽️', label: 'Supper', sub: 'End the day well', tag: 'Supper' },
            { emoji: '🍿', label: 'Snack', sub: 'Quick bites', tag: 'Snack' }
          ] as card}
            <button
              type="button"
              class="intent-card"
              on:click={() => goto(`/tag/${card.tag}`)}
            >
              <span class="text-2xl">{card.emoji}</span>
              <span class="text-sm font-semibold" style="color: var(--color-text-primary);">{card.label}</span>
              <span class="text-[11px] leading-tight" style="color: var(--color-text-secondary);">{card.sub}</span>
            </button>
          {/each}
        </div>
      </section>

      <!-- Browse by Category — visual horizontal scroll -->
      <section class="flex flex-col gap-3">
        <h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">
          Browse by category
        </h2>
        <div class="flex gap-2.5 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide touch-pan-x">
          {#each [
            { emoji: '🥩', label: 'Beef' },
            { emoji: '🍗', label: 'Chicken' },
            { emoji: '🐟', label: 'Fish' },
            { emoji: '🌱', label: 'Vegan' },
            { emoji: '🍝', label: 'Pasta' },
            { emoji: '🍕', label: 'Pizza' },
            { emoji: '🥘', label: 'Soup' },
            { emoji: '🥪', label: 'Sandwich' },
            { emoji: '🍚', label: 'Rice' },
            { emoji: '🥚', label: 'Eggs' },
            { emoji: '🥔', label: 'Potato' },
            { emoji: '🧀', label: 'Cheese' }
          ] as cat}
            <button
              type="button"
              class="category-chip"
              on:click={() => goto(`/tag/${cat.label}`)}
            >
              <span class="text-xl">{cat.emoji}</span>
              <span class="text-xs font-medium" style="color: var(--color-text-primary);">{cat.label}</span>
            </button>
          {/each}
        </div>
      </section>

      <!-- Explore by Culture -->
      {#if cultureSection}
        <section class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">
              Explore by culture
            </h2>
            {#if hasMoreCultures}
              <button
                on:click={() => (cultureExpanded = !cultureExpanded)}
                type="button"
                class="text-xs font-medium transition-colors"
                style="color: var(--color-primary);"
              >
                {cultureExpanded ? 'Show less' : 'Show all'}
              </button>
            {/if}
          </div>
          <div class="flex flex-wrap gap-2">
            {#each visibleCultureTags as tag (tag.title)}
              <TagChip {tag} onClick={() => navigateToTag(tag)} />
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </div>
</PullToRefresh>

<!-- One-time Cooking Tools tip (4.2 first-60-seconds) -->
{#if showCookingToolsTip}
  <div use:portal>
    <div class="cooking-tools-tip-wrapper" aria-live="polite">
      <div
        bind:this={cookingToolsTipEl}
        class="flex items-start gap-3 p-4 cooking-tools-tip"
        style={`--tip-pointer-x: ${tipPointerX}; --tip-top: ${tipTop};`}
      >
        <span class="text-2xl flex-shrink-0" aria-hidden="true">🍳</span>
        <div class="flex-1 min-w-0">
          <p
            class="text-[11px] uppercase tracking-[0.14em] font-semibold mb-1"
            style="color: var(--color-text-secondary);"
          >
            Kitchen tip:
          </p>
          <p class="text-sm font-medium" style="color: var(--color-text-primary);">
            Tap the pot icon above for cooking timer & unit converter.
          </p>
          <div class="flex flex-wrap gap-2 mt-2">
            <button
              type="button"
              on:click={openCookingTools}
              class="text-sm font-medium px-3 py-1.5 rounded-full transition-colors"
              style="background-color: var(--color-primary); color: white;"
            >
              Try it
            </button>
            <button
              type="button"
              on:click={dismissCookingToolsTip}
              class="text-sm font-medium px-3 py-1.5 rounded-full transition-colors"
              style="color: var(--color-text-secondary);"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

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

  .cooking-tools-tip-wrapper {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 1000;
    --tip-bg: #ffffff;
    --tip-border: var(--color-input-border);
  }

  .cooking-tools-tip {
    position: absolute;
    top: var(--tip-top, 0.5rem);
    right: 0.75rem;
    max-width: min(260px, 78vw);
    border-radius: 18px;
    border: 2px solid var(--tip-border);
    background: var(--tip-bg);
    color: var(--color-text-primary);
    box-shadow:
      0 16px 28px rgba(18, 26, 33, 0.18),
      0 6px 12px rgba(18, 26, 33, 0.1);
    z-index: 1001;
    pointer-events: auto;
  }

  .cooking-tools-tip::before,
  .cooking-tools-tip::after {
    content: '';
    position: absolute;
    top: -16px;
    left: var(--tip-pointer-x, 2.5rem);
    transform: translateX(-50%);
    border-left: 14px solid transparent;
    border-right: 14px solid transparent;
  }

  .cooking-tools-tip::before {
    border-bottom: 16px solid var(--tip-border);
  }

  .cooking-tools-tip::after {
    top: -14px;
    border-bottom: 14px solid var(--tip-bg);
  }

  @media (max-width: 640px) {
    .cooking-tools-tip {
      max-width: min(240px, 90vw);
    }
  }

  :global(html.dark) .cooking-tools-tip-wrapper {
    --tip-bg: var(--color-bg-secondary);
    --tip-border: var(--color-input-border);
  }

  /* Intent cards */
  .intent-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    padding: 0.875rem 0.5rem;
    border-radius: 1rem;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-bg-secondary);
    cursor: pointer;
    transition: border-color 0.15s, transform 0.1s;
    min-height: 88px;
  }

  .intent-card:hover {
    border-color: var(--color-primary, #f97316);
    transform: translateY(-1px);
  }

  .intent-card:active {
    transform: scale(0.97);
  }

  /* Category chips — horizontal scroll */
  .category-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    padding: 0.75rem 1rem;
    border-radius: 1rem;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-bg-secondary);
    cursor: pointer;
    flex-shrink: 0;
    min-width: 72px;
    transition: border-color 0.15s, transform 0.1s;
  }

  .category-chip:hover {
    border-color: var(--color-primary, #f97316);
    transform: translateY(-1px);
  }

  .category-chip:active {
    transform: scale(0.96);
  }

  /* Membership teaser — premium night-sky feel */
  .membership-teaser {
    position: relative;
    border-radius: 1.25rem;
    overflow: hidden;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  }

  .membership-teaser-glow {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 30% 20%, rgba(249, 115, 22, 0.15) 0%, transparent 60%),
      radial-gradient(ellipse at 70% 80%, rgba(249, 115, 22, 0.1) 0%, transparent 50%);
    pointer-events: none;
  }

  .membership-teaser-cta {
    display: inline-block;
    margin-top: 1rem;
    padding: 0.625rem 1.5rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 600;
    color: white;
    background: linear-gradient(135deg, #f97316, #ea580c);
    box-shadow: 0 0 20px rgba(249, 115, 22, 0.3);
    transition: transform 0.15s, box-shadow 0.15s;
    text-decoration: none;
  }

  .membership-teaser-cta:hover {
    transform: translateY(-1px);
    box-shadow: 0 0 28px rgba(249, 115, 22, 0.45);
  }

  .sponsor-scroll-item {
    width: 340px;
  }

  @media (max-width: 480px) {
    .sponsor-scroll-item {
      width: 280px;
    }
  }
</style>
