<!--
  Modal that handles a CLINK noffer payment.

  Two paths in one modal, mirroring bxrd.app's note view:
    • In-app: when the viewer has Spark / NWC / WebLN connected, runs the
      kind-21001 RPC against the offer's relay and pays the returned
      bolt11 via `walletManager.sendPayment`.
    • External: a `lightning:noffer1…` QR + copy button for CLINK-aware
      wallets (Zeus, ShockWallet) to scan and handle the RPC themselves.

  Friendly error mapping mirrors ZapModal's pattern — most NofferError
  codes get a specific human-readable title + body.
-->
<script lang="ts">
  import Modal from '../Modal.svelte';
  import Button from '../Button.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import LightningSlashIcon from 'phosphor-svelte/lib/LightningSlash';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import Checkmark from 'phosphor-svelte/lib/CheckFat';
  import { qr } from '@svelte-put/qr/svg';
  import { decodeNoffer, stripNostrPrefix } from '$lib/clink/noffer';
  import { NofferError, type NofferData } from '$lib/clink/types';
  import { requestInvoice } from '$lib/clink/nofferClient';
  import { sendPayment } from '$lib/wallet/walletManager';
  import { activeWallet } from '$lib/wallet';
  import { weblnConnected } from '$lib/wallet/webln';
  import CustomName from '../CustomName.svelte';
  import CustomAvatar from '../CustomAvatar.svelte';

  export let open = false;
  export let noffer: string;

  let data: NofferData | null = null;
  let decodeError: string | null = null;
  let state: 'idle' | 'requesting' | 'paying' | 'success' | 'error' = 'idle';
  let error: Error | null = null;
  let amountInput = '';
  let copied = false;

  $: hasInAppWallet =
    $weblnConnected ||
    ($activeWallet && ($activeWallet.kind === 3 || $activeWallet.kind === 4));

  $: lightningUri = `lightning:${stripNostrPrefix(noffer)}`;

  // Decode whenever the noffer prop changes. We pre-populate the amount
  // input with the offer's TLV-4 price (when present) so a Fixed offer
  // shows the right number and a Variable offer has a starting hint.
  $: {
    try {
      data = decodeNoffer(noffer);
      decodeError = null;
      if (data.price != null && !amountInput) {
        amountInput = String(data.price);
      }
    } catch (e) {
      decodeError = e instanceof Error ? e.message : String(e);
      data = null;
    }
  }

  $: needsAmountInput = data ? data.pricingType !== 'fixed' : false;
  $: amountSats = (() => {
    const n = Number(amountInput);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  })();
  $: payDisabled =
    !data ||
    state === 'requesting' ||
    state === 'paying' ||
    (needsAmountInput && amountSats <= 0);

  // Friendly error mapping — mirrors ZapModal's title/body/retryable shape.
  let errorTitle = "Couldn't pay this offer";
  let errorBody = '';
  let errorRetryable = true;
  $: {
    const msg = (error?.message || '').toLowerCase();
    if (error instanceof NofferError) {
      switch (error.code) {
        case 1:
          errorTitle = 'Offer no longer valid';
          errorBody = 'The service rejected this offer as invalid.';
          errorRetryable = false;
          break;
        case 2:
          errorTitle = 'Temporary failure';
          errorBody =
            "The service couldn't complete the request right now. Try again in a moment.";
          errorRetryable = true;
          break;
        case 3:
          errorTitle = 'Offer moved';
          errorBody = error.latest
            ? 'This offer has a newer version. Ask the recipient for the updated noffer.'
            : 'This offer has been retired by the recipient.';
          errorRetryable = false;
          break;
        case 4:
          errorTitle = 'Unsupported feature';
          errorBody = "The service doesn't support this kind of payment request.";
          errorRetryable = false;
          break;
        case 5:
          errorTitle = 'Amount out of range';
          errorBody = error.range
            ? `Pick an amount between ${error.range.min.toLocaleString()} and ${error.range.max.toLocaleString()} sats.`
            : "The amount you entered is outside the offer's allowed range.";
          errorRetryable = true;
          break;
        default:
          errorTitle = 'Offer error';
          errorBody = error.message;
          errorRetryable = true;
      }
    } else if (msg.includes('timed out') || msg.includes('timeout')) {
      errorTitle = 'Offer timed out';
      errorBody =
        "The service didn't respond in time. Check your connection and try again.";
      errorRetryable = true;
    } else if (msg.includes('sign in')) {
      errorTitle = 'Sign in to pay';
      errorBody = 'You need to be signed in to pay an offer.';
      errorRetryable = false;
    } else if (msg.includes('no wallet') || msg.includes('not connected')) {
      errorTitle = 'No wallet connected';
      errorBody = 'Connect a Lightning wallet first, or scan the QR with a CLINK-aware wallet.';
      errorRetryable = false;
    } else {
      errorTitle = "Couldn't pay this offer";
      errorBody = error?.message || 'Something went wrong. Please try again.';
      errorRetryable = true;
    }
  }

  async function payWithInAppWallet() {
    if (!data) return;
    state = 'requesting';
    error = null;
    try {
      // For Fixed offers the amount input is hidden in the UI — never
      // forward `amountInput` to the service or the wallet history, since
      // it could be a stale value left over from a prior Variable /
      // Spontaneous offer in the same session. The service knows the
      // canonical price from the offer id; we honour `data.price` for
      // display + wallet metadata.
      const effectiveAmount = needsAmountInput ? amountSats : (data.price ?? 0);
      const { bolt11 } = await requestInvoice(data, {
        amountSats: needsAmountInput && amountSats > 0 ? amountSats : undefined,
        description: `Offer: ${data.offerId}`
      });
      state = 'paying';
      const result = await sendPayment(bolt11, {
        amount: effectiveAmount,
        description: `CLINK offer: ${data.offerId}`,
        pubkey: data.pubkey
      });
      if (!result.success) {
        throw new Error(result.error || 'Payment failed');
      }
      state = 'success';
    } catch (e) {
      error = e as Error;
      state = 'error';
    }
  }

  async function copyNoffer() {
    try {
      await navigator.clipboard.writeText(stripNostrPrefix(noffer));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* ignore */
    }
  }

  function tryAgain() {
    state = 'idle';
    error = null;
  }
</script>

<Modal bind:open>
  <h1 slot="title" class="flex items-center gap-2">
    <LightningIcon weight="fill" class="text-amber-500" />
    Pay offer
  </h1>

  {#if decodeError}
    <div class="text-center py-6">
      <p class="text-sm" style="color: var(--color-text-primary)">
        Couldn't read this offer.
      </p>
      <p class="text-xs text-caption mt-2 font-mono break-all">{decodeError}</p>
    </div>
  {:else if data}
    {#if state === 'success'}
      <div class="flex flex-col items-center py-6">
        <div
          class="w-16 h-16 rounded-full flex items-center justify-center mb-3"
          style="background-color: rgba(16, 185, 129, 0.15); color: #10b981;"
        >
          <Checkmark weight="fill" size={32} />
        </div>
        <p class="text-lg font-semibold" style="color: var(--color-text-primary)">Paid!</p>
        <p class="text-sm mt-1" style="color: var(--color-text-secondary)">
          {(needsAmountInput ? amountSats : (data.price ?? 0)).toLocaleString()} sats sent.
        </p>
      </div>
    {:else if state === 'error'}
      <div class="flex flex-col items-center py-2">
        <div
          class="w-16 h-16 rounded-full flex items-center justify-center mb-3"
          style="background-color: rgba(245, 158, 11, 0.12); color: #f59e0b;"
        >
          <LightningSlashIcon weight="fill" size={32} />
        </div>
        <span class="text-lg font-semibold text-center" style="color: var(--color-text-primary)">
          {errorTitle}
        </span>
        <span class="text-sm text-center mt-1.5 max-w-xs" style="color: var(--color-text-secondary)">
          {errorBody}
        </span>
        <div class="flex gap-2 mt-5">
          <Button on:click={() => (open = false)}>Close</Button>
          {#if errorRetryable}
            <Button on:click={tryAgain}>Try Again</Button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-4">
        <!-- Recipient -->
        <div class="flex items-center gap-3">
          <CustomAvatar pubkey={data.pubkey} size={40} />
          <div class="flex-1 min-w-0">
            <div class="font-semibold truncate" style="color: var(--color-text-primary)">
              <CustomName pubkey={data.pubkey} />
            </div>
            <div class="text-xs text-caption truncate font-mono">
              {data.offerId}
            </div>
          </div>
        </div>

        <!-- Amount -->
        {#if needsAmountInput}
          <label class="block">
            <span class="text-sm font-medium" style="color: var(--color-text-primary)">
              Amount (sats)
            </span>
            <input
              type="number"
              min="1"
              bind:value={amountInput}
              placeholder={data.price ? String(data.price) : 'e.g. 1000'}
              class="input mt-1 w-full"
              disabled={state === 'requesting' || state === 'paying'}
            />
            {#if data.currency}
              <span class="text-xs text-caption mt-1 block">
                Recipient prices in {data.currency}; you pay in sats.
              </span>
            {/if}
          </label>
        {:else}
          <div
            class="flex items-center justify-between p-3 rounded-lg"
            style="background: var(--color-input-bg); border: 1px solid var(--color-input-border);"
          >
            <span class="text-sm text-caption">Amount</span>
            <span class="font-semibold" style="color: var(--color-text-primary)">
              {(data.price ?? 0).toLocaleString()} sats
            </span>
          </div>
        {/if}

        <!-- Primary action: in-app pay -->
        {#if hasInAppWallet}
          <Button on:click={payWithInAppWallet} disabled={payDisabled}>
            {#if state === 'requesting'}
              Requesting invoice…
            {:else if state === 'paying'}
              Paying…
            {:else}
              ⚡ Pay with my wallet
            {/if}
          </Button>
        {/if}

        <!-- Secondary: scan-with-external-wallet -->
        <div
          class="border-t pt-4"
          style="border-color: var(--color-input-border)"
        >
          <p class="text-sm text-center mb-2" style="color: var(--color-text-secondary)">
            or scan with a CLINK-aware wallet (Zeus or ShockWallet)
          </p>
          <div class="flex justify-center bg-white p-4 rounded-lg">
            <svg
              use:qr={{ data: lightningUri, shape: 'square' }}
              class="w-48 h-48"
              aria-label="QR code for {lightningUri}"
            />
          </div>
          <button
            type="button"
            class="w-full mt-2 inline-flex items-center justify-center gap-2 text-sm py-2 rounded-full hover:bg-input transition-colors"
            style="color: var(--color-text-secondary)"
            on:click={copyNoffer}
          >
            {#if copied}
              <CheckIcon size={16} /> Copied
            {:else}
              <CopyIcon size={16} /> Copy offer
            {/if}
          </button>
        </div>
      </div>
    {/if}
  {/if}
</Modal>
