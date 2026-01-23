<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import ChefHatIcon from 'phosphor-svelte/lib/CookingPot';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import CrownIcon from 'phosphor-svelte/lib/Crown';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { goto } from '$app/navigation';
  import { paymentStore, tierPricing, formatSats, formatUSD, type PricingPeriod } from './paymentStore';

  type Tier = 'open' | 'cook' | 'pro';

  export let tier: Tier;
  export let period: PricingPeriod;
  export let spotsRemaining: number | undefined = undefined;
  export let showSoldOutState: boolean | undefined = undefined;

  // Badge disclosure state
  let badgeExpanded = false;

  function toggleBadge(e: MouseEvent) {
    e.stopPropagation();
    badgeExpanded = !badgeExpanded;
  }

  // Tier configuration - updated with new names and pricing
  const tierConfig = {
    open: {
      name: 'Open Table',
      icon: ChefHatIcon,
      description: 'For explorers and home cooks',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      ctaText: 'Get Started Free',
      features: [
        'Browse all recipes',
        'Create and share recipes',
        'Follow other cooks',
        'Basic profile features',
        'Community access'
      ]
    },
    cook: {
      name: 'Cook+',
      icon: HeartIcon,
      description: 'For supporters and active members',
      iconColor: 'text-pink-600 dark:text-pink-400',
      ctaText: 'Join Cook+',
      features: [
        'Everything in Open Table',
        'Priority support',
        'Exclusive Cook+ badge',
        'Verified @zap.cooking NIP-05 identity',
        'Early access to new features',
        'Support the platform directly',
        'Founding member recognition'
      ]
    },
    pro: {
      name: 'Pro Kitchen',
      icon: CrownIcon,
      description: 'For serious creators and founders',
      iconColor: 'text-orange-600 dark:text-orange-400',
      ctaText: 'Claim Founder Spot',
      features: [
        'Everything in Cook+',
        'Lightning-gated recipes',
        'Advanced analytics',
        'Creator tools and features',
        'Priority recipe promotion',
        'Direct platform partnership'
      ]
    }
  };

  $: config = tierConfig[tier];
  $: IconComponent = config.icon;
  
  // Pricing - use tierPricing for paid tiers
  $: isFree = tier === 'open';
  $: pricing = !isFree ? tierPricing[tier as 'cook' | 'pro'] : null;
  $: currentPricing = pricing ? (period === 'annual' ? pricing.annual : pricing.twoYear) : null;
  
  // Pro tier specific
  $: isProTier = tier === 'pro';
  $: showFoundingBadge = isProTier && spotsRemaining !== undefined && spotsRemaining > 0;
  $: isSoldOut = isProTier && showSoldOutState && spotsRemaining === 0;

  // CTA text
  $: ctaText = isSoldOut ? 'Sold Out' : config.ctaText;

  // Mobile features accordion
  let mobileExpanded = false;
  let isMobile = false;

  onMount(() => {
    if (browser) {
      const checkMobile = () => {
        isMobile = window.innerWidth < 640;
      };
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }
  });

  $: shouldShowFeatures = !isMobile || mobileExpanded;

  function toggleMobileFeatures(e: MouseEvent) {
    e.stopPropagation();
    mobileExpanded = !mobileExpanded;
  }

  function handleCTA() {
    if (isSoldOut) return;
    
    if (tier === 'open') {
      goto('/explore');
    } else {
      // Open payment modal
      paymentStore.openPayment(tier, period);
    }
  }

  function handleWaitlist(e: MouseEvent) {
    e.stopPropagation();
    // TODO: Connect to waitlist
    console.log('Join waitlist clicked');
  }

  // Card styling based on tier
  $: cardClasses = {
    open: 'bg-white border-gray-200 dark:border-gray-600',
    cook: 'bg-white border-gray-200 dark:border-gray-600',
    pro: 'bg-gradient-to-br from-orange-50 to-amber-50 border-orange-400 dark:border-orange-500'
  }[tier];

  // Button styling based on tier
  $: buttonClasses = {
    open: 'bg-gray-900 text-white hover:bg-gray-800',
    cook: 'bg-pink-600 text-white hover:bg-pink-700',
    pro: 'bg-orange-500 text-white hover:bg-orange-600'
  }[tier];
</script>

<div
  class="tier-card flex flex-col rounded-2xl border-2 transition-all duration-300 hover:shadow-xl cursor-pointer {cardClasses}"
  on:click={handleCTA}
  on:keypress={(e) => e.key === 'Enter' && handleCTA()}
  role="button"
  tabindex="0"
>
  <!-- ===== FIXED TOP SECTION ===== -->
  <div class="tier-card-top">
    <!-- Header: Icon + Tier Name -->
    <div class="tier-header">
      <svelte:component this={IconComponent} size={28} weight="fill" class="{config.iconColor} flex-shrink-0" />
      <h2 class="text-xl font-bold !text-black leading-tight">
        {config.name}
      </h2>
    </div>
    
    <!-- Description -->
    <p class="tier-description">{config.description}</p>

    <!-- Price Block -->
    <div class="tier-price">
      {#if isFree}
        <div class="flex items-baseline gap-2">
          <span class="text-4xl font-bold text-gray-900">Free</span>
        </div>
        <p class="text-sm text-gray-500 mt-1">Forever free</p>
      {:else if currentPricing}
        <!-- Bitcoin Price (primary) -->
        <div class="flex items-center gap-2 mb-1">
          <LightningIcon size={20} weight="fill" class="text-orange-500" />
          <span class="text-3xl font-bold text-orange-600 dark:text-orange-500">
            {formatSats(currentPricing.sats)}
          </span>
          <span class="text-base text-gray-600 font-medium">sats{period === 'annual' ? '/year' : ''}</span>
        </div>
        <!-- USD Alternative -->
        <p class="text-sm text-gray-500">
          or {formatUSD(currentPricing.usd)}{period === 'annual' ? '/year' : ' for 2 years'} via card
        </p>
      {/if}
    </div>

    <!-- Pro Badge (Limited Founding Spots) -->
    {#if showFoundingBadge}
      <div class="tier-badge">
        <button
          type="button"
          on:click={toggleBadge}
          class="inline-flex items-center gap-2 px-3 py-2 bg-orange-500 text-white text-sm font-semibold rounded-full
                 hover:bg-orange-600 active:bg-orange-700 transition-colors cursor-pointer
                 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
          aria-expanded={badgeExpanded}
        >
          <span>Limited: {spotsRemaining} Spots</span>
          <CaretDownIcon size={16} class="transition-transform {badgeExpanded ? 'rotate-180' : ''}" />
        </button>
        
        {#if badgeExpanded}
          <div class="mt-3 p-3 bg-orange-100 dark:bg-orange-900/30 rounded-lg text-sm text-gray-700 dark:text-gray-300">
            <p class="font-medium text-orange-700 dark:text-orange-400 mb-2">Founders Club Perks:</p>
            <ul class="space-y-1.5 text-gray-600 dark:text-gray-400">
              <li>• Custom Zap Cooking T-shirt</li>
              <li>• Personalized desk plaque</li>
              <li>• Free worldwide shipping</li>
            </ul>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Sold Out Badge -->
    {#if isSoldOut}
      <div class="tier-badge">
        <span class="inline-block px-3 py-2 bg-gray-200 text-gray-600 text-sm font-semibold rounded-full">
          Founder spots filled
        </span>
      </div>
    {/if}
  </div>

  <!-- ===== FLEX SPACER ===== -->
  <div class="tier-spacer"></div>

  <!-- ===== FIXED BOTTOM SECTION ===== -->
  <div class="tier-card-bottom">
    <!-- Disclosure Row: "What's included" -->
    {#if isMobile}
      <button
        on:click={toggleMobileFeatures}
        type="button"
        class="tier-disclosure-row"
        aria-expanded={mobileExpanded}
      >
        <span class="font-semibold text-base text-gray-900">What's included</span>
        <CaretDownIcon 
          size={20} 
          class="text-gray-500 transition-transform duration-200 flex-shrink-0 {mobileExpanded ? 'rotate-180' : ''}" 
        />
      </button>
    {:else}
      <h3 class="font-semibold mb-3 text-gray-900 text-sm uppercase tracking-wide">What's included</h3>
    {/if}

    <!-- Features List -->
    {#if shouldShowFeatures}
      <ul class="tier-features-list">
        {#each config.features as feature}
          <li class="flex items-start gap-3">
            <CheckIcon size={20} weight="bold" class="text-emerald-500 flex-shrink-0 mt-0.5" />
            <span class="text-sm text-gray-700 leading-relaxed">{feature}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- CTA Button -->
    <div class="tier-cta">
      <button
        type="button"
        on:click|stopPropagation={handleCTA}
        disabled={isSoldOut}
        class="tier-cta-button {isSoldOut ? 'tier-cta-disabled' : buttonClasses}"
        aria-label={ctaText}
      >
        {ctaText}
      </button>

      {#if isSoldOut}
        <div class="mt-3 text-center">
          <button
            type="button"
            on:click={handleWaitlist}
            class="text-sm font-medium text-orange-600 hover:text-orange-700 
                   underline underline-offset-2 transition-colors py-2 px-2"
          >
            Join the waitlist →
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* ===== CARD CONTAINER ===== */
  .tier-card {
    min-height: 420px;
    padding: 20px;
    width: 100%;
  }

  @media (min-width: 640px) {
    .tier-card {
      min-height: auto;
      padding: 24px;
    }
  }

  @media (min-width: 1024px) {
    .tier-card {
      padding: 32px;
    }
  }

  /* ===== TOP SECTION ===== */
  .tier-card-top {
    flex-shrink: 0;
  }

  .tier-header {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 36px;
    margin-bottom: 8px;
  }

  .tier-description {
    font-size: 14px;
    line-height: 1.5;
    color: #4b5563;
    height: 42px;
    margin-bottom: 16px;
    overflow: hidden;
  }

  .tier-price {
    min-height: 72px;
    margin-bottom: 16px;
  }

  .tier-badge {
    margin-bottom: 16px;
  }

  /* ===== FLEX SPACER ===== */
  .tier-spacer {
    flex: 1;
    min-height: 8px;
  }

  /* ===== BOTTOM SECTION ===== */
  .tier-card-bottom {
    flex-shrink: 0;
  }

  .tier-disclosure-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 52px;
    padding: 0 20px;
    margin: 0 -20px;
    border-top: 1px solid #e5e7eb;
    border-bottom: 1px solid #e5e7eb;
    background: transparent;
    cursor: pointer;
    text-align: left;
  }

  .tier-disclosure-row:focus {
    outline: none;
    background-color: rgba(0, 0, 0, 0.02);
  }

  .tier-features-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 16px;
    padding-bottom: 16px;
  }

  /* ===== CTA BUTTON ===== */
  .tier-cta {
    padding-top: 8px;
  }

  .tier-cta-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 56px;
    padding: 0 24px;
    border-radius: 9999px;
    font-size: 16px;
    font-weight: 600;
    transition: all 0.2s;
  }

  .tier-cta-button:focus {
    outline: none;
    box-shadow: 0 0 0 4px rgba(236, 71, 0, 0.3);
  }

  .tier-cta-disabled {
    background-color: #e5e7eb;
    color: #6b7280;
    cursor: not-allowed;
  }
</style>
