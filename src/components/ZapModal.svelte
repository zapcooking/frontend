<script lang="ts">
  import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk';
  import { ndk } from '$lib/nostr';
  import Modal from './Modal.svelte';
  import PanLoader from './PanLoader.svelte';
  import Button from './Button.svelte';
  import Checkmark from 'phosphor-svelte/lib/CheckFat';
  import XIcon from 'phosphor-svelte/lib/X';

  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import { browser } from '$app/environment';
  import { onMount, createEventDispatcher } from 'svelte';
  import { ZapManager } from '$lib/zapManager';
  import { lightningService } from '$lib/lightningService';
  import { hapticSuccess } from '$lib/haptics';
  import { displayCurrency } from '$lib/currencyStore';
  import { convertSatsToFiat, formatFiatValue } from '$lib/currencyConversion';

  const dispatch = createEventDispatcher<{ 'zap-complete': { amount: number } }>();
  import { activeWallet, getWalletKindName } from '$lib/wallet';
  import { sendPayment } from '$lib/wallet/walletManager';

  // Check if user has an in-app wallet connected (Spark or NWC)
  $: hasInAppWallet = $activeWallet && ($activeWallet.kind === 3 || $activeWallet.kind === 4);

  const defaultZapSatsAmounts = [
    { amount: 21, emoji: '☕', label: '21' },
    { amount: 100, emoji: '🍪', label: '100' },
    { amount: 250, emoji: '🧁', label: '250' },
    { amount: 500, emoji: '🌮', label: '500' },
    { amount: 1000, emoji: '🍕', label: '1K' },
    { amount: 2100, emoji: '🍔', label: '2.1K' },
    { amount: 10000, emoji: '🍣', label: '10K' },
    { amount: 21000, emoji: '👨‍🍳', label: '21K' }
  ];

  export let open = false;
  export let event: NDKEvent | NDKUser;

  let amount: number = 21;
  let message: string = '';

  let state: 'pre' | 'pending' | 'success' | 'error' = 'pre';
  let error: Error | null = null;

  let zapManager: ZapManager;
  let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  let successTimeout: ReturnType<typeof setTimeout> | null = null;
  let recipientPubkeyForDisplay: string = '';

  const PENDING_TIMEOUT_MS = 45000; // 45 second timeout for entire zap process
  const SUCCESS_DISPLAY_MS = 2500; // 2.5s to show success before auto-closing

  function clearPendingTimeout() {
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeout = null;
    }
  }

  function clearSuccessTimeout() {
    if (successTimeout) {
      clearTimeout(successTimeout);
      successTimeout = null;
    }
  }

  function startPendingTimeout() {
    clearPendingTimeout();
    pendingTimeout = setTimeout(() => {
      if (state === 'pending') {
        error = new Error(
          'Zap request timed out. The payment service may be unavailable. Please try again.'
        );
        state = 'error';
      }
    }, PENDING_TIMEOUT_MS);
  }

  onMount(() => {
    // Cleanup on unmount
    return () => {
      clearPendingTimeout();
      clearSuccessTimeout();
    };
  });

  // Initialize zap manager only in browser
  $: if ($ndk && browser) {
    zapManager = new ZapManager($ndk);
  }

  async function submitZap() {
    // If user has an in-app wallet, use it directly
    if (hasInAppWallet) {
      await submitWithInAppWallet();
    } else {
      await submitWithExternalWallet();
    }
  }

  async function submitWithInAppWallet() {
    state = 'pending';
    error = null;
    startPendingTimeout();

    try {
      if (!zapManager) {
        throw new Error('Zap manager not initialized. Please try again.');
      }

      if (!$activeWallet) {
        throw new Error('No wallet connected. Please connect a wallet first.');
      }

      let recipientPubkey: string;
      let eventId: string | undefined;

      if (event instanceof NDKUser) {
        recipientPubkey = event.pubkey;
        eventId = undefined;
      } else if (event && event.author) {
        recipientPubkey = event.author?.hexpubkey || event.pubkey;
        eventId = event.id;
      } else {
        throw new Error('Invalid event or user provided to ZapModal');
      }

      recipientPubkeyForDisplay = recipientPubkey;

      // Get the invoice from zapManager
      const zapResult = await zapManager.createZap(
        recipientPubkey,
        amount * 1000,
        message,
        eventId
      );

      // Use the unified wallet manager to send payment (handles both Spark and NWC)
      // Pass metadata so a pending transaction appears immediately
      const paymentResult = await sendPayment(zapResult.invoice, {
        amount,
        description: message || `Zap to ${recipientPubkey.substring(0, 8)}...`,
        pubkey: recipientPubkey
      });

      if (!paymentResult.success) {
        throw new Error(paymentResult.error || 'Payment failed');
      }

      clearPendingTimeout();
      state = 'success';
      hapticSuccess();

      // Notify parent that zap completed so it can refresh zap totals
      dispatch('zap-complete', { amount });

      // Auto-close modal after 2.5s; user can also tap anywhere to dismiss
      successTimeout = setTimeout(() => {
        open = false;
      }, SUCCESS_DISPLAY_MS);
    } catch (e) {
      clearPendingTimeout();
      console.error('In-app wallet payment failed:', e);
      error = e as Error;
      state = 'error';
    }
  }

  let isCreatingInvoice = false;

  async function submitWithExternalWallet() {
    error = null;
    isCreatingInvoice = true;

    try {
      if (!zapManager) {
        throw new Error('Zap manager not initialized. Please try again.');
      }

      let recipientPubkey: string;
      let eventId: string | undefined;

      if (event instanceof NDKUser) {
        recipientPubkey = event.pubkey;
        eventId = undefined;
      } else if (event && event.author) {
        recipientPubkey = event.author?.hexpubkey || event.pubkey;
        eventId = event.id;
      } else {
        throw new Error('Invalid event or user provided to ZapModal');
      }

      if (!recipientPubkey) {
        throw new Error('No recipient pubkey found');
      }

      recipientPubkeyForDisplay = recipientPubkey;

      // Get the invoice from zapManager
      const zapResult = await zapManager.createZap(
        recipientPubkey,
        amount * 1000,
        message,
        eventId
      );

      isCreatingInvoice = false;

      // Close our modal and launch Bitcoin Connect payment modal directly
      open = false;

      // Launch Bitcoin Connect payment modal
      // This handles QR display, wallet connection, and payment verification
      await lightningService.launchPayment({
        invoice: zapResult.invoice,
        verify: zapResult.verify,
        onPaid: () => {
          dispatch('zap-complete', { amount });
        },
        onCancelled: () => {
          // User cancelled - reopen our modal
          open = true;
        }
      });
    } catch (e) {
      isCreatingInvoice = false;
      console.error('External wallet payment failed:', e);
      error = e as Error;
      state = 'error';
    }
  }

  // Handle preset amount selection
  function handlePresetClick(presetAmount: number) {
    amount = presetAmount;
  }

  // Clean up when modal closes
  $: if (!open) {
    clearPendingTimeout();
    clearSuccessTimeout();
    // Reset state when modal closes (with small delay to allow animation to trigger)
    setTimeout(() => {
      if (!open && state !== 'pre') {
        state = 'pre';
        error = null;
      }
    }, 100);
  }

  function dismissSuccess() {
    clearSuccessTimeout();
    open = false;
  }

  // Optional USD equivalent for success message (when display currency is not SATS)
  let successFiatStr: string | null = null;
  $: if (state === 'success' && amount != null && $displayCurrency !== 'SATS' && browser) {
    convertSatsToFiat(amount).then((v) => {
      successFiatStr = v != null ? formatFiatValue(v) : null;
    });
  }
  $: if (state !== 'success') successFiatStr = null;
</script>

<Modal bind:open compact={state === 'success'}>
  <h1 slot="title">Zap</h1>
  <div class="flex flex-col gap-3">
    {#if state == 'pending'}
      <!-- Only shows for in-app wallet payments -->
      <div class="flex flex-col text-2xl items-center">
        <PanLoader size="md" />
        <span class="self-center mt-4" style="color: var(--color-text-primary)">Sending Zap!</span>
      </div>
    {:else if state == 'pre'}
      <div class="flex flex-col gap-3">
        <div class="grid grid-cols-4 gap-2">
          {#each defaultZapSatsAmounts as zapOption}
            <button
              on:click={() => handlePresetClick(zapOption.amount)}
              class="flex flex-col items-center justify-center py-3 px-2 rounded-xl transition-all duration-200 cursor-pointer
                {amount === zapOption.amount
                ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md scale-105'
                : 'bg-input hover:bg-accent-gray'}"
              style={amount !== zapOption.amount ? 'color: var(--color-text-primary)' : ''}
            >
              <span class="text-xl">{zapOption.emoji}</span>
              <span class="text-sm font-semibold">{zapOption.label}</span>
            </button>
          {/each}
        </div>
        <input type="text" class="input" bind:value={amount} />
        <textarea rows="2" class="input" bind:value={message} placeholder="Message (optional)" />
      </div>
      <div class="flex flex-col gap-3">
        {#if hasInAppWallet && $activeWallet}
          <!-- User has an in-app wallet - use it automatically -->
          <div class="p-3 bg-input rounded-xl">
            <div class="flex items-center gap-2">
              <span class="text-sm text-caption">Paying with:</span>
              <span class="font-semibold" style="color: var(--color-text-primary)"
                >{$activeWallet.name}</span
              >
              <span class="text-xs text-caption">({getWalletKindName($activeWallet.kind)})</span>
            </div>
          </div>
        {:else}
          <!-- No in-app wallet - will use Bitcoin Connect modal -->
          <div class="p-3 bg-input rounded-xl">
            <div class="flex items-center gap-2">
              <span class="text-sm text-caption">Payment:</span>
              <span class="font-semibold" style="color: var(--color-text-primary)"
                >External Wallet</span
              >
            </div>
            <p class="text-xs text-caption mt-1">Scan QR code or connect wallet</p>
          </div>
        {/if}
        <Button class="w-full py-3 text-lg" on:click={submitZap} disabled={isCreatingInvoice}>
          {#if isCreatingInvoice}
            <span class="flex items-center justify-center gap-2">
              <svg
                class="animate-spin h-5 w-5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Creating Invoice...
            </span>
          {:else}
            ⚡ Send {amount.toLocaleString()} sats
          {/if}
        </Button>
      </div>
    {:else if state == 'error'}
      <div class="flex flex-col items-center justify-center">
        <XIcon color="red" weight="bold" class="w-36 h-36" />
        <span class="text-2xl ml-4 text-center" style="color: var(--color-text-primary)"
          >An Error Occurred.</span
        >
        <span class="text-base text-caption text-center mt-2">{error && error.toString()}</span>
        <div class="flex gap-2 mt-4">
          <Button on:click={() => (open = false)}>Close</Button>
          <Button
            on:click={() => {
              state = 'pre';
              error = null;
            }}>Try Again</Button
          >
        </div>
      </div>
    {:else if state == 'success'}
      <!-- Payment Success: tap anywhere to dismiss, auto-closes in 2.5s -->
      <button
        type="button"
        class="zap-success-tap-target flex flex-col items-center justify-center cursor-pointer text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-secondary)] rounded-2xl"
        on:click={dismissSuccess}
        on:keydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            dismissSuccess();
          }
        }}
      >
        {#if recipientPubkeyForDisplay}
          <div class="flex gap-3 items-center mb-3">
            <CustomAvatar className="flex-shrink-0" pubkey={recipientPubkeyForDisplay} size={48} />
            <div class="flex flex-col gap-0.5">
              <span
                class="text-base font-semibold"
                style="color: var(--color-text-primary)"
              >
                <CustomName pubkey={recipientPubkeyForDisplay} />
              </span>
            </div>
          </div>
        {/if}
        <div class="zap-success-checkmark-wrap relative my-1">
          <svg class="zap-success-progress-ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle
              class="zap-success-progress-ring-bg"
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke-width="2"
            />
            <circle
              class="zap-success-progress-ring-fg"
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke-width="2"
              stroke-dasharray="289"
              stroke-dashoffset="0"
            />
          </svg>
          <span class="zap-success-checkmark">
            <Checkmark color="#90EE90" weight="fill" class="w-24 h-24 block" />
          </span>
        </div>
        <span
          class="text-xl font-semibold text-center mt-2"
          style="color: var(--color-text-primary)"
        >
          Payment Sent!
        </span>
        <div class="flex flex-col items-center gap-1.5 mt-2">
          <span
            class="inline-flex items-center px-3 py-1.5 rounded-full text-base font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
          >
            {amount != null ? amount.toLocaleString() : ''} sats
          </span>
          {#if successFiatStr}
            <span class="text-sm text-caption">{successFiatStr}</span>
          {/if}
        </div>
      </button>
    {/if}
  </div>
</Modal>

<style>
  /* Zap success: checkmark container + progress ring */
  .zap-success-checkmark-wrap {
    width: 6rem;
    height: 6rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .zap-success-checkmark {
    display: flex;
    align-items: center;
    justify-content: center;
    animation: zap-checkmark-in 380ms ease-out both;
  }

  .zap-success-checkmark :global(svg) {
    filter: drop-shadow(0 0 12px rgba(144, 238, 144, 0.5))
      drop-shadow(0 0 24px rgba(144, 238, 144, 0.25));
  }

  @keyframes zap-checkmark-in {
    0% {
      opacity: 0;
      transform: scale(0.5);
    }
    70% {
      transform: scale(1.08);
    }
    85% {
      transform: scale(0.96);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }

  .zap-success-tap-target {
    -webkit-tap-highlight-color: transparent;
  }

  /* Thin circular progress ring (auto-close countdown) */
  .zap-success-progress-ring {
    position: absolute;
    width: calc(6rem + 12px);
    height: calc(6rem + 12px);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-90deg);
    pointer-events: none;
  }

  .zap-success-progress-ring-bg {
    stroke: rgba(144, 238, 144, 0.2);
  }

  .zap-success-progress-ring-fg {
    stroke: rgba(144, 238, 144, 0.55);
    stroke-linecap: round;
    animation: zap-progress-deplete 2500ms linear forwards;
  }

  @keyframes zap-progress-deplete {
    from {
      stroke-dashoffset: 0;
    }
    to {
      stroke-dashoffset: 289;
    }
  }
</style>
