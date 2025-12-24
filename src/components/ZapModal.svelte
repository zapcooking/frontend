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
  import { onMount } from 'svelte';
  import { ZapManager } from '$lib/zapManager';

  let authMethodIsNip07 = $ndk.signer?.constructor.name === "NDKNip07Signer";

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

  onMount(async () => {
    try {
      hasWebLN = !!(window as any).webln;
    } catch {
      hasWebLN = false;
    }
  });

  // Initialize zap manager only in browser
  $: if ($ndk && browser) {
    zapManager = new ZapManager($ndk);
  }

  async function submitSmart() {
    if (hasWebLN) {
      await submitNow(false);
    } else {
      await submitNow(true);
    }
  }

  async function submitNow(qr: boolean) {
    useQR = qr;
    
    try {
      state = "pending";
      
      // Get the recipient pubkey
      console.log('ZapModal - event:', event);
      console.log('ZapModal - event type:', event?.constructor?.name);
      console.log('ZapModal - event.author:', (event as any)?.author);
      console.log('ZapModal - event.pubkey:', event?.pubkey);
      
      let recipientPubkey: string;
      let eventId: string | undefined;
      
      if (event instanceof NDKUser) {
        recipientPubkey = event.pubkey;
        eventId = undefined; // No event ID for user zaps
        console.log('ZapModal - User zap, pubkey:', recipientPubkey);
      } else if (event && event.author) {
        recipientPubkey = event.author?.hexpubkey || event.pubkey;
        eventId = event.id;
        console.log('ZapModal - Event zap, pubkey:', recipientPubkey, 'eventId:', eventId);
      } else {
        console.error('ZapModal - Invalid event or user:', { event, author: event?.author, pubkey: event?.pubkey });
        throw new Error('Invalid event or user provided to ZapModal');
      }
      
      // Validate recipientPubkey before proceeding
      if (!recipientPubkey) {
        throw new Error('No recipient pubkey found');
      }
      
      console.log('ZapModal - About to call createZap with:', {
        recipientPubkey,
        amount: amount * 1000,
        message,
        eventId
      });
      
      // Create zap using our zapManager
      const zapResult = await zapManager.createZap(recipientPubkey, amount * 1000, message, eventId);
      
      if (!qr) {
        // WebLN payment
        try {
          // First, request provider and enable it
          const webln = await requestProvider();
          if (!webln) {
            throw new Error('No WebLN provider found. Please install a Lightning wallet extension like Alby or getalby.com');
          }
          
          // Enable the provider
          await webln.enable();
          
          // Now attempt the payment
          const paymentResult = await zapManager.payWithWebLN(zapResult.invoice);
          console.log('WebLN payment successful:', paymentResult);
          
          // Subscribe to zap receipts to confirm payment
          subscribeToZapReceipt(zapResult.zapPubkey, zapResult.invoice);
          
          // Show success state
          state = "success";
        } catch (weblnError) {
          console.error('WebLN payment failed:', weblnError);
          
          // Provide more helpful error messages
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
        state = "success";
        subscribeToZapReceipt(zapResult.zapPubkey, zapResult.invoice);
      }
    } catch (err) {
      console.log('error while handling zap', err);
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
    // Check for payments every 3 seconds for up to 2 minutes
    const checkInterval = setInterval(async () => {
      try {
        console.log('Checking for payments for pubkey:', pubkey);
        const zapTotals = await zapManager.getZapTotals(pubkey, event.id);
        console.log('Zap totals found:', zapTotals);
        
        // If we find any zaps, consider it paid
        if (zapTotals.count > 0) {
          console.log('Payment detected via continuous checking!');
          const status = { pubkey, paid: true };
          paymentStatuses = [...paymentStatuses, status];
          clearInterval(checkInterval);
        }
      } catch (error) {
        console.log('Error checking payments:', error);
      }
    }, 3000);
    
    // Stop checking after 2 minutes
    setTimeout(() => {
      clearInterval(checkInterval);
      console.log('Stopped continuous payment checking after 2 minutes');
    }, 120000);
  }

  let selected_qr = 1;

  $: isPaid = (pubkey: string) => paymentStatuses.some(status => status.pubkey === pubkey && status.paid);
  
  // Auto-close modal when payment is completed
  $: if (useQR && paymentsToMakeQR.length > 0 && isPaid(paymentsToMakeQR[selected_qr - 1].recipientPubkey)) {
    setTimeout(() => {
      open = false;
    }, 2000); // Close after 2 seconds to let user see the success message
  }

  // Clean up subscription when modal closes
  $: if (!open && subscription) {
    subscription.stop();
    subscription = null;
  }
</script>

<Modal bind:open>
  <h1 slot="title">Zap</h1>
  <div class="flex flex-col gap-3">
  {#if state == "pending"}
    <div class="flex flex-col text-2xl">
      <img class="w-52 self-center" src="/pan-animated.svg" alt="Loading" />

      <span class="self-center">{useQR ? "Fetching Invoice(s)..." : "Waiting for Payment..."}</span>
      {#if useQR}
        {#if authMethodIsNip07}
          <span class="self-center text-center">If you did not recieve a popup from your signer extension, try clicking on it's icon in your browser's extensions menu.</span>
        {/if}
        <span class="self-center text-center">If this takes a while refresh and try again.</span>
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
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}"
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
        <Button class="w-full py-3 text-lg" on:click={submitSmart}>
          ⚡ Send {amount.toLocaleString()} sats
        </Button>
        <div class="flex justify-between items-center px-1">
          <button 
            class="text-sm text-gray-500 hover:text-gray-700 underline cursor-pointer"
            on:click={() => submitNow(true)}
          >
            Show QR code instead
          </button>
          <button 
            class="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
            on:click={() => open = false}
          >
            Cancel
          </button>
        </div>
      </div>
  {:else if state == "error"}
    <div class="flex flex-col items-center justify-center">
      <XIcon color="red" weight="bold" class="w-36 h-36" />
      <span class="text-2xl ml-4 text-center">An Error Occurred. <br /> {error && error.toString()}</span>
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
                <div class="break-words">
                  Zapping <span class="font-semibold">{amount} sats</span> to
                </div>
                <div class="break-all text-sm font-semibold text-gray-700">
                  <CustomName pubkey={paymentsToMakeQR[selected_qr - 1].recipientPubkey} />
                </div>
                {#if event}
                  <span class="text-sm text-gray-600">for this recipe</span>
                {/if}
              </div>
            </div>
          </div>
          {#if isPaid(paymentsToMakeQR[selected_qr - 1].recipientPubkey)}
            <div class="flex flex-col items-center justify-center">
              <Checkmark color="#90EE90" weight="fill" class="w-36 h-36" />
              <span class="text-2xl ml-4">Payment Completed</span>
            </div>
          {:else}
            Scan the QR Code below with a suitable Lightning Wallet to zap.
            <svg class="self-center" style="width: 80%"
              use:qr={{
                data: paymentsToMakeQR[selected_qr - 1].pr,
                logo: "https://zap.cooking/favicon.svg",
                shape: "circle",
                width: 100,
                height: 100,
              }}
            />
            <div class="flex items-center gap-2">
              <div class="flex-1 break-all text-xs bg-gray-50 p-2 rounded border">
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
                class="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium transition duration-200 flex-shrink-0"
                title="Copy Lightning invoice"
              >
                Copy
              </button>
            </div>
          {/if}
          <div class="flex gap-3 justify-center">
            {#if selected_qr > 1}
              <LeftIcon class="self-center" on:click={() => selected_qr--} />
            {/if}
            <span class="self-center">{selected_qr}/{paymentsToMakeQR.length}</span>
            {#if selected_qr < paymentsToMakeQR.length}
              <RightIcon class="self-center" on:click={() => selected_qr++} />
            {/if}
          </div>
          <div class="flex gap-2 justify-center mt-4">
            <Button 
              class="!text-black bg-white border border-[#ECECEC] hover:bg-accent-gray"
              on:click={() => open = false}
            >
              Close
            </Button>
          </div>
      </div>
    {:else}
      <!-- WebLN Extension Payment Success -->
      <div class="flex flex-col items-center justify-center">
        <Checkmark color="#90EE90" weight="fill" class="w-36 h-36" />
        <span class="text-2xl ml-4 text-center">Payment Sent!</span>
        <span class="text-lg text-gray-600 text-center mt-2">
          Your zap of {amount} sats has been sent via your Lightning wallet.
        </span>
        <div class="flex gap-2 mt-4">
          <Button on:click={() => open = false}>Close</Button>
        </div>
      </div>
    {/if}
  {/if}
    </div>
</Modal>