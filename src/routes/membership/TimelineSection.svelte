<script lang="ts">
  export let foundingSpotsFilled: number;
  export let spotsRemaining: number;

  const totalFoundingSpots = 50;
  $: progressPercentage = (foundingSpotsFilled / totalFoundingSpots) * 100;
  $: displayProgress = progressPercentage;

  $: currentPhase = 
    foundingSpotsFilled < 21 ? 'first21' :
    foundingSpotsFilled < 50 ? 'founding' :
    'regular';

  function handleCTAClick() {
    // TODO: Navigate to payment flow
    console.log('Navigate to payment');
  }
</script>

<div class="max-w-4xl mx-auto px-1 sm:px-0">
  <h2 class="text-2xl sm:text-3xl lg:text-4xl font-bold text-center mb-6 sm:mb-8 text-gray-900 dark:text-white">
    Founding Member Timeline
  </h2>

  <!-- Progress Indicator -->
  <div class="mb-8 sm:mb-12">
    <div class="text-center mb-3 sm:mb-4">
      <div class="text-3xl sm:text-4xl lg:text-5xl font-bold text-orange-600 dark:text-orange-400 mb-1 sm:mb-2">
        {foundingSpotsFilled}/50
      </div>
      <p class="text-sm sm:text-lg text-gray-600 dark:text-gray-400">
        founding spots filled
      </p>
    </div>
    
    <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4 sm:h-6 overflow-hidden">
      <div 
        class="bg-gradient-to-r from-orange-500 to-amber-500 h-full rounded-full transition-all duration-500 ease-out"
        style="width: {displayProgress}%"
        role="progressbar"
        aria-valuenow={displayProgress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
      </div>
    </div>
  </div>

  <!-- Timeline Phases -->
  <div class="space-y-6 sm:space-y-8 mb-8 sm:mb-12">
    <!-- Phase 1: First 21 -->
    <div class="relative pl-6 sm:pl-8 pb-6 sm:pb-8 border-l-2 sm:border-l-4 {currentPhase === 'first21' ? 'border-orange-500' : 'border-gray-300 dark:border-gray-600'}">
      <div class="absolute -left-2 sm:-left-3 top-0 w-4 h-4 sm:w-6 sm:h-6 rounded-full {currentPhase === 'first21' ? 'bg-orange-500 ring-2 sm:ring-4 ring-orange-200 dark:ring-orange-900' : 'bg-gray-300 dark:bg-gray-600'}"></div>
      <div class="ml-2 sm:ml-4">
        <div class="flex flex-wrap items-center gap-2 mb-1.5 sm:mb-2">
          <h3 class="text-base sm:text-xl font-bold text-gray-900 dark:text-white">
            Week 1-2: First 21
          </h3>
          {#if currentPhase === 'first21'}
            <span class="px-2 py-0.5 sm:py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-xs font-semibold rounded-full">
              Current
            </span>
          {/if}
        </div>
        <p class="text-sm sm:text-base text-gray-600 dark:text-gray-400 mb-1.5 sm:mb-2">
          Physical perks: T-shirt, desk plate, and shipping included
        </p>
        {#if spotsRemaining > 0 && spotsRemaining <= 21}
          <p class="text-xs sm:text-sm font-semibold text-orange-600 dark:text-orange-400">
            {spotsRemaining} spots remaining in this phase
          </p>
        {:else if spotsRemaining === 0}
          <p class="text-xs sm:text-sm font-semibold text-gray-600 dark:text-gray-400">
            This phase is complete
          </p>
        {/if}
      </div>
    </div>

    <!-- Phase 2: Spots 22-50 -->
    <div class="relative pl-6 sm:pl-8 pb-6 sm:pb-8 border-l-2 sm:border-l-4 {currentPhase === 'founding' ? 'border-orange-500' : 'border-gray-300 dark:border-gray-600'}">
      <div class="absolute -left-2 sm:-left-3 top-0 w-4 h-4 sm:w-6 sm:h-6 rounded-full {currentPhase === 'founding' ? 'bg-orange-500 ring-2 sm:ring-4 ring-orange-200 dark:ring-orange-900' : 'bg-gray-300 dark:bg-gray-600'}"></div>
      <div class="ml-2 sm:ml-4">
        <div class="flex flex-wrap items-center gap-2 mb-1.5 sm:mb-2">
          <h3 class="text-base sm:text-xl font-bold text-gray-900 dark:text-white">
            Week 3-8: Spots 22-50
          </h3>
          {#if currentPhase === 'founding'}
            <span class="px-2 py-0.5 sm:py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-xs font-semibold rounded-full">
              Current
            </span>
          {/if}
        </div>
        <p class="text-sm sm:text-base text-gray-600 dark:text-gray-400 mb-1.5 sm:mb-2">
          Digital founding benefits: Badge, early access, and recognition
        </p>
        {#if currentPhase === 'founding'}
          <p class="text-xs sm:text-sm font-semibold text-orange-600 dark:text-orange-400">
            {50 - foundingSpotsFilled} spots remaining in this phase
          </p>
        {:else if foundingSpotsFilled >= 50}
          <p class="text-xs sm:text-sm font-semibold text-gray-600 dark:text-gray-400">
            This phase is complete
          </p>
        {/if}
      </div>
    </div>

    <!-- Phase 3: After 50 -->
    <div class="relative pl-6 sm:pl-8 border-l-2 sm:border-l-4 {currentPhase === 'regular' ? 'border-orange-500' : 'border-gray-300 dark:border-gray-600'}">
      <div class="absolute -left-2 sm:-left-3 top-0 w-4 h-4 sm:w-6 sm:h-6 rounded-full {currentPhase === 'regular' ? 'bg-orange-500 ring-2 sm:ring-4 ring-orange-200 dark:ring-orange-900' : 'bg-gray-300 dark:bg-gray-600'}"></div>
      <div class="ml-2 sm:ml-4">
        <div class="flex flex-wrap items-center gap-2 mb-1.5 sm:mb-2">
          <h3 class="text-base sm:text-xl font-bold text-gray-900 dark:text-white">
            After 50: Regular Pricing
          </h3>
          {#if currentPhase === 'regular'}
            <span class="px-2 py-0.5 sm:py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-xs font-semibold rounded-full">
              Current
            </span>
          {/if}
        </div>
        <p class="text-sm sm:text-base text-gray-600 dark:text-gray-400">
          Standard membership pricing applies. Founding benefits no longer available.
        </p>
      </div>
    </div>
  </div>

  <!-- CTA -->
  <div class="text-center">
    <button
      type="button"
      on:click={handleCTAClick}
      class="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 rounded-full font-bold text-base sm:text-lg
             bg-orange-500 hover:bg-orange-600 active:bg-orange-700
             text-white shadow-lg hover:shadow-xl
             transition-all duration-200
             focus:outline-none focus:ring-4 focus:ring-orange-500/50"
    >
      {currentPhase === 'regular' ? 'Join Now' : 'Claim Your Founder Spot'}
    </button>
  </div>
</div>
