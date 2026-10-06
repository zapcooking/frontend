<script lang="ts">
  import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk';
  import { ndk } from '$lib/nostr';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  import LightningIcon from 'phosphor-svelte/lib/LightningSlash';
  import { browser } from '$app/environment';
  import { onMount, createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { ZapManager } from '$lib/zapManager';
  import { lightningService } from '$lib/lightningService';
  import { hapticSuccess } from '$lib/haptics';

  const dispatch = createEventDispatcher<{
    'zap-complete': { amount: number; pollOptionId?: string; comment?: string };
  }>();
  import { activeWallet, getWalletKindName } from '$lib/wallet';
  import {
    sendPayment,
    walletAvailability,
    ensurePaymentWalletReady
  } from '$lib/wallet/walletManager';
  import { NO_WALLET_MESSAGE, PENDING_MESSAGE } from '$lib/wallet/paymentOutcome';
  import { runInAppZap, type ZapStep } from '$lib/wallet/inAppZap';
  import { weblnConnected } from '$lib/wallet/webln';
  import { defaultZapMessage } from '$lib/autoZapSettings';
  import { addPendingOp, removePendingOp } from '$lib/stores/pendingOps';
  import { showToast } from '$lib/toast';

  // True when we can pay an invoice directly without launching the
  // Bitcoin Connect payment modal:
  //   - an in-app wallet (NWC kind=3, Spark kind=4) is the active one, OR
  //   - WebLN is connected. WebLN wallets are deliberately not registered
  //     in the $wallets store (see WalletPanel.svelte — kind=1 entries are
  //     removed on mount), so $activeWallet is null even when WebLN is
  //     active. We have to check $weblnConnected separately to route
  //     through walletManager.sendPayment instead of the BC modal.
  $: hasInAppWallet =
    $weblnConnected ||
    ($activeWallet && ($activeWallet.kind === 3 || $activeWallet.kind === 4));

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
  export let pollOptionId: string | undefined = undefined;
  export let pollOptionLabel: string | undefined = undefined;
  export let pollMinSats: number | undefined = undefined;
  export let pollMaxSats: number | undefined = undefined;
  export let pollEventKind: number | undefined = undefined;

  let amount: number = 21;

  // Generate dynamic presets for zap polls — linear interpolation (matches Primal)
  function getZapPollPresets(min: number, max: number | undefined): { amount: number; label: string }[] {
    const lo = min || 21;
    const hi = max && max > 0 ? max : 21_000;
    let count = 6;
    if (hi - lo < 6) count = hi - lo + 1;
    if (count <= 0) count = 1;

    const presets: number[] = count === 1
      ? [lo]
      : Array.from({ length: count }, (_, i) => Math.round(lo + (i * (hi - lo)) / (count - 1)));

    return presets.map(a => ({
      amount: a,
      label: a >= 1_000_000 ? `${(a / 1_000_000).toFixed(1)}M`
           : a >= 1_000 ? `${a % 1_000 === 0 ? `${a / 1_000}K` : a.toLocaleString()}`
           : String(a)
    }));
  }

  $: isPollMode = pollOptionId != null;
  $: pollPresets = isPollMode ? getZapPollPresets(pollMinSats || 1, pollMaxSats) : [];

  // Set default amount to min sats when entering poll mode
  $: if (isPollMode && pollMinSats && amount === 21) {
    amount = pollMinSats;
  }
  // Pre-fill from the user's saved default zap message (set in Settings →
  // Zap Settings → Default zap message). The user can still edit or clear
  // this in the textarea before sending; the override doesn't affect the
  // saved default. Each caller wraps <ZapModal/> in `{#if open}`, so the
  // component remounts on every open and this initialiser fires fresh.
  // Use `get()` (not `$store`) so we pull the current value without
  // creating a subscription that re-fires on later store updates.
  let message: string = get(defaultZapMessage);

  let state: 'pre' | 'error' = 'pre';
  let isSendingInApp = false;
  let sendingOpId: string | null = null;
  let error: Error | null = null;

  // Friendly mapping for the error state. The raw error message can be
  // alarming and technical ("Profile lud16: undefined") — translate the
  // common cases into something a human can act on. Anything we don't
  // recognise falls back to a soft generic message + retry; cases we
  // know aren't retryable (e.g. recipient has no Lightning address) hide
  // the Try Again button.
  let errorTitle = 'Zap unavailable';
  let errorBody = '';
  let errorRetryable = true;
  $: {
    const msg = error?.message || String(error || '');
    const lower = msg.toLowerCase();
    if (
      lower.includes('no lightning address') ||
      lower.includes('lud16') ||
      lower.includes('lud06') ||
      lower.includes('no zap endpoint')
    ) {
      errorTitle = 'No Lightning address';
      errorBody =
        "This user hasn't set up a Lightning address yet, so zaps can't be sent to them.";
      errorRetryable = false;
    } else if (lower.includes('timed out') || lower.includes('timeout')) {
      errorTitle = 'Zap timed out';
      errorBody =
        'The payment service took too long to respond. Check your connection and try again.';
      errorRetryable = true;
    } else if (lower.includes('insufficient') || lower.includes('balance')) {
      errorTitle = 'Not enough sats';
      errorBody = "Your wallet doesn't have enough sats for this zap. Try a smaller amount.";
      errorRetryable = true;
    } else if (
      lower.includes('rejected') ||
      lower.includes('denied') ||
      lower.includes('cancelled') ||
      lower.includes('canceled')
    ) {
      errorTitle = 'Zap cancelled';
      errorBody = 'The payment was cancelled before it completed.';
      errorRetryable = true;
    } else if (lower.includes('no wallet')) {
      errorTitle = 'No wallet connected';
      errorBody =
        'No wallet is set up on this site. Connect or restore your wallet to send zaps.';
      errorRetryable = false;
    } else {
      errorTitle = "Couldn't send zap";
      errorBody = msg || 'Something went wrong. Please try again.';
      errorRetryable = true;
    }
  }

  let zapManager: ZapManager;
  let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

  // Hang protection for the whole in-app zap. Above Breez's 30 s completion
  // wait plus the 15 s invoice fetch, so it only fires on a real stall.
  const PENDING_TIMEOUT_MS = 60000;

  // The step an in-app zap is on, for the progress line and so a timeout
  // can say where it stalled.
  let zapStep: ZapStep = 'connecting your wallet';

  function clearPendingTimeout() {
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeout = null;
    }
  }

  function startPendingTimeout() {
    clearPendingTimeout();
    pendingTimeout = setTimeout(() => {
      if (isSendingInApp) {
        isSendingInApp = false;
        timedOut = true;
        if (sendingOpId) { removePendingOp(sendingOpId); sendingOpId = null; }
        // Once the payment was handed to the wallet it may still go through.
        showToast(
          'error',
          zapStep === 'sending the payment'
            ? `Zap timed out while ${zapStep}. ${PENDING_MESSAGE}.`
            : `Zap timed out while ${zapStep}. Nothing was sent.`,
          8000
        );
        open = false;
      }
    }, PENDING_TIMEOUT_MS);
  }

  onMount(() => {
    // Do NOT clear the pending timeout on unmount — for in-app zaps the
    // modal closes immediately while the payment runs in the background,
    // so the hang-protection timeout must outlive the component.
    return () => { /* intentionally empty */ };
  });

  // Initialize zap manager only in browser
  $: if ($ndk && browser) {
    zapManager = new ZapManager($ndk);
  }

  // Warm the recipient's LNURL resolution the moment the modal opens —
  // the profile fetch + LNURL round-trips then overlap with the user
  // choosing an amount, so submit only has to fetch the invoice.
  // Idempotent: createZap and any other ZapManager share the cache.
  $: if (open && zapManager && event) {
    zapManager.prefetchZap(event);
  }

  async function submitZap() {
    // If user has an in-app wallet, use it directly
    if (hasInAppWallet) {
      await submitWithInAppWallet();
    } else {
      await submitWithExternalWallet();
    }
  }

  let timedOut = false;

  /** A result while the modal may already be closed: inline if open, else a toast. */
  function reportError(msg: string) {
    if (open) {
      error = new Error(msg);
      state = 'error';
    } else {
      showToast('error', msg, 8000);
    }
  }

  async function submitWithInAppWallet() {
    error = null;
    timedOut = false;
    // Nothing usable on this site (e.g. a preview domain): say so at once,
    // before any invoice or signer prompt.
    if (walletAvailability() === 'none') {
      reportError(NO_WALLET_MESSAGE);
      return;
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
      reportError('Invalid event or user provided to ZapModal');
      return;
    }

    // The modal stays open until the payment's outcome is known, so
    // "zap complete" and "Sent" only ever follow a confirmed payment
    // ($lib/wallet/inAppZap).
    isSendingInApp = true;
    sendingOpId = addPendingOp('Sending zap ⚡');
    startPendingTimeout();
    const extraTags = pollOptionId
      ? [['poll_option', pollOptionId], ...(pollEventKind ? [['k', String(pollEventKind)]] : [])]
      : undefined;

    const outcome = await runInAppZap({
      availability: walletAvailability,
      ensureReady: ensurePaymentWalletReady,
      createInvoice: async () => {
        if (!zapManager) throw new Error('Zap manager not initialized. Please try again.');
        const zap = await zapManager.createZap(recipientPubkey, amount * 1000, message, eventId, extraTags);
        return zap.invoice;
      },
      // The user-typed message becomes both `comment` (rendered in italics in
      // the wallet history row) and the source of `description` when present.
      pay: (invoice) =>
        sendPayment(invoice, {
          amount,
          description: message || `Zap to ${recipientPubkey.substring(0, 8)}...`,
          comment: message || undefined,
          pubkey: recipientPubkey
        }),
      onStep: (step) => (zapStep = step),
      onCompleted: () => {
        dispatch('zap-complete', { amount, pollOptionId, comment: message || undefined });
        hapticSuccess();
        showToast('success', `⚡ Sent ${amount.toLocaleString()} sats`);
      },
      abandoned: () => timedOut
    });

    clearPendingTimeout();
    isSendingInApp = false;
    if (sendingOpId) { removePendingOp(sendingOpId); sendingOpId = null; }
    if (!outcome) return; // timed out: the timeout already reported it
    if (outcome.kind === 'completed') {
      open = false;
    } else if (outcome.kind === 'pending') {
      // Never "sent", never a retry: it may still go through.
      showToast('info', `${outcome.message || PENDING_MESSAGE}.`, 8000);
      open = false;
    } else {
      console.error('In-app wallet payment failed:', outcome.message);
      reportError(outcome.message);
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



      // Get the invoice from zapManager
      const extraTags = pollOptionId
        ? [['poll_option', pollOptionId], ...(pollEventKind ? [['k', String(pollEventKind)]] : [])]
        : undefined;
      const zapResult = await zapManager.createZap(
        recipientPubkey,
        amount * 1000,
        message,
        eventId,
        extraTags
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
          dispatch('zap-complete', { amount, pollOptionId, comment: message || undefined });
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
    // Only clear the hang-protection timeout if we're NOT mid-payment.
    // For in-app zaps the modal closes before the payment resolves, so
    // clearPendingTimeout here would kill the 45s safety net.
    if (!isSendingInApp) clearPendingTimeout();
    // Reset state when modal closes (with small delay to allow animation to trigger)
    setTimeout(() => {
      if (!open && state !== 'pre') {
        state = 'pre';
        error = null;
      }
    }, 100);
  }

</script>

<Modal bind:open>
  <h1 slot="title">Zap</h1>
  <div class="flex flex-col gap-3">
    {#if state == 'pre'}
      <div class="flex flex-col gap-3">
        {#if pollOptionLabel}
          <div class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium" style="background: rgba(250, 204, 21, 0.1); color: var(--color-text-primary); border: 1px solid rgba(250, 204, 21, 0.3);">
            <span>⚡</span>
            <span>Voting for: <strong>{pollOptionLabel}</strong></span>
          </div>
          {#if pollMinSats || pollMaxSats}
            <p class="text-xs text-caption px-1">
              {#if pollMinSats}Min: {pollMinSats} sats{/if}
              {#if pollMinSats && pollMaxSats} · {/if}
              {#if pollMaxSats}Max: {pollMaxSats} sats{/if}
            </p>
          {/if}
        {/if}
        <div class="grid grid-cols-4 gap-2">
          {#if isPollMode && pollPresets.length > 0}
            {#each pollPresets as preset}
              <button
                on:click={() => handlePresetClick(preset.amount)}
                class="flex flex-col items-center justify-center py-3 px-2 rounded-xl transition-all duration-200 cursor-pointer
                  {amount === preset.amount
                  ? 'bg-gradient-to-r from-yellow-500 to-amber-500 text-white shadow-md scale-105'
                  : 'bg-input hover:bg-accent-gray'}"
                style={amount !== preset.amount ? 'color: var(--color-text-primary)' : ''}
              >
                <span class="text-xl">⚡</span>
                <span class="text-sm font-semibold">{preset.label}</span>
              </button>
            {/each}
          {:else}
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
          {/if}
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
        <Button class="w-full py-3 text-lg" on:click={submitZap} disabled={isSendingInApp || isCreatingInvoice || (pollMinSats != null && amount < pollMinSats) || (pollMaxSats != null && pollMaxSats > 0 && amount > pollMaxSats)}>
          {#if isSendingInApp}
            <span class="flex items-center justify-center gap-2">
              <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {zapStep === 'connecting your wallet'
                ? 'Connecting wallet…'
                : zapStep === 'getting the invoice'
                  ? 'Getting invoice…'
                  : 'Sending payment…'}
            </span>
          {:else if isCreatingInvoice}
            <span class="flex items-center justify-center gap-2">
              <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Creating Invoice...
            </span>
          {:else}
            ⚡ {pollOptionId ? 'Zap Vote' : 'Send'} {amount.toLocaleString()} sats
          {/if}
        </Button>
      </div>
    {:else if state == 'error'}
      <div class="flex flex-col items-center justify-center py-2">
        <div
          class="w-16 h-16 rounded-full flex items-center justify-center mb-3"
          style="background-color: rgba(245, 158, 11, 0.12); color: #f59e0b;"
        >
          <LightningIcon weight="fill" size={32} />
        </div>
        <span
          class="text-lg font-semibold text-center"
          style="color: var(--color-text-primary)">{errorTitle}</span
        >
        <span
          class="text-sm text-center mt-1.5 max-w-xs"
          style="color: var(--color-text-secondary)">{errorBody}</span
        >
        <div class="flex gap-2 mt-5">
          <Button on:click={() => (open = false)}>Close</Button>
          {#if errorRetryable}
            <Button
              on:click={() => {
                state = 'pre';
                error = null;
              }}>Try Again</Button
            >
          {/if}
        </div>
      </div>
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
