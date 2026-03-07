<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
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

  // Membership banner dismiss (re-shows after 7 days)
  const MEMBERSHIP_BANNER_KEY = 'zapcooking_membership_banner_dismissed_at';
  const MEMBERSHIP_BANNER_TTL = 7 * 24 * 60 * 60 * 1000;
  let showMembershipBanner = true;
  if (browser) {
    const dismissedAt = localStorage.getItem(MEMBERSHIP_BANNER_KEY);
    if (dismissedAt && Date.now() - Number(dismissedAt) < MEMBERSHIP_BANNER_TTL) {
      showMembershipBanner = false;
    }
  }
  function dismissMembershipBanner() {
    showMembershipBanner = false;
    if (browser) localStorage.setItem(MEMBERSHIP_BANNER_KEY, String(Date.now()));
  }

  // Banner sats pricing (live from bitcoin-price-quote API — same source as checkout pages)
  let cookSats: number | null = null;
  let proSats: number | null = null;
  let satsPricingLoading = true;
  let satsPricingError = false;
  let featuresExpanded = false;

  function formatBannerSats(sats: number): string {
    const rounded = Math.round(sats / 100) * 100;
    return rounded.toLocaleString('en-US');
  }

  async function fetchBannerSatsPricing() {
    if (!browser || !showMembershipBanner) return;
    satsPricingLoading = true;
    satsPricingError = false;
    try {
      const [cookRes, proRes] = await Promise.all([
        fetch('/api/membership/bitcoin-price-quote?tier=cook&period=monthly'),
        fetch('/api/membership/bitcoin-price-quote?tier=pro&period=monthly')
      ]);
      if (cookRes.ok) {
        const data = await cookRes.json();
        cookSats = data.amountSats;
      }
      if (proRes.ok) {
        const data = await proRes.json();
        proSats = data.amountSats;
      }
      if (!cookRes.ok && !proRes.ok) {
        satsPricingError = true;
      }
    } catch {
      satsPricingError = true;
    } finally {
      satsPricingLoading = false;
    }
  }

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
  let popularTags: TagWithCount[] = [];
  let loadingPopular = true;
  let popularTagCounts = new Map<string, number>();

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
    }).catch(() => {
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

  onMount(() => {
    let cleanup: (() => void) | undefined;
    void (async () => {
    syncTipPointer();
    if (showMembershipBanner) fetchBannerSatsPricing();
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
        <p class="text-sm text-gray-400">Curated recipes and popular cooks.</p>
        <p class="text-xs text-gray-300 mt-0.5">
          A starting point for discovering people and ideas.
        </p>
      </div>
    {/if}

    <!-- Membership teaser strip for logged-in non-members -->
    {#if $userPublickey && isNonMember}
      <div
        class="rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm"
        style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
      >
        <span style="color: var(--color-text-primary);">
          ⚡ Cook+ members unlock AI tools, enhanced print layouts, and private groups.
        </span>
        <a
          href="/membership"
          class="font-medium whitespace-nowrap hover:opacity-80 transition-opacity"
          style="color: var(--color-primary);"
        >
          Explore Membership →
        </a>
      </div>
    {/if}

    <!-- Explore Content -->
    <div class="flex flex-col gap-8 sm:gap-14">
      <!-- Membership Banner -->
      {#if showMembershipBanner}
        <section aria-label="Membership upgrade">
          <div class="membership-banner relative rounded-2xl p-5 md:p-6 overflow-hidden">
            <!-- Dismiss (subtle) -->
            <button
              type="button"
              on:click={dismissMembershipBanner}
              class="absolute top-3 right-3 z-10 p-1.5 rounded-full transition-opacity opacity-40 hover:opacity-70"
              style="color: var(--color-text-secondary);"
              aria-label="Dismiss"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>

            <!-- Headline + subcopy -->
            <div class="mb-3 pr-6">
              <h2 class="text-lg font-bold leading-tight">&#9889; Level up your kitchen</h2>
              <p class="text-[13px] mt-0.5" style="color: var(--color-caption);">
                AI-powered tools and an exclusive community, built on Nostr.
              </p>
            </div>

            <!-- Features: accordion on mobile, pills on desktop -->
            <div class="mb-4">
              <button
                type="button"
                on:click={() => featuresExpanded = !featuresExpanded}
                class="sm:hidden flex items-center gap-1.5 text-[13px] font-medium"
                style="color: var(--color-primary);"
                aria-expanded={featuresExpanded}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                  class="transition-transform duration-150 {featuresExpanded ? 'rotate-90' : ''}"
                ><polyline points="9 18 15 12 9 6"/></svg>
                See what's included
              </button>
              {#if featuresExpanded}
                <ul class="sm:hidden mt-2 ml-0.5 space-y-1 text-[13px]" style="color: var(--color-text-secondary);">
                  <li>&#10022; AI meal planning &amp; grocery lists</li>
                  <li>&#10022; Cook from what you have</li>
                  <li>&#10022; Enhanced print layouts</li>
                  <li>&#10022; Members-only groups</li>
                  <li>&#10022; Private relay access</li>
                </ul>
              {/if}

              <div class="hidden sm:flex flex-wrap gap-2">
                <span class="membership-pill">&#129302; Plan your week</span>
                <span class="membership-pill">&#127859; Cook from what you have</span>
                <span class="membership-pill">&#128722; One-tap grocery list</span>
                <span class="membership-pill">&#129489;&#8205;&#127859; Members-only groups</span>
                <span class="membership-pill">&#128274; Private relay access</span>
              </div>
            </div>

            <!-- Pricing cards -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <!-- Cook+ -->
              <div class="membership-price-card rounded-xl px-4 py-3.5">
                <p class="text-sm font-semibold mb-1.5">Cook+</p>
                {#if !satsPricingLoading && cookSats != null}
                  <div class="flex items-baseline gap-1.5">
                    <span class="text-xl font-bold" style="color: var(--color-primary);">&#9889;&thinsp;{formatBannerSats(cookSats)}</span>
                    <span class="text-xs font-semibold" style="color: var(--color-primary);">sats/mo</span>
                  </div>
                  <span class="membership-sats-badge">Save 5% with bitcoin</span>
                {:else if satsPricingLoading}
                  <div class="flex items-baseline gap-1.5 mb-1">
                    <span class="text-base font-bold" style="color: var(--color-primary);">&#9889;</span>
                    <span class="text-xs" style="color: var(--color-caption);">Loading rate&hellip;</span>
                  </div>
                {/if}
                <p class="text-xs mt-1" style="color: var(--color-caption);">$4.99/mo &middot; or $49/yr</p>
                <a href="/membership" class="membership-card-cta mt-3">Join Cook+</a>
              </div>

              <!-- Pro Kitchen -->
              <div class="membership-price-card membership-price-card--pro rounded-xl px-4 py-3.5 relative">
                <span class="absolute -top-2 right-3 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style="background-color: var(--color-primary); color: white;">Best value</span>
                <p class="text-sm font-semibold mb-1.5">Pro Kitchen</p>
                {#if !satsPricingLoading && proSats != null}
                  <div class="flex items-baseline gap-1.5">
                    <span class="text-xl font-bold" style="color: var(--color-primary);">&#9889;&thinsp;{formatBannerSats(proSats)}</span>
                    <span class="text-xs font-semibold" style="color: var(--color-primary);">sats/mo</span>
                  </div>
                  <span class="membership-sats-badge">Save 5% with bitcoin</span>
                {:else if satsPricingLoading}
                  <div class="flex items-baseline gap-1.5 mb-1">
                    <span class="text-base font-bold" style="color: var(--color-primary);">&#9889;</span>
                    <span class="text-xs" style="color: var(--color-caption);">Loading rate&hellip;</span>
                  </div>
                {/if}
                <p class="text-xs mt-1" style="color: var(--color-caption);">$8.99/mo &middot; or $89/yr</p>
                <a href="/membership" class="membership-card-cta membership-card-cta--pro mt-3">Enter Pro Kitchen</a>
              </div>
            </div>

            <!-- Social proof -->
            <p class="text-[11px] text-center" style="color: var(--color-caption);">
              Join 200+ cooks building on Nostr
            </p>
          </div>
        </section>
      {/if}

      <!-- Supported by our partners -->
      {#if sponsorBanners.length > 0}
        <section class="flex flex-col gap-3" data-section="partners">
          <div>
            <h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">Supported by our partners</h2>
            <p class="text-xs mt-0.5" style="color: var(--color-caption);">
              Zap Cooking is supported by a small group of aligned partners helping us build the future of food culture on the open web.
            </p>
          </div>
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
              {#if hasMoreCultures}
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
              {#each visibleCultureTags as tag (tag.title)}
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

  /* Membership banner */
  .membership-banner {
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
  }

  .membership-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.3rem 0.65rem;
    border-radius: 9999px;
    border: 1px solid var(--color-input-border);
    white-space: nowrap;
  }

  .membership-price-card {
    background-color: rgba(0, 0, 0, 0.03);
    border: 1px solid var(--color-input-border);
  }

  .membership-price-card--pro {
    border: 1.5px solid var(--color-primary);
    background: rgba(236, 71, 0, 0.04);
  }

  .membership-sats-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 9999px;
    background: rgba(34, 197, 94, 0.12);
    color: #16a34a;
    margin-top: 2px;
    margin-bottom: 2px;
  }

  :global(html.dark) .membership-sats-badge {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
  }

  :global(html.dark) .membership-price-card {
    background-color: rgba(255, 255, 255, 0.04);
  }

  :global(html.dark) .membership-price-card--pro {
    background: rgba(236, 71, 0, 0.08);
  }

  .membership-card-cta {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 40px;
    padding: 8px 16px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 600;
    border: 1.5px solid var(--color-input-border);
    color: var(--color-text-primary);
    text-decoration: none;
    transition: border-color 0.15s, color 0.15s;
  }

  .membership-card-cta:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .membership-card-cta--pro {
    background-color: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .membership-card-cta--pro:hover {
    filter: brightness(1.1);
    color: white;
  }

  .membership-card-cta:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
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
