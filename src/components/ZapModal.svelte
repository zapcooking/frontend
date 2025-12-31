<script lang="ts">
  import { NDKEvent, NDKUser } from "@nostr-dev-kit/ndk";
  import { ndk } from "$lib/nostr";
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  import { requestProvider } from 'webln';
  import { qr } from "@svelte-put/qr/svg"
  import LeftIcon from "phosphor-svelte/lib/CaretLeft"
  import RightIcon from "phosphor-svelte/lib/CaretRight"
  import Checkmark from "phosphor-svelte/lib/CheckFat"
  import XIcon from "phosphor-svelte/lib/X"
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import { browser } from '$app/environment';
  import { onMount, createEventDispatcher } from 'svelte';
  import { ZapManager } from '$lib/zapManager';

  const dispatch = createEventDispatcher<{ 'zap-complete': { amount: number } }>();
  import { activeWallet, getWalletKindName } from '$lib/wallet';
  import { sendPayment } from '$lib/wallet/walletManager';

  let authMethodIsNip07 = $ndk.signer?.constructor.name === "NDKNip07Signer";

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
    { amount: 21000, emoji: '👨‍🍳', label: '21K' },
  ];

  export let open = false;
  export let event: NDKEvent | NDKUser;
  let amount: number = 21;
  let message: string = '';

  type PaymentToMake = { pr: string; recipientPubkey: string; amount: number };
  type PaymentStatus = { pubkey: string; paid: boolean };
  let paymentsToMakeQR: PaymentToMake[] = [];
  let paymentStatuses: PaymentStatus[] = [];

  let state: "pre" | "pending" | "success" | "error" = "pre";
  let useQR = false;
  let error: Error | null = null;

  let zapManager: ZapManager;
  let subscription: any = null;
  let hasWebLN = false;
  let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

  const PENDING_TIMEOUT_MS = 45000; // 45 second timeout for entire zap process

  function clearPendingTimeout() {
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeout = null;
    }
  }

  function startPendingTimeout() {
    clearPendingTimeout();
    pendingTimeout = setTimeout(() => {
      if (state === "pending") {
        error = new Error('Zap request timed out. The payment service may be unavailable. Please try again.');
        state = "error";
      }
    }, PENDING_TIMEOUT_MS);
  }

  onMount(async () => {
    try {
      hasWebLN = !!(window as any).webln;
    } catch {
      hasWebLN = false;
    }

    // Cleanup on unmount
    return () => {
      clearPendingTimeout();
    };
  });

  // Initialize zap manager only in browser
  $: if ($ndk && browser) {
    zapManager = new ZapManager($ndk);
  }

  async function submitSmart() {
    // If user has an in-app wallet, use it directly
    if (hasInAppWallet) {
      await submitWithInAppWallet();
    } else if (!useQR && hasWebLN) {
      await submitNow(false);
    } else {
      await submitNow(true);
    }
  }

  async function submitWithInAppWallet() {
    state = "pending";
    error = null;
    useQR = false;
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

      // Get the invoice from zapManager
      const zapResult = await zapManager.createZap(recipientPubkey, amount * 1000, message, eventId);

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

      // Subscribe to zap receipts to confirm payment (non-blocking)
      try {
        subscribeToZapReceipt(zapResult.zapPubkey, zapResult.invoice);
      } catch (subscribeError) {
        console.warn('Failed to subscribe to zap receipts:', subscribeError);
        // Don't fail the payment if subscription fails
      }

      clearPendingTimeout();
      state = "success";
      // Notify parent that zap completed so it can refresh zap totals
      setTimeout(() => dispatch('zap-complete', { amount }), 1500);
    } catch (e) {
      clearPendingTimeout();
      console.error('In-app wallet payment failed:', e);
      error = e as Error;
      state = "error";
    }
  }

  async function submitNow(qr: boolean) {
    useQR = qr;

    try {
      state = "pending";
      startPendingTimeout();

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

      const zapResult = await zapManager.createZap(recipientPubkey, amount * 1000, message, eventId);
      
      if (!qr) {
        // WebLN payment
        try {
          const webln = await requestProvider();
          if (!webln) {
            throw new Error('No WebLN provider found. Please install a Lightning wallet extension like Alby or getalby.com');
          }
          await webln.enable();
          await zapManager.payWithWebLN(zapResult.invoice);
          subscribeToZapReceipt(zapResult.zapPubkey, zapResult.invoice);
          clearPendingTimeout();
          state = "success";
          // Notify parent that zap completed so it can refresh zap totals
          setTimeout(() => dispatch('zap-complete', { amount }), 1500);
        } catch (weblnError) {
          clearPendingTimeout();

          let errorMessage = 'WebLN payment failed';
          if (weblnError instanceof Error) {
            if (weblnError.message.includes('Provider must be enabled')) {
              errorMessage = 'Please enable your Lightning wallet extension and try again';
            } else if (weblnError.message.includes('No WebLN provider')) {
              errorMessage = 'No Lightning wallet found. Please install Alby or another Lightning wallet extension';
            } else {
              errorMessage = `WebLN payment failed: ${weblnError.message}`;
            }
          }

          error = new Error(errorMessage);
          state = "error";
        }
      } else {
        // QR code payment
        paymentsToMakeQR.push({
          pr: zapResult.invoice,
          recipientPubkey: zapResult.zapPubkey,
          amount: amount
        });
        paymentsToMakeQR = paymentsToMakeQR;
        clearPendingTimeout();
        state = "success";
        subscribeToZapReceipt(zapResult.zapPubkey, zapResult.invoice);
      }
    } catch (err) {
      clearPendingTimeout();
      state = "error";
      error = err as Error;
    }
  }

  function subscribeToZapReceipt(pubkey: string, expectedInvoice: string) {
    if (subscription) {
      subscription.stop();
    }
    
    subscription = zapManager.subscribeToZapReceipts(
      pubkey,
      event.id,
      (receipt) => {
        if (receipt) {
          const receivedInvoice = receipt.getMatchingTags('bolt11')[0]?.[1];
          if (receivedInvoice === expectedInvoice) {
            const status = { pubkey, paid: true };
            paymentStatuses = [...paymentStatuses, status];
          }
        }
      },
      30000 // 30 second timeout
    );
    
    // Also start continuous payment checking for copied/pasted invoices
    startContinuousPaymentChecking(pubkey, expectedInvoice);
  }
  
  function startContinuousPaymentChecking(pubkey: string, expectedInvoice: string) {
    const checkInterval = setInterval(async () => {
      try {
        const zapTotals = await zapManager.getZapTotals(pubkey, event.id);
        if (zapTotals.count > 0) {
          const status = { pubkey, paid: true };
          paymentStatuses = [...paymentStatuses, status];
          clearInterval(checkInterval);
        }
      } catch {
        // Ignore check errors
      }
    }, 3000);

    setTimeout(() => clearInterval(checkInterval), 120000);
  }

  let selected_qr = 1;

  $: isPaid = (pubkey: string) => paymentStatuses.some(status => status.pubkey === pubkey && status.paid);
  
  // Auto-close modal when payment is completed
  $: if (useQR && paymentsToMakeQR.length > 0 && isPaid(paymentsToMakeQR[selected_qr - 1].recipientPubkey)) {
    // Notify parent that zap completed so it can refresh zap totals
    dispatch('zap-complete', { amount: paymentsToMakeQR[selected_qr - 1].amount });
    setTimeout(() => {
      open = false;
    }, 2000); // Close after 2 seconds to let user see the success message
  }

  // Clean up when modal closes
  $: if (!open) {
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
    clearPendingTimeout();
  }
</script>

<Modal bind:open>
  <h1 slot="title">Zap</h1>
  <div class="flex flex-col gap-3">
  {#if state == "pending"}
    <div class="flex flex-col text-2xl">
      <img class="w-52 self-center dark:hidden" src="/pan-animated.svg" alt="Loading" /><img class="w-52 self-center hidden dark:block" src="/pan-animated-dark.svg" alt="Loading" />

      <span class="self-center" style="color: var(--color-text-primary)">{useQR ? "Fetching Invoice(s)..." : "Waiting for Payment..."}</span>
      {#if useQR}
        {#if authMethodIsNip07}
          <span class="self-center text-center text-base text-caption">If you did not receive a popup from your signer extension, try clicking on its icon in your browser's extensions menu.</span>
        {/if}
        <span class="self-center text-center text-base text-caption">If this takes a while refresh and try again.</span>
      {/if}
    </div>
  {:else if state == "pre"}
      <div class="flex flex-col gap-3">
        <div class="grid grid-cols-4 gap-2">
          {#each defaultZapSatsAmounts as zapOption}
            <button
              on:click={() => (amount = zapOption.amount)}
              class="flex flex-col items-center justify-center py-3 px-2 rounded-xl transition-all duration-200 cursor-pointer
                {amount === zapOption.amount
                  ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md scale-105'
                  : 'bg-input hover:bg-accent-gray'}"
              style="{amount !== zapOption.amount ? 'color: var(--color-text-primary)' : ''}"
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
              <span class="font-semibold" style="color: var(--color-text-primary)">{$activeWallet.name}</span>
              <span class="text-xs text-caption">({getWalletKindName($activeWallet.kind)})</span>
            </div>
          </div>
          <Button class="w-full py-3 text-lg" on:click={submitSmart}>
            ⚡ Send {amount.toLocaleString()} sats
          </Button>
        {:else}
          <!-- No in-app wallet - show WebLN and QR options -->
          <h3 class="text-lg font-semibold" style="color: var(--color-text-primary)">Payment Method</h3>
          <div class="flex flex-col gap-2">
            <!-- WebLN Option -->
            <label class="flex items-center gap-3 p-3 bg-input rounded-xl cursor-pointer hover:ring-2 hover:ring-primary transition-all duration-200">
              <input
                type="radio"
                name="paymentMethod"
                value="webln"
                checked={!useQR}
                on:change={() => { useQR = false; }}
                disabled={!hasWebLN}
                class="w-4 h-4 text-primary focus:ring-primary"
              />
              <div class="flex flex-col">
                <span class="font-semibold" class:text-caption={!hasWebLN} style={hasWebLN ? 'color: var(--color-text-primary)' : ''}>WebLN Extension</span>
                {#if !hasWebLN}
                  <span class="text-sm text-red-500">No WebLN provider found (e.g., Alby)</span>
                {:else}
                  <span class="text-sm text-caption">Pay directly via browser extension</span>
                {/if}
              </div>
            </label>

            <!-- QR Code Option -->
            <label class="flex items-center gap-3 p-3 bg-input rounded-xl cursor-pointer hover:ring-2 hover:ring-primary transition-all duration-200">
              <input
                type="radio"
                name="paymentMethod"
                value="qr"
                checked={useQR}
                on:change={() => { useQR = true; }}
                class="w-4 h-4 text-primary focus:ring-primary"
              />
              <div class="flex flex-col">
                <span class="font-semibold" style="color: var(--color-text-primary)">QR Code</span>
                <span class="text-sm text-caption">Scan with any Lightning wallet</span>
              </div>
            </label>
          </div>
          <Button class="w-full py-3 text-lg" on:click={submitSmart}>
            ⚡ Send {amount.toLocaleString()} sats
            {#if !useQR}
              (WebLN)
            {:else}
              (QR Code)
            {/if}
          </Button>
        {/if}
      </div>
  {:else if state == "error"}
    <div class="flex flex-col items-center justify-center">
      <XIcon color="red" weight="bold" class="w-36 h-36" />
      <span class="text-2xl ml-4 text-center" style="color: var(--color-text-primary)">An Error Occurred.</span>
      <span class="text-base text-caption text-center mt-2">{error && error.toString()}</span>
      <div class="flex gap-2 mt-4">
        <Button on:click={() => open = false}>Close</Button>
        {#if error && (error.toString().includes('WebLN') || error.toString().includes('Lightning') || error.toString().includes('Provider'))}
          <Button on:click={() => {
            state = "pre";
            error = null;
            useQR = true;
            submitNow(true);
          }}>Try QR Code</Button>
        {/if}
        <Button on:click={() => {
          state = "pre";
          error = null;
        }}>Try Again</Button>
      </div>
    </div>
  {:else if state == "success"}
    {#if useQR == true}
      <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-3 text-lg">
            <div class="flex gap-3 items-center">
              <CustomAvatar className="flex-shrink-0" pubkey={paymentsToMakeQR[selected_qr - 1].recipientPubkey} size={56} />
              <div class="flex flex-col gap-1 min-w-0">
                <div class="break-words" style="color: var(--color-text-primary)">
                  Zapping <span class="font-semibold">{amount} sats</span> to
                </div>
                <div class="break-all text-sm font-semibold" style="color: var(--color-text-primary)">
                  <CustomName pubkey={paymentsToMakeQR[selected_qr - 1].recipientPubkey} />
                </div>
                {#if event}
                  <span class="text-sm text-caption">for this recipe</span>
                {/if}
              </div>
            </div>
          </div>
          {#if isPaid(paymentsToMakeQR[selected_qr - 1].recipientPubkey)}
            <div class="flex flex-col items-center justify-center">
              <Checkmark color="#90EE90" weight="fill" class="w-36 h-36" />
              <span class="text-2xl ml-4" style="color: var(--color-text-primary)">Payment Completed</span>
            </div>
          {:else}
            <p class="text-caption">Scan the QR Code below with a suitable Lightning Wallet to zap.</p>
            <div class="self-center p-4 rounded-xl bg-white" style="width: 80%;">
              <svg class="w-full"
                use:qr={{
                  data: paymentsToMakeQR[selected_qr - 1].pr,
                  logo: "https://zap.cooking/favicon.svg",
                  shape: "circle",
                  width: 100,
                  height: 100,
                }}
              />
            </div>
            <div class="flex items-center gap-2">
              <div class="flex-1 break-all text-xs bg-input p-2 rounded" style="border: 1px solid var(--color-input-border); color: var(--color-text-primary)">
                {paymentsToMakeQR[selected_qr - 1].pr}
              </div>
              <button
                on:click={(e) => {
                  navigator.clipboard.writeText(paymentsToMakeQR[selected_qr - 1].pr);
                  // Simple feedback
                  const btn = e.target;
                  const originalText = btn.textContent;
                  btn.textContent = 'Copied!';
                  btn.classList.add('bg-green-500');
                  setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('bg-green-500');
                  }, 1500);
                }}
                class="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded text-xs font-medium transition duration-200 flex-shrink-0 cursor-pointer"
                title="Copy Lightning invoice"
              >
                Copy
              </button>
            </div>
          {/if}
          <div class="flex gap-3 justify-center" style="color: var(--color-text-primary)">
            {#if selected_qr > 1}
              <LeftIcon class="self-center cursor-pointer" on:click={() => selected_qr--} />
            {/if}
            <span class="self-center">{selected_qr}/{paymentsToMakeQR.length}</span>
            {#if selected_qr < paymentsToMakeQR.length}
              <RightIcon class="self-center cursor-pointer" on:click={() => selected_qr++} />
            {/if}
          </div>
          <div class="flex gap-2 justify-center mt-4">
            <Button on:click={() => open = false}>
              Close
            </Button>
          </div>
      </div>
    {:else}
      <!-- In-app wallet or WebLN Payment Success -->
      <div class="flex flex-col items-center justify-center">
        <Checkmark color="#90EE90" weight="fill" class="w-36 h-36" />
        <span class="text-2xl ml-4 text-center" style="color: var(--color-text-primary)">Payment Sent!</span>
        <span class="text-lg text-caption text-center mt-2">
          Your zap of {amount} sats has been sent.
        </span>
        <div class="flex gap-2 mt-4">
          <Button on:click={() => open = false}>Close</Button>
        </div>
      </div>
    {/if}
  {/if}
    </div>
</Modal>

