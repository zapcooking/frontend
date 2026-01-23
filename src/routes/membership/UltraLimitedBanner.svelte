<script lang="ts">
  import { browser } from '$app/environment';
  import ShirtIcon from 'phosphor-svelte/lib/TShirt';
  import PlaqueIcon from 'phosphor-svelte/lib/IdentificationBadge';
  import PackageIcon from 'phosphor-svelte/lib/Package';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';

  export let spotsRemaining: number;
  export let progressPercentage: number;
  export let showSoldOutState: boolean;

  // Constants
  const totalSpots = 21;
  $: spotsFilled = totalSpots - spotsRemaining;
  $: displayProgress = progressPercentage;

  // Disclosure state for "Why 21?"
  let whyExpanded = false;

  function toggleWhy() {
    whyExpanded = !whyExpanded;
  }

  function handleClaim() {
    // TODO: Connect to checkout/payment flow
    console.log('Claim Founders Club Spot clicked');
    // For now, scroll to pricing section
    if (browser) {
      const pricingSection = document.querySelector('[data-pricing-grid]');
      if (pricingSection) {
        pricingSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  function handleWaitlist() {
    // TODO: Connect to waitlist signup
    console.log('Join waitlist clicked');
  }
</script>

<div class="max-w-4xl mx-auto px-1 sm:px-0">
  <div class="border-3 sm:border-4 border-orange-500 dark:border-orange-400 rounded-xl sm:rounded-2xl p-4 sm:p-6 lg:p-8 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30">
    {#if showSoldOutState}
      <!-- Sold Out State -->
      <div class="text-center">
        <!-- Micro-label -->
        <p class="text-xs sm:text-sm font-medium tracking-wide uppercase text-gray-500 dark:text-gray-400 mb-1 sm:mb-2">
          Founding Membership Limit
        </p>
        
        <div class="text-5xl sm:text-6xl lg:text-8xl font-bold text-gray-400 dark:text-gray-500 mb-2 sm:mb-4">
          {totalSpots}
        </div>
        
        <p class="text-xl sm:text-2xl lg:text-3xl font-semibold text-gray-900 dark:text-gray-100 mb-1 sm:mb-2">
          Founders Club Spots
        </p>
        
        <div class="text-2xl sm:text-3xl lg:text-4xl font-bold text-orange-600 dark:text-orange-400 mb-4 sm:mb-6">
          SOLD OUT
        </div>

        <!-- Disabled CTA -->
        <div class="flex flex-col items-center gap-3 mb-4 sm:mb-6">
          <button
            type="button"
            disabled
            class="w-full sm:w-auto sm:min-w-[320px] sm:max-w-[420px] px-6 sm:px-8 py-3.5 sm:py-4 rounded-full font-bold text-base sm:text-lg
                   bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400
                   cursor-not-allowed"
            aria-disabled="true"
          >
            Sold Out
          </button>
          <button
            type="button"
            on:click={handleWaitlist}
            class="text-sm font-medium text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 
                   underline underline-offset-2 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 rounded
                   py-2 px-4 -my-2 -mx-4"
          >
            Join the waitlist →
          </button>
        </div>

        <p class="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
          Join spots 22-50 for digital founding benefits.
        </p>
      </div>
    {:else}
      <!-- Active State -->
      <div class="text-center">
        <!-- Micro-label above the number -->
        <p class="text-xs sm:text-sm font-medium tracking-wide uppercase text-gray-500 dark:text-gray-400 mb-1 sm:mb-2">
          Founding Membership Limit
        </p>
        
        <!-- Big number -->
        <div class="text-6xl sm:text-7xl lg:text-9xl font-bold text-orange-600 dark:text-orange-400 mb-1 sm:mb-2 leading-none">
          {totalSpots}
        </div>
        
        <!-- Title -->
        <p class="text-lg sm:text-2xl lg:text-3xl font-semibold text-gray-900 dark:text-gray-100 mb-1 sm:mb-2">
          Founders Club Spots
        </p>
        
        <!-- Remaining count -->
        <div class="text-2xl sm:text-3xl lg:text-4xl font-bold text-orange-600 dark:text-orange-400 mb-4 sm:mb-6">
          {spotsRemaining}/{totalSpots} REMAINING
        </div>

        <!-- Primary CTA -->
        <div class="mb-6 sm:mb-8">
          <button
            type="button"
            on:click={handleClaim}
            class="w-full sm:w-auto sm:min-w-[320px] sm:max-w-[420px] px-6 sm:px-8 py-3.5 sm:py-4 rounded-full font-bold text-base sm:text-lg
                   bg-orange-500 hover:bg-orange-600 active:bg-orange-700
                   text-white shadow-lg hover:shadow-xl
                   transform hover:scale-[1.02] active:scale-[0.98]
                   transition-all duration-200 ease-out
                   focus:outline-none focus:ring-4 focus:ring-orange-500/50"
            aria-label="Claim a Founders Club Spot"
          >
            Claim a Founders Club Spot
          </button>
        </div>

        <!-- Perks Section - Stacked on mobile, row on larger screens -->
        <div class="mb-6 sm:mb-8 py-3 sm:py-4 border-t border-b border-orange-200 dark:border-orange-800/50">
          <p class="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 mb-3 sm:mb-0 sm:sr-only">Perks included:</p>
          
          <!-- Mobile: Grid layout, Desktop: Flex row -->
          <div class="grid grid-cols-3 gap-2 sm:flex sm:items-center sm:justify-center sm:gap-6">
            <div class="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5">
              <ShirtIcon size={20} weight="fill" class="text-orange-500 dark:text-orange-400 sm:w-6 sm:h-6" />
              <span class="text-xs text-gray-600 dark:text-gray-400">Shirt</span>
            </div>
            <div class="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5">
              <PlaqueIcon size={20} weight="fill" class="text-orange-500 dark:text-orange-400 sm:w-6 sm:h-6" />
              <span class="text-xs text-gray-600 dark:text-gray-400">Plaque</span>
            </div>
            <div class="flex flex-col sm:flex-row items-center gap-1 sm:gap-1.5">
              <PackageIcon size={20} weight="fill" class="text-orange-500 dark:text-orange-400 sm:w-6 sm:h-6" />
              <span class="text-xs text-gray-600 dark:text-gray-400">Shipping</span>
            </div>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="mb-3 sm:mb-4">
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 sm:h-3 lg:h-4 overflow-hidden">
            <div 
              class="bg-gradient-to-r from-orange-500 to-amber-500 h-full rounded-full transition-all duration-500 ease-out"
              style="width: {displayProgress}%"
              role="progressbar"
              aria-valuenow={displayProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="{spotsFilled} of {totalSpots} spots claimed"
            >
            </div>
          </div>
          <!-- Single consolidated line -->
          <p class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1.5 sm:mt-2 text-center">
            {spotsFilled} claimed · {spotsRemaining} remaining
          </p>
        </div>

        <!-- Why 21? Disclosure -->
        <div class="mt-4 sm:mt-6">
          <button
            type="button"
            on:click={toggleWhy}
            class="inline-flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm text-gray-500 dark:text-gray-400 
                   hover:text-orange-600 dark:hover:text-orange-400 
                   transition-colors cursor-pointer
                   focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 rounded-md px-2 py-1.5 -mx-2"
            aria-expanded={whyExpanded}
            aria-controls="why-21-content"
          >
            <span>Why 21?</span>
            <span class="text-orange-500">₿</span>
            <CaretDownIcon 
              size={14} 
              class="transition-transform duration-200 {whyExpanded ? 'rotate-180' : ''}" 
            />
          </button>
          
          {#if whyExpanded}
            <div 
              id="why-21-content"
              class="mt-2 sm:mt-3 mx-auto max-w-md p-3 sm:p-4 bg-white/60 dark:bg-gray-800/60 rounded-lg text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed"
              role="region"
              aria-label="Why 21 explanation"
            >
              <p>
                <strong class="text-orange-600 dark:text-orange-400">21</strong> is a nod to Bitcoin's fixed supply and digital scarcity done right. 
                Founders Club members help fund development and set the tone for the community.
              </p>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Custom border width for mobile */
  .border-3 {
    border-width: 3px;
  }
</style>
