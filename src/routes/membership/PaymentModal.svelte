<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import XIcon from 'phosphor-svelte/lib/X';
  import { paymentStore, currentPricing } from './paymentStore';
  import PaymentSelection from './PaymentSelection.svelte';
  import BitcoinPayment from './BitcoinPayment.svelte';
  import StripeCheckout from './StripeCheckout.svelte';
  import PaymentSuccess from './PaymentSuccess.svelte';

  $: isOpen = $paymentStore.step !== 'closed';
  $: step = $paymentStore.step;

  function handleClose() {
    paymentStore.close();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      // Don't close during payment processing
      if (step !== 'bitcoin') {
        handleClose();
      }
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && step !== 'bitcoin') {
      handleClose();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    transition:fade={{ duration: 200 }}
    on:click={handleBackdropClick}
    role="dialog"
    aria-modal="true"
    aria-labelledby="payment-modal-title"
  >
    <!-- Modal Container -->
    <div
      class="relative w-full max-w-lg bg-[var(--color-light-bg-primary,#fff)] dark:bg-[var(--color-bg-primary)] rounded-2xl shadow-2xl overflow-hidden"
      transition:fly={{ y: 20, duration: 300 }}
    >
      <!-- Close Button (not shown during payment) -->
      {#if step !== 'bitcoin'}
        <button
          type="button"
          on:click={handleClose}
          class="absolute top-4 right-4 z-10 p-2 rounded-full text-[var(--color-caption)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-light-input-bg,var(--color-gray-100))] dark:hover:bg-[var(--color-bg-secondary)] transition-colors"
          aria-label="Close modal"
        >
          <XIcon size={24} />
        </button>
      {/if}

      <!-- Modal Content -->
      <div class="max-h-[90vh] overflow-y-auto">
        {#if step === 'selection'}
          <PaymentSelection />
        {:else if step === 'bitcoin'}
          <BitcoinPayment />
        {:else if step === 'stripe'}
          <StripeCheckout />
        {:else if step === 'success'}
          <PaymentSuccess />
        {/if}
      </div>
    </div>
  </div>
{/if}

