<script lang="ts">
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import CreditCardIcon from 'phosphor-svelte/lib/CreditCard';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import { paymentStore, currentPricing, formatSats, formatUSD, type PaymentMethod, type Tier, type PricingPeriod } from './paymentStore';
  import { userPublickey } from '$lib/nostr';

  let selectedMethod: PaymentMethod | null = null;
  let isLoading = false;

  $: pricing = $currentPricing;
  $: selectedTier = $paymentStore.selectedTier;
  $: selectedPeriod = $paymentStore.selectedPeriod;

  function selectMethod(method: PaymentMethod) {
    selectedMethod = method;
    paymentStore.selectMethod(method);
  }

  async function handleContinue() {
    if (!selectedMethod || !selectedTier || !selectedPeriod) return;
    
    isLoading = true;
    try {
      if (selectedMethod === 'bitcoin') {
        await paymentStore.proceedToBitcoin($userPublickey || '');
      } else {
        // Pass tier and period to proceedToStripe
        await paymentStore.proceedToStripe(
          selectedTier as Exclude<Tier, 'open'>,
          selectedPeriod
        );
      }
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="p-6 sm:p-8">
  <!-- Header -->
  <div class="text-center mb-8">
    <h2 id="payment-modal-title" class="text-2xl font-bold !text-black mb-2">
      Choose Payment Method
    </h2>
    {#if pricing}
      <p class="text-gray-600 dark:text-gray-400">
        {pricing.tierName} • {pricing.period}
      </p>
    {/if}
  </div>

  <!-- Payment Options -->
  <div class="space-y-4 mb-8">
    <!-- Bitcoin/Lightning Option -->
    <button
      type="button"
      on:click={() => selectMethod('bitcoin')}
      class="w-full p-4 rounded-xl border-2 transition-all duration-200 text-left relative
             {selectedMethod === 'bitcoin' 
               ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30' 
               : 'border-gray-200 dark:border-gray-700 hover:border-orange-300 dark:hover:border-orange-700'}"
    >
      <!-- Savings Badge -->
      {#if pricing && pricing.savings > 0}
        <div class="absolute -top-3 right-4 px-3 py-1 bg-green-500 text-white text-xs font-bold rounded-full">
          Save {formatUSD(pricing.savings)} vs card
        </div>
      {/if}

      <div class="flex items-start gap-4">
        <div class="w-12 h-12 rounded-full bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center flex-shrink-0">
          <LightningIcon size={24} weight="fill" class="text-orange-500" />
        </div>
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-bold text-gray-900 dark:text-white">Bitcoin / Lightning</span>
            {#if selectedMethod === 'bitcoin'}
              <CheckCircleIcon size={20} weight="fill" class="text-orange-500" />
            {/if}
          </div>
          {#if pricing}
            <div class="text-2xl font-bold text-orange-600 dark:text-orange-400">
              ⚡ {formatSats(pricing.sats)} sats
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Instant payment via Lightning Network
            </p>
          {/if}
        </div>
      </div>
    </button>

    <!-- Credit Card Option -->
    <button
      type="button"
      on:click={() => selectMethod('card')}
      class="w-full p-4 rounded-xl border-2 transition-all duration-200 text-left
             {selectedMethod === 'card' 
               ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' 
               : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700'}"
    >
      <div class="flex items-start gap-4">
        <div class="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center flex-shrink-0">
          <CreditCardIcon size={24} weight="fill" class="text-blue-500" />
        </div>
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-bold text-gray-900 dark:text-white">Credit Card</span>
            {#if selectedMethod === 'card'}
              <CheckCircleIcon size={20} weight="fill" class="text-blue-500" />
            {/if}
          </div>
          {#if pricing}
            <div class="text-2xl font-bold text-blue-600 dark:text-blue-400">
              💳 {formatUSD(pricing.usd)}{pricing.periodLabel}
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Secure checkout via Stripe
            </p>
          {/if}
        </div>
      </div>
    </button>
  </div>

  <!-- Continue Button -->
  <button
    type="button"
    on:click={handleContinue}
    disabled={!selectedMethod || isLoading}
    class="w-full py-4 px-6 rounded-full font-bold text-lg transition-all duration-200
           {selectedMethod 
             ? 'bg-primary text-white hover:bg-primary/90' 
             : 'bg-gray-200 text-gray-500 cursor-not-allowed'}"
  >
    {#if isLoading}
      <span class="flex items-center justify-center gap-2">
        <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Processing...
      </span>
    {:else}
      Continue to Payment
    {/if}
  </button>

  <!-- Security Note -->
  <p class="text-center text-xs text-gray-500 dark:text-gray-400 mt-4">
    🔒 Your payment is secure and encrypted
  </p>
</div>

