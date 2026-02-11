<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
  import { paymentStore, currentPricing, formatSats } from './paymentStore';
  import { userPublickey } from '$lib/nostr';
  import { lightningService } from '$lib/lightningService';

  $: invoice = $paymentStore.lightningInvoice;
  $: pricing = $currentPricing;
  $: receiveRequestId = $paymentStore.invoiceId;

  let copied = false;
  let paymentStatus: 'waiting' | 'confirming' | 'complete' = 'waiting';
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let paymentConfirmed = false;
  let error: string | null = null;

  onMount(async () => {
    if (!invoice) {
      error = 'No invoice available';
      return;
    }

    // Launch payment modal via lightningService
    try {
      const { setPaid } = await lightningService.launchPayment({
        invoice: invoice,
        verify: undefined,
        onPaid: async (response) => {
          stopPaymentPolling();
          if (!paymentConfirmed) {
            console.log('[PaymentModal] Lightning payment completed, verifying...');
            await verifyLightningPayment(response.preimage || '');
          }
        },
        onCancelled: () => {
          stopPaymentPolling();
          console.log('[PaymentModal] Lightning payment cancelled');
          error = 'Payment cancelled';
        }
      });

      // Start polling our verify endpoint to detect external wallet payments
      startPaymentPolling(setPaid);
    } catch (err) {
      console.error('[PaymentModal] Error launching payment:', err);
      error = err instanceof Error ? err.message : 'Failed to launch payment';
    }
  });

  onDestroy(() => {
    stopPaymentPolling();
  });

  async function verifyLightningPayment(_preimage: string) {
    if (!receiveRequestId || !$userPublickey || !$paymentStore.selectedTier || !$paymentStore.selectedPeriod) {
      error = 'Missing payment information';
      return;
    }

    paymentStatus = 'confirming';

    try {
      console.log('[PaymentModal] Verifying Lightning payment...');
      const response = await fetch('/api/membership/verify-lightning-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receiveRequestId,
          paymentHash: $paymentStore.lightningInvoice ? extractPaymentHash($paymentStore.lightningInvoice) : null,
          pubkey: $userPublickey,
          tier: $paymentStore.selectedTier,
          period: $paymentStore.selectedPeriod,
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to verify payment';
        try {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
        } catch (parseError) {
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      if (data.success) {
        paymentStatus = 'complete';
        paymentConfirmed = true;
        
        // Complete payment with NIP-05 info if available
        await paymentStore.completePayment(
          'bitcoin',
          $userPublickey,
          {
            nip05: data.nip05,
            nip05Username: data.nip05Username
          }
        );
      } else {
        throw new Error('Payment verification failed');
      }

    } catch (err) {
      console.error('[PaymentModal] Verification error:', err);
      error = err instanceof Error ? err.message : 'Failed to verify payment. Please contact support.';
      paymentStatus = 'waiting';
    }
  }

  function startPaymentPolling(setPaid: (response: { preimage: string }) => void) {
    pollInterval = setInterval(async () => {
      if (paymentConfirmed || !receiveRequestId || !$userPublickey || !$paymentStore.selectedTier || !$paymentStore.selectedPeriod) return;

      try {
        const response = await fetch('/api/membership/verify-lightning-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiveRequestId,
            paymentHash: $paymentStore.lightningInvoice ? extractPaymentHash($paymentStore.lightningInvoice) : null,
            pubkey: $userPublickey,
            tier: $paymentStore.selectedTier,
            period: $paymentStore.selectedPeriod,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            paymentStatus = 'complete';
            paymentConfirmed = true;
            stopPaymentPolling();
            setPaid({ preimage: 'strike-confirmed' });
            
            // Complete payment with NIP-05 info
            await paymentStore.completePayment(
              'bitcoin',
              $userPublickey,
              {
                nip05: data.nip05,
                nip05Username: data.nip05Username
              }
            );
          }
        } else if (response.status === 402) {
          // Payment still pending; keep polling
          return;
        } else {
          // Terminal error: stop polling and log the error
          stopPaymentPolling();
          try {
            const errorData = await response.json();
            console.error('Lightning payment verification failed:', errorData);
          } catch {
            console.error('Lightning payment verification failed with status', response.status);
          }
        }
      } catch {
        // Network error, keep polling
      }
    }, 3000);
  }

  function stopPaymentPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  // Helper function to extract payment hash from Lightning invoice
  function extractPaymentHash(invoice: string): string | null {
    // This is a simplified extraction - in production you'd use a proper BOLT11 decoder
    // For now, we'll return null and let the backend handle it
    return null;
  }

  async function copyInvoice() {
    if (!invoice) return;
    
    try {
      await navigator.clipboard.writeText(invoice);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  function handleBack() {
    if (paymentStatus === 'waiting') {
      paymentStore.goBack();
    }
  }

  // Generate a simple QR code pattern (mock)
  function generateQRPattern(): string[][] {
    const size = 21;
    const pattern: string[][] = [];
    
    for (let i = 0; i < size; i++) {
      pattern[i] = [];
      for (let j = 0; j < size; j++) {
        // Create finder patterns in corners
        const isFinderPattern = 
          (i < 7 && j < 7) || 
          (i < 7 && j >= size - 7) || 
          (i >= size - 7 && j < 7);
        
        if (isFinderPattern) {
          // Finder pattern logic
          const inCorner1 = i < 7 && j < 7;
          const inCorner2 = i < 7 && j >= size - 7;
          const inCorner3 = i >= size - 7 && j < 7;
          
          let localI = i;
          let localJ = j;
          if (inCorner2) localJ = j - (size - 7);
          if (inCorner3) localI = i - (size - 7);
          
          const isOuter = localI === 0 || localI === 6 || localJ === 0 || localJ === 6;
          const isInner = localI >= 2 && localI <= 4 && localJ >= 2 && localJ <= 4;
          
          pattern[i][j] = (isOuter || isInner) ? 'filled' : 'empty';
        } else {
          // Random data pattern
          pattern[i][j] = Math.random() > 0.5 ? 'filled' : 'empty';
        }
      }
    }
    
    return pattern;
  }

  const qrPattern = generateQRPattern();
</script>

<div class="p-6 sm:p-8">
  <!-- Back Button (only when waiting) -->
  {#if paymentStatus === 'waiting'}
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
  <div class="text-center mb-6">
    <div class="w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center mx-auto mb-4">
      <LightningIcon size={32} weight="fill" class="text-orange-500" />
    </div>
    <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
      {#if paymentStatus === 'waiting'}
        Pay with Lightning
      {:else if paymentStatus === 'confirming'}
        Confirming Payment...
      {:else}
        Payment Received!
      {/if}
    </h2>
    {#if pricing && paymentStatus === 'waiting'}
      <p class="text-3xl font-bold text-orange-600 dark:text-orange-400">
        ⚡ {formatSats(pricing.sats)} sats
      </p>
    {/if}
  </div>

  <!-- QR Code -->
  <div class="flex justify-center mb-6">
    <div class="relative bg-white p-4 rounded-xl shadow-lg">
      <!-- Mock QR Code -->
      <div class="w-48 h-48 grid" style="grid-template-columns: repeat(21, 1fr); gap: 1px;">
        {#each qrPattern as row}
          {#each row as cell}
            <div class="{cell === 'filled' ? 'bg-gray-900' : 'bg-white'}"></div>
          {/each}
        {/each}
      </div>
      
      <!-- Lightning Icon Overlay -->
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="w-12 h-12 bg-white rounded-lg flex items-center justify-center shadow-md">
          <LightningIcon size={24} weight="fill" class="text-orange-500" />
        </div>
      </div>

      <!-- Status Overlay -->
      {#if paymentStatus !== 'waiting'}
        <div class="absolute inset-0 bg-white/90 flex items-center justify-center rounded-xl">
          {#if paymentStatus === 'confirming'}
            <div class="text-center">
              <svg class="animate-spin h-12 w-12 mx-auto text-orange-500 mb-2" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p class="text-gray-600 font-medium">Confirming...</p>
            </div>
          {:else}
            <div class="text-center">
              <div class="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-2">
                <CheckIcon size={32} weight="bold" class="text-white" />
              </div>
              <p class="text-green-600 font-bold">Paid!</p>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Error Message -->
  {#if error}
    <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6">
      <p class="text-center text-sm text-red-800 dark:text-red-200">
        {error}
      </p>
    </div>
  {/if}

  <!-- Invoice Copy Section -->
  {#if invoice && paymentStatus === 'waiting'}
    <div class="mb-6">
      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Lightning Invoice
      </label>
      <div class="flex gap-2">
        <input
          type="text"
          readonly
          value={invoice.substring(0, 40) + '...'}
          class="flex-1 px-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-xl text-sm font-mono text-gray-600 dark:text-gray-400"
        />
        <button
          type="button"
          on:click={copyInvoice}
          class="px-4 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-xl transition-colors flex items-center gap-2"
        >
          {#if copied}
            <CheckIcon size={20} class="text-green-500" />
          {:else}
            <CopyIcon size={20} class="text-gray-600 dark:text-gray-400" />
          {/if}
        </button>
      </div>
    </div>
  {/if}

  <!-- Instructions -->
  {#if paymentStatus === 'waiting'}
    <div class="text-center text-sm text-gray-600 dark:text-gray-400 space-y-2">
      <p>Scan the QR code with your Lightning wallet</p>
      <p>or copy the invoice and paste it in your wallet</p>
    </div>
  {/if}
</div>

