<script lang="ts">
  import { onMount } from 'svelte';
  import CreditCardIcon from 'phosphor-svelte/lib/CreditCard';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
  import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOut';
  import { paymentStore, currentPricing, formatUSD } from './paymentStore';
  import { userPublickey } from '$lib/nostr';

  $: pricing = $currentPricing;
  $: stripeUrl = $paymentStore.stripeSessionUrl;

  let isRedirecting = false;

  function handleBack() {
    if (!isRedirecting) {
      paymentStore.goBack();
    }
  }

  function handleRedirectToStripe() {
    if (!stripeUrl) {
      console.error('Stripe session URL not available');
      return;
    }
    
    isRedirecting = true;
    // Redirect to real Stripe checkout
    window.location.href = stripeUrl;
  }
</script>

<div class="p-6 sm:p-8">
  <!-- Back Button -->
  {#if !isRedirecting}
    <button
      type="button"
      on:click={handleBack}
      class="flex items-center gap-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-4 transition-colors"
    >
      <ArrowLeftIcon size={20} />
      <span>Back</span>
    </button>
  {/if}

  <!-- Header -->
  <div class="text-center mb-8">
    <div class="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center mx-auto mb-4">
      <CreditCardIcon size={32} weight="fill" class="text-blue-500" />
    </div>
    <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
      {isRedirecting ? 'Processing...' : 'Redirecting to Stripe'}
    </h2>
    {#if pricing}
      <p class="text-3xl font-bold text-blue-600 dark:text-blue-400">
        💳 {formatUSD(pricing.usd)}
      </p>
    {/if}
  </div>

  <!-- Mock Stripe Preview -->
  <div class="bg-gradient-to-br from-purple-600 to-blue-600 rounded-xl p-6 mb-6 text-white">
    <div class="flex items-center gap-3 mb-4">
      <svg class="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
      </svg>
      <span class="font-bold text-lg">Stripe Checkout</span>
    </div>
    
    <div class="bg-white/10 rounded-lg p-4 backdrop-blur-sm">
      <div class="flex justify-between items-center mb-2">
        <span class="text-white/80">Zap Cooking {pricing?.tierName}</span>
        {#if pricing}
          <span class="font-bold">{formatUSD(pricing.usd)}</span>
        {/if}
      </div>
      <div class="text-sm text-white/60">
        {pricing?.period} subscription
      </div>
    </div>
  </div>

  <!-- Status -->
  {#if isRedirecting}
    <div class="text-center mb-6">
      <svg class="animate-spin h-12 w-12 mx-auto text-blue-500 mb-4" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <p class="text-gray-600 dark:text-gray-400">
        Processing your payment...
      </p>
    </div>
  {:else}
    <!-- Redirect Button -->
    <button
      type="button"
      on:click={handleRedirectToStripe}
      disabled={!stripeUrl || isRedirecting}
      class="w-full py-4 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-full font-bold text-lg transition-colors flex items-center justify-center gap-2"
    >
      <span>Continue to Stripe Checkout</span>
      <ArrowSquareOutIcon size={20} />
    </button>
  {/if}

  <!-- Security Note -->
  <p class="text-center text-xs text-gray-500 dark:text-gray-400 mt-4">
    🔒 You'll be redirected to Stripe's secure checkout
  </p>
</div>

