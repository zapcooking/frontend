<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onDestroy, onMount } from 'svelte';
  import { userPublickey, ndk } from '$lib/nostr';
  import { signNip98AuthHeader } from '$lib/nip98';
  import { membershipStore, formatMembershipExpiry } from '$lib/membershipStore';
  import {
    membershipStatusMap,
    queueMembershipLookup,
    type MembershipStatus
  } from '$lib/stores/membershipStatus';
  import { bottomDockOccupied } from '$lib/stores/bottomDock';
  import {
    COOK_PLUS_ANNUAL_USD,
    COOK_PLUS_MONTHLY_USD,
    annualMonthlyEquivalent,
    annualSavingsPercent,
    computeStickyCtaVisible,
    cookPlusCheckoutHref,
    cookPlusCtaLabel,
    formatPlanPrice,
    parseBillingPeriod,
    type BillingPeriod
  } from '$lib/cookPlusPricing';
  import { COOK_PLUS_HEADLINE, COOK_PLUS_TOOLS, COOK_PLUS_PERKS } from '$lib/cookPlusCopy';
  import CustomAvatar from '../../components/CustomAvatar.svelte';
  import CustomName from '../../components/CustomName.svelte';
  import CheffyAvatar from '../../components/CheffyAvatar.svelte';
  import PlanPicker from './PlanPicker.svelte';
  import CookingPotIcon from 'phosphor-svelte/lib/CookingPot';
  import StarIcon from 'phosphor-svelte/lib/Star';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import RobotIcon from 'phosphor-svelte/lib/Robot';
  import StorefrontIcon from 'phosphor-svelte/lib/Storefront';
  import CrownIcon from 'phosphor-svelte/lib/Crown';
  import MagicWandIcon from 'phosphor-svelte/lib/MagicWand';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRight';
  import IdentificationBadgeIcon from 'phosphor-svelte/lib/IdentificationBadge';
  import BroadcastIcon from 'phosphor-svelte/lib/Broadcast';
  import SealCheckIcon from 'phosphor-svelte/lib/SealCheck';
  import BookmarkSimpleIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import RocketIcon from 'phosphor-svelte/lib/Rocket';
  import ThumbsUpIcon from 'phosphor-svelte/lib/ThumbsUp';
  import UploadIcon from 'phosphor-svelte/lib/Upload';
  import PaperclipIcon from 'phosphor-svelte/lib/Paperclip';
  import PaperPlaneIcon from 'phosphor-svelte/lib/PaperPlane';
  import NourishDimensionTile from '../../components/nourish/NourishDimensionTile.svelte';
  import CheffySuggestionChips, {
    STARTER_SUGGESTIONS
  } from '../../components/CheffySuggestionChips.svelte';
  import { PROMPT_PLACEHOLDERS } from '$lib/cheffy';

  export let data;

  let showFoundersList = false;
  let isCheckingOut = false;

  // ── Cook+ pricing ──────────────────────────────────────────────
  // Annual is the default; `?period=monthly` (e.g. from a contextual
  // prompt) preselects monthly. All copy derives from the one selection.
  let billingPeriod: BillingPeriod = parseBillingPeriod($page.url.searchParams.get('period'));
  const savingsPercent = annualSavingsPercent();
  const monthlyEquivalent = annualMonthlyEquivalent();
  $: ctaLabel = cookPlusCtaLabel(billingPeriod);
  $: selectedPrice = formatPlanPrice(billingPeriod);

  function setPeriod(next: BillingPeriod) {
    billingPeriod = next;
  }

  function goToCookPlusCheckout() {
    goto(cookPlusCheckoutHref(billingPeriod));
  }

  // The tool strip is product navigation: it scrolls to the matching card
  // inside the app's scroll container (plain hash links target the window).
  function scrollToTool(event: MouseEvent, key: string) {
    if (!browser) return;
    const target = document.getElementById(`tool-${key}`);
    if (!target) return;
    event.preventDefault();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  const TOOL_STRIP = [
    { key: 'souschef', name: 'Sous Chef', promise: 'Save any recipe' },
    { key: 'nourish', name: 'Nourish', promise: 'Understand your food' },
    { key: 'cheffy', name: 'Cheffy', promise: 'Cook with help' }
  ] as const;

  // ── Product previews ───────────────────────────────────────────
  // Real components with representative data, not illustrations. The
  // Nourish tiles are the same component the result screen renders
  // (tap to expand); the Cheffy chips are the messenger's own starters.
  const NOURISH_SAMPLE = {
    quickTake:
      'A balanced, fiber-rich bowl. Whole grains and vegetables do most of the work; the salmon carries the protein.',
    strengths: ['Whole foods', 'Gut-friendly', 'Protein-rich'],
    dimensions: [
      {
        icon: '🥬',
        label: 'Real Food',
        score: 9,
        reason: 'Nearly every ingredient is a whole food; only the soy sauce is processed.'
      },
      {
        icon: '🌱',
        label: 'Gut Health',
        score: 8,
        reason: 'Brown rice, edamame, and cabbage bring fiber and variety for the microbiome.'
      },
      {
        icon: '💪',
        label: 'Protein',
        score: 8,
        reason: 'Salmon and edamame give a complete protein load per serving.'
      },
      {
        icon: '🧘',
        label: 'Anti-inflammatory',
        score: 7,
        reason: 'Omega-3s from the salmon and ginger in the dressing.'
      },
      {
        icon: '⚖️',
        label: 'Blood Sugar',
        score: 7,
        reason: 'Brown rice and fiber slow the carbohydrate release.'
      },
      {
        icon: '🛡️',
        label: 'Immune-supportive',
        score: 6,
        reason: 'Cabbage and sesame contribute vitamin C and zinc.'
      },
      {
        icon: '🧠',
        label: 'Brain Health',
        score: 7,
        reason: 'Fatty fish is the main contributor here.'
      },
      {
        icon: '🫀',
        label: 'Heart-healthy',
        score: 8,
        reason: 'Unsaturated fats and no added saturated fat.'
      }
    ]
  } as const;

  const CHEFFY_SAMPLE = {
    user: 'I have chicken thighs, a lemon, and rice. Dinner in 40 minutes?',
    reply:
      'Easily. Sear the thighs skin-side down for 6 minutes, flip, then add the rice, stock, and lemon zest to the same pan and cover for 18. Want the step-by-step?'
  } as const;

  function openCheffy() {
    goto('/cheffy');
  }

  const PERK_ICONS: Record<string, typeof CookingPotIcon> = {
    nip05: IdentificationBadgeIcon,
    relay: BroadcastIcon,
    badge: SealCheckIcon,
    market: StorefrontIcon,
    collections: BookmarkSimpleIcon,
    early: RocketIcon,
    vote: ThumbsUpIcon
  };

  // ── Sticky mobile CTA ──────────────────────────────────────────
  // Appears once both on-page purchase buttons have scrolled out of view,
  // on viewports below the desktop breakpoint (where the bottom nav lives).
  let heroCtaInView = true;
  let pricingCtaInView = false;
  let isMobileViewport = false;

  function inView(node: HTMLElement, onChange: (visible: boolean) => void) {
    if (typeof IntersectionObserver === 'undefined') {
      onChange(true);
      return {};
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) onChange(entry.isIntersecting);
      },
      { threshold: 0.25 }
    );
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
      }
    };
  }

  onMount(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const apply = () => (isMobileViewport = mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  });

  $: salesVisible = !isActiveMemberApi || showUpgradeOptions;
  $: stickyCtaVisible = computeStickyCtaVisible({
    salesVisible,
    heroCtaInView,
    pricingCtaInView,
    isMobileViewport
  });
  $: if (browser) bottomDockOccupied.set(stickyCtaVisible);
  onDestroy(() => {
    if (browser) bottomDockOccupied.set(false);
  });

  let openFaqIndex: number | null = null;

  const faqs: { question: string; answer: string }[] = [
    {
      question: 'How many Cheffy messages do I get?',
      answer:
        'A Zap Cooking membership includes 300 Cheffy messages per month. That is a generous monthly allowance for everyday cooking help — ask questions, use what you have, or turn an idea into dinner. Founders Club members get the same allowance as every other member, for the life of their membership.'
    },
    {
      question: 'Can I cancel anytime?',
      answer:
        'Yes. Cancel anytime from your membership page (card members use the billing portal; Lightning members contact support). You keep access through the end of your current billing period.'
    },
    {
      question: 'Bitcoin or card — which should I use?',
      answer:
        'Both work. Bitcoin via Lightning is preferred and often a bit cheaper; cards are accepted through Stripe if that is easier for you. You choose at checkout.'
    },
    {
      question: 'What happens to my recipes if I cancel?',
      answer:
        'Your recipes stay yours. Content you published remains on the network under your keys. You would lose Cook+ tools and member perks after your paid period ends, not the recipes you already saved or shared.'
    },
    {
      question: 'How does billing work?',
      answer:
        'Choose annual ($49/year) or monthly ($4.99/month). Annual is the better value. Card subscriptions renew for the period you picked unless you cancel before renewal. A Lightning payment covers one term and does not renew on its own — you renew it yourself when the term is up.'
    }
  ];

  function toggleFaq(index: number) {
    openFaqIndex = openFaqIndex === index ? null : index;
  }

  // Genesis founders constants
  const TOTAL_GENESIS_SPOTS = 21;

  // Reactive to `data` so CSR navigations pick up load results (a one-shot
  // `const count = data.founders?.length || 0` freezes the initial value,
  // which is often 0 before/without a successful load).
  // `foundersAvailable` distinguishes a real empty list from a failed load —
  // never render "0 taken" as a placeholder for unavailable data.
  $: foundersAvailable = data?.foundersAvailable === true;
  $: spotsTaken = foundersAvailable ? (data.founders?.length ?? 0) : null;
  $: spotsRemaining = spotsTaken === null ? null : TOTAL_GENESIS_SPOTS - spotsTaken;
  $: isSoldOut = spotsRemaining === 0;
  $: isLoggedIn = $userPublickey && $userPublickey.length > 0;

  // Current user membership info
  $: currentMembership = $userPublickey ? membershipStore.getMembership($userPublickey) : null;
  $: hasActiveCardMembership =
    currentMembership &&
    currentMembership.paymentMethod === 'card' &&
    currentMembership.expiresAt > Date.now() &&
    currentMembership.invoiceId;

  $: isFoundersMember = apiMembershipStatus?.tier === 'founders';
  // Lifetime = founders or expiry 8+ years out (matches formatExpiresAt logic without coupling to its string)
  $: isLifetimeMember =
    isFoundersMember ||
    (() => {
      if (!apiMembershipStatus?.expiresAt) return false;
      try {
        const yearsAway =
          (new Date(apiMembershipStatus.expiresAt).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24 * 365);
        return yearsAway >= 8;
      } catch {
        return false;
      }
    })();

  let cancellingMembership = false;
  let cancelError: string | null = null;

  async function handleCancelMembership() {
    if (!browser) return;

    cancellingMembership = true;
    cancelError = null;

    // Try Stripe portal first — works for any card member regardless of local state.
    // Falls back to email if no Stripe subscription is found (404).
    //
    // The portal endpoint requires NIP-98 auth signed by this pubkey. A member
    // without a signer (read-only session) cannot produce one, so skip straight
    // to the email fallback rather than sending a request that can only 403 —
    // that keeps the outcome for those members exactly what it was before the
    // gate: a human they can write to.
    const bodyString = JSON.stringify({
      pubkey: $userPublickey,
      returnUrl: window.location.href
    });
    let authorization: string | null = null;
    try {
      authorization = await signNip98AuthHeader($ndk, {
        method: 'POST',
        url: `${location.origin}/api/stripe/create-portal-session`,
        bodyString
      });
    } catch (err) {
      console.error('[Membership] NIP-98 signing unavailable, using email fallback:', err);
    }

    if (authorization) {
      try {
        const response = await fetch('/api/stripe/create-portal-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authorization },
          body: bodyString
        });

        if (response.ok) {
          const { url } = await response.json();
          if (url) {
            window.location.href = url;
            return;
          }
        }

        // 404 = no Stripe subscription found → fall through to email.
        // 403 = auth rejected. Also a fall-through: the response body is a
        // greppable server string, not copy to show a member, and the email
        // path reaches a person who can cancel it by hand.
        if (response.status !== 404 && response.status !== 403) {
          const errData = await response
            .json()
            .catch(() => ({ error: 'Failed to open cancellation portal' }));
          throw new Error(errData.error || 'Failed to open cancellation portal');
        }
        if (response.status === 403) {
          console.error('[Membership] Portal rejected NIP-98 auth, using email fallback');
        }
      } catch (err) {
        // If we got a real error (not a 404/403 fallthrough), show it and stop
        if (err instanceof Error) {
          console.error('[Membership] Cancel error:', err);
          cancelError = err.message;
          cancellingMembership = false;
          return;
        }
      }
    }

    // Fallback: Lightning / other members without Stripe subscription
    cancellingMembership = false;
    window.location.href =
      'mailto:support@zap.cooking?subject=Membership%20Cancellation%20Request&body=Hi%2C%20I%20would%20like%20to%20cancel%20my%20zap.cooking%20membership.%0A%0AMy%20pubkey%3A%20' +
      encodeURIComponent($userPublickey || '');
  }

  // --- API-based membership status (membershipStatusMap) ---
  let membershipMap: Record<string, MembershipStatus> = {};
  const unsubscribe = membershipStatusMap.subscribe((value) => {
    membershipMap = value;
  });
  onDestroy(unsubscribe);

  $: if ($userPublickey) queueMembershipLookup($userPublickey);

  $: normalizedPubkey = String($userPublickey || '')
    .trim()
    .toLowerCase();
  $: apiMembershipStatus = membershipMap[normalizedPubkey];
  $: isActiveMemberApi = Boolean(apiMembershipStatus?.active);

  function formatExpiresAt(expiresAt: string | undefined): string {
    if (!expiresAt) return '—';
    try {
      const date = new Date(expiresAt);
      // If expiry is 8+ years away, show "Lifetime" instead of a date
      const yearsAway = (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 365);
      if (yearsAway >= 8) return 'Lifetime';
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return '—';
    }
  }

  // --- Member stats ---
  let recipeCount: number | null = null;
  let memberSince: string | null = null;

  // Compute member since date from founders data or API status
  $: if (apiMembershipStatus && data.founders) {
    const founderRecord = data.founders.find((f: any) => f.pubkey === normalizedPubkey);
    if (founderRecord?.joined) {
      memberSince = new Date(founderRecord.joined).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long'
      });
    } else {
      memberSince = null;
    }
  }

  // Fetch recipe count for the user (kind 30023 = long-form recipes)
  onMount(async () => {
    if (!$userPublickey || !$ndk) return;
    try {
      const events = await $ndk.fetchEvents({
        kinds: [30023],
        authors: [$userPublickey]
      });
      recipeCount = events.size;
    } catch (e) {
      console.warn('[Membership] Failed to fetch recipe count:', e);
    }
  });

  // Perks by tier
  const TIER_PERKS: Record<string, { icon: typeof CookingPotIcon; label: string }[]> = {
    cook_plus: [
      { icon: RobotIcon, label: 'Sous Chef & Nourish' },
      { icon: CookingPotIcon, label: 'Cheffy — Kitchen Companion' },
      { icon: StorefrontIcon, label: 'Market Access' },
      { icon: StarIcon, label: 'Member Badge & Collections' }
    ],
    pro_kitchen: [
      { icon: RobotIcon, label: 'Sous Chef & Nourish' },
      { icon: CookingPotIcon, label: 'Cheffy — Kitchen Companion' },
      { icon: LightningIcon, label: 'Lightning-Gated Recipes' },
      { icon: StorefrontIcon, label: 'Market Access' },
      { icon: StarIcon, label: 'Member Badge & Collections' }
    ],
    founders: [
      { icon: CrownIcon, label: 'Lifetime Access — All Features' },
      { icon: RobotIcon, label: 'Sous Chef & Nourish' },
      { icon: CookingPotIcon, label: 'Cheffy — Kitchen Companion' },
      { icon: LightningIcon, label: 'Lightning-Gated Recipes' },
      { icon: StorefrontIcon, label: 'Market Access' },
      { icon: StarIcon, label: 'Founders Recognition' }
    ]
  };

  $: currentPerks = isFoundersMember
    ? TIER_PERKS['founders']
    : TIER_PERKS[apiMembershipStatus?.tier || ''] || TIER_PERKS['cook_plus'];

  // Toggle for showing sales/pricing content when active member clicks "Upgrade"
  let showUpgradeOptions = false;

  function handleShowUpgrade() {
    showUpgradeOptions = true;
    // Scroll to pricing after DOM update
    setTimeout(() => {
      document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }

  let managingSubscription = false;
  let manageError: string | null = null;

  async function handleManageSubscription() {
    if (!currentMembership?.invoiceId || !browser) return;

    managingSubscription = true;
    manageError = null;

    try {
      const response = await fetch('/api/stripe/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentMembership.invoiceId,
          returnUrl: window.location.href
        })
      });

      if (!response.ok) {
        const errData = await response
          .json()
          .catch(() => ({ error: 'Failed to open subscription portal' }));
        throw new Error(errData.error || 'Failed to open subscription portal');
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('No portal URL returned');
      }
    } catch (err) {
      console.error('[Membership] Portal error:', err);
      manageError = err instanceof Error ? err.message : 'Failed to open subscription portal';
      managingSubscription = false;
    }
  }

  async function handleClaimSpot() {
    if (!browser) return;

    // Check if user is logged in
    if (!isLoggedIn) {
      // Redirect to login page
      goto('/login?redirect=/membership');
      return;
    }

    // Check if sold out
    if (isSoldOut) {
      alert('All Founders Club spots have been claimed!');
      return;
    }

    // Navigate to checkout
    isCheckingOut = true;
    goto('/membership/genesis-checkout');
  }

  function handleCardClick() {
    showFoundersList = !showFoundersList;
  }
</script>

<svelte:head>
  <title>Cook+ Membership — AI Cooking Tools | Zap Cooking</title>
  <meta
    name="description"
    content="Sous Chef pulls recipes from any link or photo. Nourish scores what they do for your body. Cheffy answers your kitchen questions with generous monthly credits. One membership unlocks all of it."
  />
  <meta property="og:title" content="Cook+ Membership — AI Cooking Tools | Zap Cooking" />
  <meta
    property="og:description"
    content="Sous Chef pulls recipes from any link or photo. Nourish scores what they do for your body. Cheffy answers your kitchen questions with generous monthly credits. One membership unlocks all of it."
  />
</svelte:head>

<div class="membership-page" class:has-sticky-cta={stickyCtaVisible}>
  {#if $userPublickey && isActiveMemberApi}
    <section class="member-dashboard">
      <!-- Header with identity and badge -->
      <div class="member-dashboard-header">
        <div class="member-dashboard-identity">
          <div class="member-avatar-glow" class:founders-glow={isFoundersMember}>
            <CustomAvatar pubkey={$userPublickey} size={56} interactive={false} />
          </div>
          <div class="member-dashboard-identity-text">
            <CustomName pubkey={$userPublickey} className="member-dashboard-display-name" />
            <span class="member-dashboard-tier">
              {#if apiMembershipStatus?.tier === 'founders'}
                Founders Club
              {:else if apiMembershipStatus?.tier === 'pro_kitchen'}
                Pro Kitchen
              {:else if apiMembershipStatus?.tier === 'cook_plus'}
                Cook+
              {:else}
                Member
              {/if}
            </span>
          </div>
        </div>
        <span class="member-dashboard-active-badge">Active</span>
      </div>

      <!-- Stats row -->
      <div class="member-dashboard-stats">
        <div class="member-dashboard-stat">
          <span class="member-dashboard-stat-label">Expires</span>
          <span class="member-dashboard-stat-value"
            >{formatExpiresAt(apiMembershipStatus?.expiresAt)}</span
          >
        </div>
        {#if memberSince}
          <div class="member-dashboard-stat">
            <span class="member-dashboard-stat-label">Member Since</span>
            <span class="member-dashboard-stat-value">{memberSince}</span>
          </div>
        {/if}
        <div class="member-dashboard-stat">
          <span class="member-dashboard-stat-label">Recipes Published</span>
          <span class="member-dashboard-stat-value">
            {#if recipeCount !== null}
              {recipeCount}
            {:else}
              ...
            {/if}
          </span>
        </div>
      </div>

      <!-- Perks -->
      <div class="member-dashboard-perks">
        <h4 class="member-dashboard-perks-title">Your Perks</h4>
        <div class="member-dashboard-perks-grid">
          {#each currentPerks as perk}
            <div class="member-dashboard-perk">
              <svelte:component this={perk.icon} size={16} weight="bold" />
              <span>{perk.label}</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Actions -->
      <div class="member-dashboard-actions">
        {#if hasActiveCardMembership}
          {#if manageError}
            <div class="manage-error">{manageError}</div>
          {/if}
          <button
            class="manage-subscription-button"
            on:click={handleManageSubscription}
            disabled={managingSubscription}
          >
            {#if managingSubscription}
              Opening portal...
            {:else}
              Manage Subscription
            {/if}
          </button>
        {/if}
        {#if !showUpgradeOptions && !isLifetimeMember}
          <button class="member-dashboard-upgrade-button" on:click={handleShowUpgrade}>
            Upgrade Plan
          </button>
        {/if}
      </div>

      <!-- Cancel Membership -->
      <div class="member-dashboard-cancel">
        {#if isLifetimeMember}
          <p class="cancel-note">
            Your Founders Club membership is lifetime — no renewal or cancellation needed.
          </p>
        {:else}
          {#if cancelError}
            <p class="cancel-error">{cancelError}</p>
          {/if}
          <button
            class="cancel-membership-link"
            on:click={handleCancelMembership}
            disabled={cancellingMembership}
          >
            {#if cancellingMembership}
              Opening cancellation portal...
            {:else}
              Cancel Membership
            {/if}
          </button>
          <p class="cancel-note">
            {#if hasActiveCardMembership}
              You'll be redirected to our payment provider to complete cancellation.
            {:else}
              Contact support to cancel your membership. Your access continues until the expiration
              date.
            {/if}
          </p>
        {/if}
      </div>
    </section>
  {/if}

  {#if salesVisible}
    <!-- 1. Value proposition -->
    <section class="hero" aria-labelledby="hero-heading">
      <h1 id="hero-heading">{COOK_PLUS_HEADLINE}</h1>
      <p class="lede">
        Save any recipe in seconds, see what it does for your body, and get answers mid-cook. One
        membership, three tools, made for people who actually cook.
      </p>
      <div class="hero-cta" use:inView={(visible) => (heroCtaInView = visible)}>
        <button
          type="button"
          class="cta-primary cta-large"
          data-testid="hero-cta"
          on:click={goToCookPlusCheckout}
        >
          {ctaLabel}
        </button>
        {#if billingPeriod === 'annual'}
          <p class="cta-value">
            ${monthlyEquivalent}/month <span class="cta-dot" aria-hidden="true">·</span>
            <span class="cta-save">Save {savingsPercent}%</span>
          </p>
          <p class="cta-alt">
            Prefer monthly?
            <button type="button" class="link-button" on:click={() => setPeriod('monthly')}>
              ${COOK_PLUS_MONTHLY_USD.toFixed(2)}/month
            </button>
          </p>
        {:else}
          <p class="cta-value">
            Billed monthly <span class="cta-dot" aria-hidden="true">·</span> Cancel anytime
          </p>
          <p class="cta-alt">
            Prefer annual?
            <button type="button" class="link-button" on:click={() => setPeriod('annual')}>
              ${COOK_PLUS_ANNUAL_USD}/year
            </button>
            <span class="cta-dot" aria-hidden="true">·</span>
            <span class="cta-save">Save {savingsPercent}%</span>
          </p>
        {/if}
        <p class="reassurance">₿ Bitcoin preferred · Card accepted · Cancel anytime</p>
      </div>

      <!-- Product strip: the three tools in the order you use them. -->
      <nav class="tool-strip" aria-label="Cook+ tools">
        {#each TOOL_STRIP as tool, i (tool.key)}
          <a
            href="#tool-{tool.key}"
            class="tool-strip-item tool-strip-{tool.key}"
            on:click={(e) => scrollToTool(e, tool.key)}
          >
            <span class="tool-strip-mark" aria-hidden="true">
              {#if tool.key === 'souschef'}
                <MagicWandIcon size={18} weight="fill" />
              {:else if tool.key === 'nourish'}
                <LeafIcon size={18} weight="fill" />
              {:else}
                <CheffyAvatar size={26} variant="compact" expression="happy" />
              {/if}
            </span>
            <span class="tool-strip-text">
              <span class="tool-strip-name">{tool.name}</span>
              <span class="tool-strip-promise">{tool.promise}</span>
            </span>
            {#if i < TOOL_STRIP.length - 1}
              <span class="tool-strip-arrow" aria-hidden="true">
                <ArrowRightIcon size={14} weight="bold" />
              </span>
            {/if}
          </a>
        {/each}
      </nav>
    </section>

    <!-- 2. The three tools — the product is the proof -->
    <section class="tools" aria-labelledby="tools-heading">
      <h2 id="tools-heading" class="section-title">Three tools. One membership.</h2>

      {#each COOK_PLUS_TOOLS as tool, i (tool.key)}
        <article class="product-row tool-{tool.key}" class:flip={i % 2 === 1} id="tool-{tool.key}">
          <div class="product-copy">
            <p class="tool-name">
              {#if tool.key === 'souschef'}
                <MagicWandIcon size={14} weight="fill" />
              {:else if tool.key === 'nourish'}
                <LeafIcon size={14} weight="fill" />
              {:else}
                <CheffyAvatar size={18} variant="compact" expression="happy" />
              {/if}
              {tool.name}
            </p>
            <h3 class="tool-outcome">{tool.outcome}</h3>
            <p class="tool-body">{tool.body}</p>
            <a href={tool.href} class="tool-link">
              Open {tool.name}
              <ArrowRightIcon size={14} aria-hidden="true" />
            </a>
          </div>

          <div class="product-shot">
            {#if tool.key === 'souschef'}
              <!-- Sous Chef's unified input, as on /souschef. -->
              <div class="shot souschef-shot">
                <div class="ss-dropzone">
                  <p class="ss-placeholder">
                    Paste a recipe URL, paste recipe text, or drop a photo…
                  </p>
                  <div class="ss-toolbar">
                    <span class="ss-upload"><UploadIcon size={16} /> Upload image</span>
                  </div>
                </div>
                <span class="ss-button">🤖 Get Recipe</span>
              </div>
            {:else if tool.key === 'nourish'}
              <!-- A Nourish result, cropped to the profile. -->
              <div class="shot nourish-shot">
                <p class="nr-quicktake">{NOURISH_SAMPLE.quickTake}</p>
                <div class="nr-section">
                  <p class="nr-section-label">What this meal brings</p>
                  <div class="nr-strengths">
                    {#each NOURISH_SAMPLE.strengths as tag}
                      <span class="nr-tag"><LeafIcon size={10} weight="fill" /> {tag}</span>
                    {/each}
                  </div>
                </div>
                <div class="nr-section">
                  <p class="nr-section-label">Nourish Profile</p>
                  <div class="nr-dims-grid">
                    {#each NOURISH_SAMPLE.dimensions as dim (dim.label)}
                      <NourishDimensionTile
                        icon={dim.icon}
                        label={dim.label}
                        score={dim.score}
                        reason={dim.reason}
                      />
                    {/each}
                  </div>
                </div>
              </div>
            {:else}
              <!-- The Cheffy messenger, mid-conversation. -->
              <div class="shot cheffy-shot">
                <div class="ch-head">
                  <CheffyAvatar size={30} expression="happy" />
                  <div class="ch-head-text">
                    <span class="ch-head-title">Cheffy</span>
                    <span class="ch-head-sub">Kitchen companion</span>
                  </div>
                </div>
                <div class="ch-thread">
                  <div class="ch-msg ch-msg-user">
                    <div class="ch-bubble-user">{CHEFFY_SAMPLE.user}</div>
                  </div>
                  <div class="ch-msg ch-msg-cheffy">
                    <CheffyAvatar size={28} expression="neutral" />
                    <div class="ch-text">{CHEFFY_SAMPLE.reply}</div>
                  </div>
                </div>
                <div class="ch-starters">
                  <CheffySuggestionChips
                    compact
                    suggestions={STARTER_SUGGESTIONS}
                    ariaLabel="Things you can ask Cheffy"
                    onSelect={openCheffy}
                  />
                </div>
                <div class="ch-composer">
                  <span class="ch-composer-icon"><PaperclipIcon size={20} /></span>
                  <span class="ch-composer-input">{PROMPT_PLACEHOLDERS[0]}</span>
                  <span class="ch-composer-send"><PaperPlaneIcon size={18} weight="fill" /></span>
                </div>
              </div>
            {/if}
          </div>
        </article>
      {/each}
    </section>

    <!-- 3. Price and 4. primary CTA -->
    <section class="pricing" id="pricing" aria-labelledby="pricing-heading">
      <div class="pricing-card">
        <div class="pricing-head">
          <h2 id="pricing-heading">One plan. Pick how you pay.</h2>
          <p>Everything above, plus the member perks below.</p>
        </div>

        <PlanPicker period={billingPeriod} onChange={setPeriod} />

        <div class="pricing-total" aria-live="polite">
          <span class="pricing-amount">
            {billingPeriod === 'annual'
              ? `$${COOK_PLUS_ANNUAL_USD}`
              : `$${COOK_PLUS_MONTHLY_USD.toFixed(2)}`}<span class="pricing-per"
              >{billingPeriod === 'annual' ? '/year' : '/month'}</span
            >
          </span>
          <span class="pricing-sub">
            {#if billingPeriod === 'annual'}
              That’s ${monthlyEquivalent} a month, billed once a year.
            {:else}
              Billed monthly. Switch to annual any time to save {savingsPercent}%.
            {/if}
          </span>
        </div>

        <div use:inView={(visible) => (pricingCtaInView = visible)}>
          <button
            type="button"
            class="cta-primary cta-large cta-block"
            data-testid="pricing-cta"
            on:click={goToCookPlusCheckout}
          >
            {ctaLabel}
          </button>
        </div>

        <p class="reassurance pricing-reassurance">
          ₿ Bitcoin preferred · Card accepted · Cancel anytime
        </p>
      </div>
    </section>

    <!-- 5. Secondary membership benefits -->
    <section class="included" aria-labelledby="included-heading">
      <h2 id="included-heading" class="section-label">Also included</h2>
      <ul class="perk-grid">
        {#each COOK_PLUS_PERKS as perk (perk.key)}
          <li class="perk">
            <span class="perk-icon" aria-hidden="true">
              <svelte:component this={PERK_ICONS[perk.key]} size={18} />
            </span>
            <span class="perk-text">
              <span class="perk-label">{perk.label}</span>
              <span class="perk-detail">{perk.detail}</span>
            </span>
          </li>
        {/each}
      </ul>
    </section>

    <!-- Active Membership Management (legacy card, hidden when API dashboard shows) -->
    {#if hasActiveCardMembership && currentMembership && !isActiveMemberApi}
      <section class="active-membership">
        <div class="active-membership-card">
          <div class="active-membership-header">
            <h3>Your Membership</h3>
            <span class="active-badge">Active</span>
          </div>
          <div class="active-membership-details">
            <p class="membership-tier-name">
              {currentMembership.tier === 'cook_plus'
                ? 'Cook+'
                : currentMembership.tier === 'founders'
                  ? 'Founders Club'
                  : 'Pro Kitchen'}
            </p>
            <p class="membership-expiry">
              Expires {formatMembershipExpiry(currentMembership.expiresAt)}
            </p>
          </div>
          {#if manageError}
            <div class="manage-error">{manageError}</div>
          {/if}
          <button
            class="manage-subscription-button"
            on:click={handleManageSubscription}
            disabled={managingSubscription}
          >
            {#if managingSubscription}
              Opening portal...
            {:else}
              Manage Subscription
            {/if}
          </button>
        </div>
      </section>
    {/if}

    <!-- Founders Club story -->
    <section class="genesis-founders-hero">
      <div
        class="genesis-hero-card founders-story {isSoldOut ? 'sold-out' : ''}"
        on:click={handleCardClick}
        on:keydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCardClick();
          }
        }}
        role="button"
        tabindex="0"
        aria-expanded={showFoundersList}
        aria-label="Toggle Founders Club details"
      >
        <div class="genesis-hero-content">
          <div class="genesis-hero-icon">🔥</div>
          <div class="genesis-hero-text">
            <h2>Founders Club</h2>
            <p class="genesis-hero-countdown">
              {#if spotsTaken === null}
                {TOTAL_GENESIS_SPOTS} seats
              {:else}
                {spotsTaken} of {TOTAL_GENESIS_SPOTS} seats taken
              {/if}
            </p>
          </div>
          <div class="genesis-hero-arrow">
            <svg
              class="arrow-icon {showFoundersList ? 'rotated' : ''}"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
        <p class="founders-story-copy">
          Founders Club is a capped lifetime membership — {TOTAL_GENESIS_SPOTS} seats total — for people
          who want to back Zap Cooking early and keep full access for life. Seats are limited by that
          hard cap, not by a countdown.
        </p>
        {#if !showFoundersList}
          <p class="card-hint">{isSoldOut ? 'Sold out — view founders' : 'Click to learn more'}</p>
        {/if}
      </div>
    </section>

    {#if showFoundersList && !isSoldOut}
      <section class="genesis-checkout-section">
        <div class="genesis-checkout-card">
          <div class="genesis-checkout-header">
            <h3>Join Founders Club</h3>
            <p class="genesis-checkout-price">$210 <span>lifetime</span></p>
          </div>

          <div class="genesis-checkout-benefits">
            <h4>What you get:</h4>

            <div class="benefit-section">
              <h5 class="section-header">Lifetime Membership</h5>
              <ul class="benefit-list">
                <li>
                  <span class="checkmark">✓</span>
                  <span class="feature-text">Lifetime membership (never expires)</span>
                </li>
                <li>
                  <span class="checkmark">✓</span>
                  <span class="feature-text">All future features included</span>
                </li>
                <li>
                  <span class="checkmark">✓</span>
                  <span class="feature-text"
                    >Cheffy — the same monthly allowance as every member, currently 300 messages a
                    month</span
                  >
                </li>
              </ul>
            </div>

            <div class="section-divider"></div>

            <div class="benefit-section">
              <h5 class="section-header">Founders Club Exclusive</h5>
              <ul class="benefit-list">
                <li>
                  <span class="checkmark">✓</span>
                  <span class="feature-text">
                    Founders Club badge (#{spotsTaken === null ? '?' : spotsTaken + 1}-21)
                  </span>
                </li>
                <li>
                  <span class="checkmark">✓</span>
                  <span class="feature-text">Name permanently displayed as a Founder</span>
                </li>
              </ul>
            </div>

            <div class="section-divider"></div>

            <div class="benefit-section">
              <h5 class="section-header">Access & Features</h5>
              <ul class="benefit-list">
                <li>
                  <span class="checkmark">✓</span>
                  <span class="feature-text">Sous Chef, Nourish, and Cheffy</span>
                </li>
                <li>
                  <span class="checkmark">✓</span>
                  <a href="/market" class="feature-link">Buy and sell on the Market</a>
                </li>
                <li>
                  <span class="checkmark">✓</span>
                  <span class="feature-text">Verified @zap.cooking NIP-05 identity</span>
                </li>
                <li>
                  <span class="checkmark">✓</span>
                  <span class="feature-text">Access to pantry.zap.cooking relay</span>
                </li>
              </ul>
            </div>
          </div>

          <div class="genesis-checkout-urgency">
            <p>
              {#if spotsTaken === null}
                <strong>{TOTAL_GENESIS_SPOTS} seats</strong>
              {:else}
                <strong>{spotsTaken} of {TOTAL_GENESIS_SPOTS} seats taken</strong>
                {#if spotsRemaining !== null && spotsRemaining > 0}
                  — {spotsRemaining} remaining
                {/if}
              {/if}
            </p>
          </div>

          <button
            class="genesis-claim-button"
            on:click={handleClaimSpot}
            disabled={isCheckingOut || isSoldOut || !isLoggedIn}
          >
            {#if !isLoggedIn}
              Login to Claim Your Spot
            {:else if isCheckingOut}
              Processing...
            {:else if isSoldOut}
              Sold Out
            {:else}
              Claim Your Spot
            {/if}
          </button>
        </div>
      </section>
    {/if}

    {#if showFoundersList}
      <section class="genesis-founders-link">
        <a href="/founders" class="founders-link-button" data-sveltekit-reload>
          View Founders Club Members
        </a>
      </section>
    {/if}

    <!-- FAQ -->
    <section class="membership-faq" id="faq">
      <h2 class="section-label">Frequently Asked Questions</h2>
      <div class="faq-list">
        {#each faqs as faq, index}
          <div class="faq-item" class:open={openFaqIndex === index}>
            <button
              type="button"
              class="faq-question"
              aria-expanded={openFaqIndex === index}
              on:click={() => toggleFaq(index)}
            >
              <span>{faq.question}</span>
              <span class="faq-chevron" aria-hidden="true"
                >{openFaqIndex === index ? '−' : '+'}</span
              >
            </button>
            {#if openFaqIndex === index}
              <div class="faq-answer" role="region">
                <p>{faq.answer}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

{#if stickyCtaVisible}
  <!-- Mobile-only: keeps the purchase action reachable once the hero and
       pricing buttons have scrolled away. Sits above the bottom nav (and
       any timer bar) and hides the floating create/scroll buttons via
       bottomDockOccupied so nothing overlaps it. -->
  <div class="sticky-cta" role="region" aria-label="Cook+ membership" data-testid="sticky-cta">
    <div class="sticky-cta-text">
      <span class="sticky-cta-title">Cook+</span>
      <span class="sticky-cta-price">
        {selectedPrice}{#if billingPeriod === 'annual'}{` · $${monthlyEquivalent}/mo`}{/if}
      </span>
    </div>
    <button type="button" class="cta-primary sticky-cta-button" on:click={goToCookPlusCheckout}>
      Unlock Cook+
    </button>
  </div>
{/if}

<style>
  /* ── Page frame ─────────────────────────────────────────────── */
  .membership-page {
    max-width: 1080px;
    margin: 0 auto;
    padding: 1rem 0 3rem;
  }

  @media (min-width: 640px) {
    .membership-page {
      padding: 2rem 1rem 4rem;
    }
  }

  /* Keep the last content clear of the sticky bar. */
  .membership-page.has-sticky-cta {
    padding-bottom: 8rem;
  }

  /* ── Shared CTA ─────────────────────────────────────────────── */
  .cta-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1.75rem;
    border: none;
    border-radius: 9999px;
    background: var(--color-primary);
    color: #fff;
    font-weight: 700;
    font-size: 1rem;
    line-height: 1.2;
    cursor: pointer;
    box-shadow: 0 6px 18px rgba(236, 71, 0, 0.22);
    transition:
      background-color 0.15s ease,
      transform 0.15s ease,
      box-shadow 0.15s ease;
  }

  .cta-primary:hover {
    background: #d63a00;
    box-shadow: 0 8px 22px rgba(236, 71, 0, 0.3);
    transform: translateY(-1px);
  }

  .cta-primary:active {
    transform: translateY(0);
  }

  .cta-primary:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 3px;
  }

  .cta-large {
    padding: 1rem 2rem;
    font-size: 1.05rem;
  }

  .cta-block {
    width: 100%;
  }

  .link-button {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .link-button:hover {
    color: #d63a00;
  }

  .link-button:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
    border-radius: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .cta-primary,
    .cta-primary:hover {
      transition: none;
      transform: none;
    }
  }

  /* ── 1. Hero ────────────────────────────────────────────────── */
  .hero {
    text-align: center;
    padding: 1.75rem 0 1.25rem;
  }

  @media (min-width: 640px) {
    .hero {
      padding: 2.5rem 0 1.5rem;
    }
  }

  .hero h1 {
    font-size: 2.5rem;
    font-weight: 900;
    margin: 0 0 0.75rem;
    background: linear-gradient(135deg, var(--color-primary) 0%, #ff8c42 50%, #ffb347 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1.05;
    letter-spacing: -0.02em;
  }

  @media (min-width: 640px) {
    .hero h1 {
      font-size: 3.25rem;
    }
  }

  @media (min-width: 1024px) {
    .hero h1 {
      font-size: 3.75rem;
    }
  }

  html.dark .hero h1 {
    background: linear-gradient(135deg, #ff5722 0%, #ff8c42 50%, #ffb347 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .lede {
    color: var(--color-text-secondary);
    font-size: 1rem;
    line-height: 1.55;
    max-width: 540px;
    margin: 0 auto;
  }

  @media (min-width: 640px) {
    .lede {
      font-size: 1.1rem;
    }
  }

  .hero-cta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    margin-top: 1.25rem;
  }

  .hero-cta .cta-primary {
    width: 100%;
    max-width: 22rem;
    margin-bottom: 0.35rem;
  }

  .cta-value {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .cta-dot {
    color: var(--color-accent-gray);
    margin: 0 0.15rem;
  }

  .cta-save {
    color: #15803d;
    font-weight: 700;
  }

  :global(html.dark) .cta-save {
    color: #4ade80;
  }

  .cta-alt {
    margin: 0;
    font-size: 0.85rem;
    color: var(--color-text-secondary);
  }

  .reassurance {
    margin: 0.4rem 0 0;
    font-size: 0.78rem;
    color: var(--color-caption);
  }

  /* Tool strip — product navigation in the order the tools are used. */
  .tool-strip {
    display: grid;
    grid-template-columns: 1fr;
    margin: 1.5rem auto 0;
    max-width: 860px;
    border: 1px solid var(--color-input-border);
    border-radius: 14px;
    background: var(--color-bg-secondary);
    overflow: hidden;
  }

  @media (min-width: 640px) {
    .tool-strip {
      grid-template-columns: repeat(3, 1fr);
      margin-top: 1.75rem;
    }
  }

  .tool-strip-item {
    --tool-accent: var(--color-primary);
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.8rem 1rem;
    text-decoration: none;
    color: inherit;
    text-align: left;
    border-bottom: 1px solid var(--color-input-border);
    transition: background-color 0.15s ease;
  }

  .tool-strip-item:last-child {
    border-bottom: none;
  }

  @media (min-width: 640px) {
    .tool-strip-item {
      border-bottom: none;
      border-right: 1px solid var(--color-input-border);
      padding: 0.9rem 1.1rem;
    }
    .tool-strip-item:last-child {
      border-right: none;
    }
  }

  .tool-strip-item:hover {
    background: color-mix(in srgb, var(--tool-accent) 7%, var(--color-bg-secondary));
  }

  .tool-strip-item:focus-visible {
    outline: 2px solid var(--tool-accent);
    outline-offset: -2px;
  }

  .tool-strip-souschef {
    --tool-accent: #a855f7;
  }

  .tool-strip-nourish {
    --tool-accent: #22c55e;
  }

  .tool-strip-mark {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    color: var(--tool-accent);
    background: color-mix(in srgb, var(--tool-accent) 12%, transparent);
  }

  .tool-strip-text {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    min-width: 0;
  }

  .tool-strip-name {
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--color-text-primary);
  }

  .tool-strip-promise {
    font-size: 0.8rem;
    color: var(--color-text-secondary);
  }

  .tool-strip-arrow {
    margin-left: auto;
    color: var(--color-accent-gray);
    display: inline-flex;
  }

  @media (max-width: 639px) {
    .tool-strip-arrow {
      transform: rotate(90deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tool-strip-item {
      transition: none;
    }
  }

  /* ── 2. Tools ───────────────────────────────────────────────── */
  .tools {
    margin: 2.25rem 0 3rem;
    scroll-margin-top: calc(var(--header-h, 4rem) + 0.5rem);
  }

  .tool-card {
    scroll-margin-top: calc(var(--header-h, 4rem) + 0.75rem);
  }

  .section-title {
    text-align: center;
    font-size: 1.15rem;
    font-weight: 700;
    margin: 0 0 1.25rem;
    color: var(--color-text-primary);
  }

  /* Product rows — copy beside a real, cropped piece of the product. */
  .product-row {
    --tool-accent: var(--color-primary);
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
    align-items: center;
    padding: 1.5rem 0;
    border-top: 1px solid var(--color-input-border);
    scroll-margin-top: calc(var(--header-h, 4rem) + 0.75rem);
  }

  .product-row:first-of-type {
    border-top: none;
  }

  @media (min-width: 900px) {
    .product-row {
      grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
      gap: 3rem;
      padding: 2.25rem 0;
    }
    /* Flipped rows keep the wider column for the product. */
    .product-row.flip {
      grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    }
    .product-row.flip .product-copy {
      order: 2;
    }
    .product-row.flip .product-shot {
      order: 1;
    }
  }

  .tool-souschef {
    --tool-accent: #a855f7;
  }

  .tool-nourish {
    --tool-accent: #22c55e;
  }

  .product-copy {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .tool-name {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--tool-accent);
  }

  .tool-outcome {
    margin: 0;
    font-size: 1.5rem;
    line-height: 1.2;
    font-weight: 800;
    letter-spacing: -0.01em;
    color: var(--color-text-primary);
  }

  @media (min-width: 900px) {
    .tool-outcome {
      font-size: 1.75rem;
    }
  }

  .tool-body {
    margin: 0;
    font-size: 1rem;
    line-height: 1.55;
    color: var(--color-text-secondary);
    max-width: 44ch;
  }

  .tool-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-top: 0.25rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--tool-accent);
    text-decoration: none;
    width: fit-content;
  }

  .tool-link:hover {
    text-decoration: underline;
  }

  .tool-link:focus-visible {
    outline: 2px solid var(--tool-accent);
    outline-offset: 2px;
    border-radius: 4px;
  }

  /* The shot: a plain product surface, no device frame. */
  .product-shot {
    min-width: 0;
  }

  .shot {
    border-radius: 16px;
    border: 1px solid var(--color-input-border);
    background: var(--color-bg-primary);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
    overflow: hidden;
  }

  :global(html.dark) .shot {
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  }

  /* Sous Chef — mirrors the /souschef unified input (purple-scoped there). */
  .souschef-shot {
    --color-primary: #a855f7;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .ss-dropzone {
    border-radius: 0.75rem;
    border: 2px dashed var(--color-input-border);
    background: var(--color-input-bg);
  }

  .ss-placeholder {
    margin: 0;
    padding: 1rem;
    min-height: 6.5rem;
    font-size: 1rem;
    color: var(--color-caption);
  }

  .ss-toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 0.5rem 1rem;
    border-top: 1px solid var(--color-input-border);
  }

  .ss-upload {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-caption);
  }

  .ss-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    border-radius: 9999px;
    background: var(--color-primary);
    color: #fff;
    font-weight: 600;
  }

  /* Nourish — the result card's own classes and spacing. */
  .nourish-shot {
    padding: 1rem 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .nr-quicktake {
    margin: 0;
    font-size: 0.875rem;
    font-style: italic;
    line-height: 1.5;
    color: var(--color-text-primary);
    padding-bottom: 0.25rem;
  }

  .nr-section {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .nr-section-label {
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-secondary);
    opacity: 0.6;
  }

  .nr-strengths {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .nr-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.25rem 0.55rem;
    border-radius: 9999px;
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
    white-space: nowrap;
  }

  .nr-dims-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.45rem;
  }

  @media (max-width: 360px) {
    .nr-dims-grid {
      grid-template-columns: 1fr;
    }
  }

  /* The tile's own track colour is tuned for the dark modal surface;
     give it a visible track on the light page too. */
  .nourish-shot :global(.tile) {
    --tile-track-bg: var(--color-input-bg);
    border-color: var(--color-input-border);
    background: var(--color-bg-secondary);
  }

  /* Cheffy — the messenger's header, thread, starters and composer. */
  .cheffy-shot {
    display: flex;
    flex-direction: column;
  }

  .ch-head {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-input-border);
  }

  .ch-head-text {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }

  .ch-head-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  .ch-head-sub {
    font-size: 0.72rem;
    color: var(--color-text-secondary);
  }

  .ch-thread {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 12px 6px;
  }

  .ch-msg {
    display: flex;
    min-width: 0;
  }

  .ch-msg-user {
    justify-content: flex-end;
  }

  .ch-bubble-user {
    max-width: 85%;
    padding: 9px 13px;
    border-radius: 15px 15px 4px 15px;
    background-color: var(--color-primary);
    color: #fff;
    font-size: 0.92rem;
    line-height: 1.4;
  }

  .ch-msg-cheffy {
    gap: 8px;
    align-items: flex-start;
  }

  .ch-text {
    padding: 9px 13px;
    border-radius: 15px 15px 15px 4px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
    font-size: 0.92rem;
    line-height: 1.5;
  }

  .ch-starters {
    padding: 6px 0 2px;
  }

  .ch-composer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    border-top: 1px solid var(--color-input-border);
    background-color: var(--color-bg-primary);
  }

  .ch-composer-icon,
  .ch-composer-send {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    border-radius: 999px;
  }

  .ch-composer-icon {
    color: var(--color-text-secondary);
  }

  .ch-composer-send {
    background-color: var(--color-primary);
    color: #fff;
  }

  .ch-composer-input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    border-radius: 18px;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-input-bg);
    color: var(--color-caption);
    font-size: 0.92rem;
  }

  /* ── 3/4. Pricing + CTA ─────────────────────────────────────── */
  .pricing {
    margin: 0 0 3rem;
  }

  .pricing-card {
    max-width: 480px;
    margin: 0 auto;
    padding: 1.5rem;
    border-radius: 20px;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  @media (min-width: 640px) {
    .pricing-card {
      padding: 2rem;
    }
  }

  .pricing-head {
    text-align: center;
  }

  .pricing-head h2 {
    margin: 0 0 0.25rem;
    font-size: 1.35rem;
    font-weight: 800;
    letter-spacing: -0.01em;
  }

  .pricing-head p {
    margin: 0;
    font-size: 0.9rem;
    color: var(--color-text-secondary);
  }

  .pricing-total {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    text-align: center;
  }

  .pricing-amount {
    font-size: 2.5rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1;
    color: var(--color-text-primary);
  }

  .pricing-per {
    font-size: 1rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    margin-left: 0.15rem;
  }

  .pricing-sub {
    font-size: 0.85rem;
    color: var(--color-text-secondary);
  }

  .pricing-reassurance {
    margin: -0.5rem 0 0;
    text-align: center;
  }

  /* ── 5. Also included ───────────────────────────────────────── */
  .included {
    max-width: 720px;
    margin: 0 auto 3.5rem;
  }

  .section-label {
    text-align: center;
    margin-bottom: 1.25rem;
    color: var(--color-text-secondary);
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
  }

  .perk-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem 1.5rem;
  }

  @media (min-width: 640px) {
    .perk-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .perk {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.5rem 0;
  }

  .perk-icon {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    color: var(--color-text-secondary);
    background: var(--color-input-bg);
  }

  .perk-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .perk-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .perk-detail {
    font-size: 0.8rem;
    color: var(--color-text-secondary);
  }

  /* ── Sticky mobile CTA ──────────────────────────────────────── */
  .sticky-cta {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(var(--bottom-nav-height, 56px) + var(--timer-widget-offset, 0px));
    z-index: 39;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.625rem max(1rem, env(safe-area-inset-right, 0px)) 0.625rem
      max(1rem, env(safe-area-inset-left, 0px));
    background: color-mix(in srgb, var(--color-bg-primary) 92%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid var(--color-input-border);
    box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.08);
    animation: sticky-rise 0.2s ease-out;
  }

  @keyframes sticky-rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sticky-cta {
      animation: none;
    }
  }

  @media (min-width: 1024px) {
    .sticky-cta {
      display: none;
    }
  }

  .sticky-cta-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.2;
  }

  .sticky-cta-title {
    font-weight: 800;
    font-size: 0.95rem;
    color: var(--color-text-primary);
  }

  .sticky-cta-price {
    font-size: 0.8rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .sticky-cta-button {
    flex-shrink: 0;
    padding: 0.7rem 1.25rem;
    font-size: 0.95rem;
    box-shadow: none;
  }

  /* ── Kept from the previous page: member dashboard ────────── */
  /* Member Dashboard */
  .member-dashboard {
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 16px;
    padding: 1.75rem;
    margin-bottom: 2rem;
    background-image: linear-gradient(135deg, rgba(249, 115, 22, 0.05) 0%, transparent 60%);
  }

  .member-dashboard-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.25rem;
  }

  .member-dashboard-identity {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .member-avatar-glow {
    border-radius: 9999px;
    box-shadow:
      0 0 12px rgba(245, 158, 11, 0.4),
      0 0 24px rgba(249, 115, 22, 0.15);
  }

  .member-avatar-glow.founders-glow {
    box-shadow:
      0 0 14px rgba(245, 158, 11, 0.5),
      0 0 28px rgba(249, 115, 22, 0.25),
      0 0 48px rgba(249, 115, 22, 0.1);
  }

  .member-dashboard-identity-text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .member-dashboard-tier {
    font-size: 0.8rem;
    color: var(--color-primary, #f97316);
    font-weight: 500;
  }

  .member-dashboard :global(.member-dashboard-display-name) {
    font-weight: 600;
    font-size: 1.05rem;
    color: var(--color-text-primary);
    cursor: default;
  }

  .member-dashboard :global(.member-dashboard-display-name:hover) {
    color: var(--color-text-primary);
  }

  .member-dashboard-active-badge {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.8rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .member-dashboard-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 1rem 0;
    border-top: 1px solid var(--color-input-border);
    border-bottom: 1px solid var(--color-input-border);
  }

  .member-dashboard-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    text-align: center;
  }

  .member-dashboard-stat-value {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  .member-dashboard-stat-label {
    font-size: 0.7rem;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .member-dashboard-perks {
    margin-bottom: 1.5rem;
  }

  .member-dashboard-perks-title {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-text-secondary);
    margin-bottom: 0.75rem;
    text-align: center;
  }

  .member-dashboard-perks-grid {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
  }

  .member-dashboard-perk {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: var(--color-text-primary);
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    background: rgba(249, 115, 22, 0.06);
    border: 1px solid rgba(249, 115, 22, 0.12);
  }

  .member-dashboard-perk :global(svg) {
    color: #f59e0b;
    flex-shrink: 0;
  }

  .member-dashboard-actions {
    display: flex;
    gap: 0.75rem;
  }

  .member-dashboard-actions .manage-subscription-button {
    flex: 1;
  }

  .member-dashboard-upgrade-button {
    flex: 1;
    padding: 0.875rem 1.5rem;
    background: var(--color-primary);
    border: 2px solid var(--color-primary);
    border-radius: 10px;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .member-dashboard-upgrade-button:hover {
    background: #d63a00;
    border-color: #d63a00;
  }

  .member-dashboard .manage-error {
    margin-bottom: 0.75rem;
  }

  @media (max-width: 480px) {
    .member-dashboard-header {
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    .member-dashboard-actions {
      flex-direction: column;
    }
  }

  .member-dashboard-cancel {
    margin-top: 1.5rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--color-input-border);
    text-align: center;
  }

  .cancel-membership-link {
    font-size: 0.8rem;
    color: var(--color-text-secondary);
    text-decoration: underline;
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
    transition: color 0.15s;
  }

  .cancel-membership-link:hover:not(:disabled) {
    color: #ef4444;
  }

  .cancel-membership-link:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    text-decoration: none;
  }

  .cancel-note {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    opacity: 0.7;
    margin-top: 0.375rem;
  }

  .cancel-error {
    font-size: 0.75rem;
    color: #ef4444;
    margin-bottom: 0.375rem;
  }

  /* ── Kept: Founders Club ────────────────────────────────── */
  /* Genesis Founders Hero Section */
  .genesis-founders-hero {
    margin: 5rem 0 3rem 0;
  }

  .genesis-hero-card {
    background: rgba(17, 24, 39, 0.6);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 2px solid;
    border-image: linear-gradient(135deg, var(--color-primary) 0%, #ff6b00 50%, #ff4500 100%) 1;
    border-radius: 16px;
    padding: 2.5rem;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow:
      0 8px 32px rgba(236, 71, 0, 0.15),
      0 0 0 1px rgba(236, 71, 0, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    position: relative;
    overflow: hidden;
  }

  .genesis-hero-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, rgba(236, 71, 0, 0.05) 0%, rgba(255, 107, 0, 0.03) 100%);
    pointer-events: none;
    z-index: 0;
  }

  .genesis-hero-card:hover {
    transform: translateY(-2px);
    box-shadow:
      0 12px 40px rgba(236, 71, 0, 0.25),
      0 0 0 1px rgba(236, 71, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
    border-image: linear-gradient(135deg, var(--color-primary) 0%, #ff8c42 50%, #ff6b00 100%) 1;
  }

  .genesis-hero-card:focus {
    outline: 2px solid var(--color-primary);
    outline-offset: 4px;
  }

  .genesis-hero-content {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    position: relative;
    z-index: 1;
  }

  .genesis-hero-icon {
    font-size: 3rem;
    line-height: 1;
    filter: drop-shadow(0 0 8px rgba(236, 71, 0, 0.4));
  }

  .genesis-hero-text {
    flex: 1;
  }

  .genesis-hero-text h2 {
    font-size: 2rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    color: #f3f4f6;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .genesis-hero-countdown {
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0;
    color: #d1d5db;
  }

  .genesis-hero-arrow {
    display: flex;
    align-items: center;
    transition: transform 0.3s ease;
  }

  .arrow-icon {
    color: #d1d5db;
    transition: transform 0.3s ease;
  }

  .arrow-icon.rotated {
    transform: rotate(180deg);
  }

  .genesis-hero-progress {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(236, 71, 0, 0.2);
    position: relative;
    z-index: 1;
  }

  .progress-bar {
    width: 100%;
    height: 4px;
    background: rgba(236, 71, 0, 0.15);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 0.75rem;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--color-primary) 0%, #ff8c42 100%);
    border-radius: 2px;
    box-shadow: 0 0 8px rgba(236, 71, 0, 0.4);
    animation: fillProgress 1.2s ease-out;
  }

  @keyframes fillProgress {
    from {
      width: 0;
    }
  }

  .progress-text {
    color: #9ca3af;
    font-size: 0.9rem;
    margin: 0;
    text-align: center;
    font-weight: 500;
  }

  /* Dark mode adjustments */
  html.dark .genesis-hero-card {
    background: rgba(31, 41, 55, 0.7);
    border-image: linear-gradient(135deg, #ff5722 0%, #ff8c42 50%, #ff6b00 100%) 1;
  }

  html.dark .genesis-hero-card::before {
    background: linear-gradient(135deg, rgba(255, 87, 34, 0.08) 0%, rgba(255, 140, 66, 0.05) 100%);
  }

  html.dark .genesis-hero-text h2 {
    color: #f9fafb;
  }

  html.dark .genesis-hero-countdown {
    color: #e5e7eb;
  }

  html.dark .arrow-icon {
    color: #e5e7eb;
  }

  html.dark .progress-text {
    color: #d1d5db;
  }

  .genesis-hero-card.sold-out {
    opacity: 0.7;
    cursor: not-allowed;
  }

  /* Genesis Checkout Section */
  .genesis-checkout-section {
    margin: 2rem 0;
  }

  .genesis-checkout-card {
    background: rgba(17, 24, 39, 0.6);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 2px solid;
    border-image: linear-gradient(135deg, var(--color-primary) 0%, #ff6b00 50%, #ff4500 100%) 1;
    border-radius: 16px;
    padding: 2.5rem;
    box-shadow:
      0 8px 32px rgba(236, 71, 0, 0.15),
      0 0 0 1px rgba(236, 71, 0, 0.1);
  }

  .genesis-checkout-header {
    text-align: center;
    margin-bottom: 2rem;
  }

  .genesis-checkout-header h3 {
    font-size: 2rem;
    font-weight: 700;
    color: #f3f4f6;
    margin: 0 0 0.5rem 0;
  }

  .genesis-checkout-price {
    font-size: 2.5rem;
    font-weight: 900;
    color: var(--color-primary);
    margin: 0;
  }

  .genesis-checkout-price span {
    font-size: 1.2rem;
    font-weight: 400;
    color: #9ca3af;
  }

  .genesis-checkout-benefits {
    margin-bottom: 2rem;
  }

  .genesis-checkout-benefits h4 {
    font-size: 1.2rem;
    font-weight: 600;
    color: #f3f4f6;
    margin: 0 0 1.5rem 0;
  }

  .genesis-checkout-benefits .benefit-section {
    margin-bottom: 1.5rem;
  }

  .genesis-checkout-benefits .benefit-section:last-of-type {
    margin-bottom: 0;
  }

  .genesis-checkout-benefits .section-header {
    font-size: 0.875rem;
    font-weight: 700;
    color: #f3f4f6;
    margin: 0 0 0.75rem 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .genesis-checkout-benefits .section-divider {
    height: 1px;
    background: rgba(236, 71, 0, 0.15);
    margin: 1.5rem 0;
  }

  .genesis-checkout-benefits .benefit-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .genesis-checkout-benefits .benefit-list li {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 0;
    color: #d1d5db;
    font-size: 1rem;
    border-bottom: none;
  }

  .genesis-checkout-benefits .checkmark {
    color: #22c55e;
    font-weight: bold;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .genesis-checkout-benefits .feature-text {
    color: #d1d5db;
    line-height: 1.5;
  }

  .genesis-checkout-urgency {
    text-align: center;
    margin-bottom: 2rem;
    padding: 1rem;
    background: rgba(236, 71, 0, 0.1);
    border-radius: 8px;
  }

  .genesis-checkout-urgency p {
    margin: 0;
    color: #f3f4f6;
    font-size: 1.1rem;
  }

  .genesis-checkout-urgency strong {
    color: var(--color-primary);
    font-weight: 700;
  }

  .genesis-claim-button {
    width: 100%;
    padding: 1.25rem 2rem;
    background: linear-gradient(135deg, var(--color-primary) 0%, #ff6b00 100%);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 1.25rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(236, 71, 0, 0.3);
  }

  .genesis-claim-button:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(236, 71, 0, 0.4);
    background: linear-gradient(135deg, #ff5722 0%, #ff8c42 100%);
  }

  .genesis-claim-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  html.dark .genesis-checkout-card {
    background: rgba(31, 41, 55, 0.7);
  }

  /* Founders Club Link */
  .genesis-founders-link {
    text-align: center;
    margin: 1.5rem 0 2rem;
  }

  .founders-link-button {
    display: inline-block;
    padding: 0.75rem 2rem;
    background: transparent;
    border: 2px solid var(--color-primary);
    border-radius: 12px;
    color: var(--color-primary);
    font-size: 1rem;
    font-weight: 600;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .founders-link-button:hover {
    background: var(--color-primary);
    color: white;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(236, 71, 0, 0.3);
  }

  /* ── Kept: benefit list primitives used by the Founders card ── */
  .benefit-section {
    margin-bottom: 1.5rem;
  }

  .benefit-section:last-of-type {
    margin-bottom: 0;
  }

  .section-header {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--color-text-primary);
    margin: 0 0 0.75rem 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .section-divider {
    height: 1px;
    background: rgba(236, 71, 0, 0.15);
    margin: 1.5rem 0;
  }

  .benefit-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .benefit-list li {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 0;
    color: var(--color-text-primary);
  }

  .checkmark {
    color: #22c55e;
    font-weight: bold;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .feature-text {
    color: var(--color-text-primary);
    line-height: 1.5;
  }

  .feature-link {
    color: var(--color-text-primary);
    text-decoration: none;
    line-height: 1.5;
  }

  .feature-link:hover {
    text-decoration: underline;
  }

  /* ── Kept: legacy active-membership card + manage button ──── */
  /* Active Membership Management */
  .active-membership {
    margin: 2rem 0 3rem 0;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }

  .active-membership-card {
    background: rgba(17, 24, 39, 0.6);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 2px solid rgba(34, 197, 94, 0.4);
    border-radius: 16px;
    padding: 2rem;
  }

  .active-membership-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .active-membership-header h3 {
    font-size: 1.25rem;
    font-weight: 700;
    color: #f3f4f6;
    margin: 0;
  }

  .active-badge {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .active-membership-details {
    margin-bottom: 1.5rem;
  }

  .membership-tier-name {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-primary);
    margin: 0 0 0.25rem 0;
  }

  .membership-expiry {
    color: #9ca3af;
    font-size: 0.95rem;
    margin: 0;
  }

  .manage-error {
    background: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.3);
    color: #ef4444;
    padding: 0.75rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    font-size: 0.9rem;
    text-align: center;
  }

  .manage-subscription-button {
    width: 100%;
    padding: 0.875rem 1.5rem;
    background: transparent;
    border: 2px solid var(--color-primary);
    border-radius: 10px;
    color: var(--color-primary);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .manage-subscription-button:hover:not(:disabled) {
    background: var(--color-primary);
    color: white;
  }

  .manage-subscription-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  html.dark .active-membership-card {
    background: rgba(31, 41, 55, 0.7);
  }

  /* ── Kept: Founders copy, FAQ, card hint ────────────────── */
  .founders-story-copy {
    color: var(--color-text-secondary);
    font-size: 0.95rem;
    line-height: 1.5;
    margin: 0.75rem 0 0 0;
    position: relative;
    z-index: 1;
    text-align: left;
  }

  .membership-faq {
    max-width: 720px;
    margin: 2.5rem auto 1rem;
  }

  .faq-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .faq-item {
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
    background: var(--color-bg-secondary);
    overflow: hidden;
  }

  .faq-question {
    width: 100%;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.15rem;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--color-text-primary);
    font-size: 1rem;
    font-weight: 600;
  }

  .faq-chevron {
    color: var(--color-text-secondary);
    font-size: 1.25rem;
    line-height: 1;
  }

  .faq-answer {
    padding: 0 1.15rem 1.15rem;
    color: var(--color-text-secondary);
    font-size: 0.95rem;
    line-height: 1.55;
  }

  .faq-answer p {
    margin: 0;
  }

  /* Card hint */
  .card-hint {
    color: #9ca3af;
    font-size: 0.8rem;
    text-align: center;
    margin: 0.75rem 0 0 0;
    opacity: 0.6;
    position: relative;
    z-index: 1;
  }
</style>
