<script lang="ts">
  import { NDKEvent, NDKUser } from "@nostr-dev-kit/ndk";
  import { ndk } from "$lib/nostr";
  import { ZapManager } from '$lib/zapManager';
  import Modal from './Modal.svelte';
  import { formatAmount } from '$lib/utils';
  import Pill from './Pill.svelte';
  import Button from './Button.svelte';
  import { requestProvider } from 'webln';
  import { qr } from "@svelte-put/qr/svg"
  import LeftIcon from "phosphor-svelte/lib/CaretLeft"
  import RightIcon from "phosphor-svelte/lib/CaretRight"
  import Checkmark from "phosphor-svelte/lib/CheckFat"
  import XIcon from "phosphor-svelte/lib/X"
  import { Avatar, Name } from '@nostr-dev-kit/ndk-svelte-components';
  import { onMount, onDestroy } from 'svelte';
  import { createEventDispatcher } from 'svelte';

  const defaultZapSatsAmounts = [
    21, 121, 400, 1000, 2100, 4200, 10000, 21000, 42000, 69000, 100000, 210000, 500000, 1000000
  ];

  let selectedCurrency: 'SATS' | 'USD' = 'SATS';

  export let open = false;
  export let event: NDKEvent | null = null;
  export let user: NDKUser | null = null;

  const dispatch = createEventDispatcher();

  let amount: number = 21;
  let message: string = '';
  let zapManager: ZapManager;
  let subscription: any = null;

  let paymentsToMakeQR: any[] = [];
  let paymentStatuses: { pubkey: string; paid: boolean }[] = [];

  $: state = "pre";
  $: useQR = false;
  let error: Error | null = null;

  onMount(() => {
    zapManager = new ZapManager($ndk);
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
    }
  });

  async function submitNow(qr: boolean) {
    if (!event && !user) {
      error = new Error("No event or user selected");
      state = "error";
      return;
    }

    if (amount <= 0) {
      error = new Error("Amount must be greater than 0");
      state = "error";
      return;
    }

    try {
      state = "pending";
      useQR = qr;

      let recipient: NDKUser;
      let eventId: string | undefined;

      if (event) {
        // Zap an event
        if (!event.author) {
          error = new Error("Cannot zap this event: missing author information");
          state = "error";
          return;
        }
        recipient = event.author;
        eventId = event.id;
      } else if (user) {
        // Zap a user profile
        recipient = user;
      } else {
        error = new Error("No valid recipient found");
        state = "error";
        return;
      }

      // Create zap using our ZapManager
      const zapResult = await zapManager.createZap(
        recipient,
        amount * 1000, // Convert to millisatoshis
        message,
        eventId
      );

      // Subscribe to zap receipts
      if (subscription) {
        subscription.stop();
      }
      
      subscription = zapManager.subscribeToZapReceipts(
        recipient.hexpubkey,
        eventId,
        (receipt) => {
          console.log('Zap receipt received:', receipt);
          state = "success";
          dispatch('zap-complete');
        }
      );

      // Handle payment
      if (!qr && zapManager.isWebLNAvailable()) {
        try {
          // Try WebLN payment
          const paymentResult = await zapManager.payWithWebLN(zapResult.invoice);
          console.log('WebLN payment successful:', paymentResult);
          state = "success";
          dispatch('zap-complete');
        } catch (weblnError) {
          console.log('WebLN payment failed, falling back to QR:', weblnError);
          useQR = true;
          paymentsToMakeQR.push({
            pr: zapResult.invoice,
            recipientPubkey: recipient.hexpubkey,
            amount: amount
          });
        }
      } else {
        // Use QR code for payment
        paymentsToMakeQR.push({
          pr: zapResult.invoice,
          recipientPubkey: recipient.hexpubkey,
          amount: amount
        });
      }

    } catch (err) {
      console.error('Error while creating zap:', err);
      error = err instanceof Error ? err : new Error("Unknown error occurred");
      state = "error";
    }
  }


  let selected_qr = 1;

  $: isPaid = (pubkey: string) => paymentStatuses.some(status => status.pubkey === pubkey && status.paid);

  // Reset state when modal opens/closes
  $: if (open) {
    console.log('ZapModal opened for:', event?.id || user?.hexpubkey);
    state = "pre";
    error = null;
    paymentsToMakeQR = [];
    paymentStatuses = [];
    selected_qr = 1;
    amount = 21;
    message = '';
  }

  $: console.log('ZapModal open state changed:', open);

  // Handle modal close
  function closeModal() {
    open = false;
  }
</script>
<Modal bind:open>
  <h1 slot="title">
    {#if event}
      Zap Recipe
    {:else if user}
      Zap User
    {:else}
      Zap
    {/if}
  </h1>
  <div class="flex flex-col gap-3">
  {#if state == "pending"}
    <div class="flex flex-col text-2xl">
      <img class="w-52 self-center" src="/pan-animated.svg" alt="Loading" />

      <span class="self-center">{useQR ? "Fetching Invoice(s)..." : "Waiting for Payment..."}</span>
      {#if useQR}
        <span class="self-center text-center text-sm text-gray-600 mt-2">If this takes a while refresh and try again.</span>
      {:else}
        <span class="self-center text-center text-sm text-gray-600 mt-2">Please approve the payment in your Lightning wallet.</span>
      {/if}
    </div>
  {:else if state == "pre"}
      <div class="flex flex-col gap-3">
        <div class="grid grid-cols-7 grid-rows-2 gap-2">
          {#if selectedCurrency == 'SATS'}
            {#each defaultZapSatsAmounts as zapPamount}
              <Pill
                selected={amount == zapPamount}
                text={formatAmount(zapPamount)}
                onClick={() => (amount = zapPamount)}
              />
            {/each}
          {/if}
        </div>
        <input type="text" class="input" bind:value={amount} />
        <textarea rows="2" class="input" bind:value={message} placeholder="Message (optional)" />
      </div>
      <div class="flex gap-2 justify-end">
        <Button
          class="!text-black bg-white border border-[#ECECEC] hover:bg-accent-gray"
          on:click={closeModal}>Cancel</Button
        >
        <Button on:click={() => submitNow(false)}>Zap with Lightning Wallet</Button>
        <Button on:click={() => submitNow(true)}>Zap with QR Code</Button>
      </div>
  {:else if state == "error"}
    <div class="flex flex-col items-center justify-center">
      <XIcon color="red" weight="bold" class="w-36 h-36" />
      <span class="text-2xl ml-4 text-center">An Error Occurred. <br /> {error && error.toString()}</span>
      <div class="flex gap-2 mt-4">
        <Button on:click={closeModal}>Close</Button>
        {#if error && (error.toString().includes('Wallet extension not available') || error.toString().includes('WebLN') || error.toString().includes('Lightning'))}
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
          <div class="flex gap-3 text-lg">
            <Avatar class="w-14 h-14 rounded-full self-center" ndk={$ndk} pubkey={paymentsToMakeQR[selected_qr - 1].recipientPubkey} />
            <div class="self-center gap-1">
              Zapping <span class="font-semibold">{amount} sats</span> to <Name class="font-semibold" ndk={$ndk} pubkey={paymentsToMakeQR[selected_qr - 1].recipientPubkey} />
              {#if event}
                <span class="text-sm text-gray-600">for this recipe</span>
              {/if}
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
                shape: "circle"
              }}
            />
            <div class="break-all">
              {paymentsToMakeQR[selected_qr - 1].pr}
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
      </div>
    {:else}
      <div class="flex flex-col items-center justify-center">
        <Checkmark color="#90EE90" weight="fill" class="w-36 h-36" />
        <span class="text-2xl ml-4">Payment Completed</span>
        <Button on:click={closeModal} class="mt-4">Close</Button>
      </div>
    {/if}
  {/if}
    </div>
</Modal>
