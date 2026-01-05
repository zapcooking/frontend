<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import HeroSection from './HeroSection.svelte';
  import UltraLimitedBanner from './UltraLimitedBanner.svelte';
  import PricingToggle from './PricingToggle.svelte';
  import PricingGrid from './PricingGrid.svelte';
  import TimelineSection from './TimelineSection.svelte';
  import FAQSection from './FAQSection.svelte';
  import PaymentModal from './PaymentModal.svelte';
  import { paymentStore, type PricingPeriod } from './paymentStore';
  import { userPublickey } from '$lib/nostr';

  // Global page state
  let pricingPeriod: PricingPeriod = 'annual';
  let spotsRemaining = 17; // First 21 counter (0-21) - TODO: Connect to backend
  let foundingSpotsFilled = 4; // Total founding spots (0-50) - TODO: Connect to backend
  let activeFaqIndex: number | null = null;

  $: showSoldOutState = spotsRemaining === 0;
  $: progressPercentage = ((21 - spotsRemaining) / 21) * 100;

  // Handle Stripe success redirect
  onMount(() => {
    if (!browser) return;
    
    const paymentStatus = $page.url.searchParams.get('payment');
    const sessionId = $page.url.searchParams.get('session_id');
    
    if (paymentStatus === 'success' && sessionId) {
      // Restore tier/period from localStorage if available
      try {
        const stored = localStorage.getItem('pending_stripe_payment');
        if (stored) {
          const { tier, period } = JSON.parse(stored);
          // Restore payment state
          paymentStore.openPayment(tier, period);
          // Clean up localStorage
          localStorage.removeItem('pending_stripe_payment');
        }
      } catch (e) {
        console.warn('Failed to restore payment state from localStorage:', e);
      }
      
      // Complete the payment and show success screen
      // In production, verify the session with Stripe API first
      paymentStore.completePayment('card', $userPublickey || null);
      
      // Clean up URL params after a short delay to let the modal open
      setTimeout(() => {
        goto('/membership', { replaceState: true });
      }, 100);
    } else if (paymentStatus === 'canceled') {
      // User canceled - clean up localStorage and close modal
      try {
        localStorage.removeItem('pending_stripe_payment');
      } catch (e) {}
      paymentStore.close();
      goto('/membership', { replaceState: true });
    }
  });

  // TODO: Connect to backend API for real-time updates
  // onMount(async () => {
  //   const response = await fetch('/api/founding-spots');
  //   const data = await response.json();
  //   spotsRemaining = data.first21Remaining;
  //   foundingSpotsFilled = data.totalFilled;
  // });
</script>

<svelte:head>
  <title>Membership - zap.cooking</title>
  <meta
    name="description"
    content="Join Zap Cooking as a founding member. Choose from Open Table (free), Cook+ (45,000 sats/year), or Pro Kitchen (140,000 sats/year) with exclusive founding perks."
  />
</svelte:head>

<!-- Main container with responsive padding -->
<div class="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8 lg:py-16">
  <HeroSection />
  
  <!-- Genesis Founder Banner -->
  <div class="mt-6 sm:mt-10 lg:mt-16">
    <UltraLimitedBanner 
      {spotsRemaining}
      {progressPercentage}
      {showSoldOutState}
    />
  </div>

  <!-- Pricing Toggle -->
  <div class="mt-8 sm:mt-10 lg:mt-16">
    <PricingToggle 
      period={pricingPeriod}
      onPeriodChange={(period) => pricingPeriod = period}
    />
  </div>

  <!-- Pricing Cards -->
  <div class="mt-6 sm:mt-8 lg:mt-8">
    <PricingGrid 
      period={pricingPeriod}
      {spotsRemaining}
      {showSoldOutState}
    />
  </div>

  <!-- Timeline Section -->
  <div class="mt-12 sm:mt-16 lg:mt-24">
    <TimelineSection 
      {foundingSpotsFilled}
      {spotsRemaining}
    />
  </div>

  <!-- FAQ Section -->
  <div class="mt-12 sm:mt-16 lg:mt-24">
    <FAQSection 
      activeIndex={activeFaqIndex}
      onToggle={(index) => activeFaqIndex = activeFaqIndex === index ? null : index}
    />
  </div>

  <!-- Footer Notes -->
  <div class="mt-12 sm:mt-16 lg:mt-24 pt-6 sm:pt-8 border-t border-gray-200 dark:border-gray-700">
    <div class="text-center space-y-3 sm:space-y-4">
      <p class="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
        Built on Nostr. Powered by Lightning. ⚡️
      </p>
      <div class="flex flex-wrap justify-center gap-2 sm:gap-4 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
        <a href="/privacy" class="hover:text-primary transition-colors py-1 px-1">Privacy Policy</a>
        <span class="hidden sm:inline">•</span>
        <a href="/about" class="hover:text-primary transition-colors py-1 px-1">About</a>
        <span class="hidden sm:inline">•</span>
        <a href="https://github.com/zapcooking/frontend" target="_blank" rel="noopener noreferrer" class="hover:text-primary transition-colors py-1 px-1">
          Open Source
        </a>
      </div>
    </div>
  </div>
</div>

<!-- Payment Modal (portal to body) -->
<PaymentModal />
