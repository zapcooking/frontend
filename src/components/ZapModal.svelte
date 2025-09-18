<script lang="ts">
  import { NDKEvent, NDKUser } from "@nostr-dev-kit/ndk";
  import { ndk } from "$lib/nostr";
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

  const defaultZapSatsAmounts = [
    21, 121, 400, 1000, 2100, 4200, 10000, 21000, 42000, 69000, 100000, 210000, 500000, 1000000
  ];

  let selectedCurrency: 'SATS' | 'USD' = 'SATS';

  export let open = false;
  export let event: NDKEvent;
  let amount: number = 21;
  let message: string = '';

  let paymentsToMakeQR: any[] = [];
  let paymentStatuses: { pubkey: string; paid: boolean }[] = [];

  $: state = "pre";
  $: useQR = false;
  let error: Error | null = null;

  async function submitNow(qr: boolean) {
    alert('DEBUG: submitNow called with qr: ' + qr);
    console.log('submitNow called with qr:', qr);
    console.log('Event parameter:', event);
    
    if (!event) {
      error = new Error("No event selected");
      state = "error";
      return;
    }

    if (amount <= 0) {
      error = new Error("Amount must be greater than 0");
      state = "error";
      return;
    }

    try {
      console.log('Starting zap process...', { event: event.id, amount, message, qr });
      
      // Debug the event structure
      console.log('Event details:', {
        id: event.id,
        pubkey: event.pubkey,
        author: event.author,
        authorPubkey: event.author?.hexpubkey,
        hasAuthor: !!event.author
      });
      
      alert('DEBUG: Event details - ID: ' + event.id + ', Author: ' + (event.author ? 'EXISTS' : 'NULL') + ', Pubkey: ' + event.pubkey);
      
      // Check if event is an NDKEvent
      console.log('Event type:', typeof event);
      console.log('Event constructor:', event.constructor.name);
      console.log('Is NDKEvent:', event instanceof NDKEvent);
      
      // Convert plain object to NDKEvent if needed
      let ndkEvent: NDKEvent = event as NDKEvent;
      if (!(event instanceof NDKEvent)) {
        console.log('Converting plain object to NDKEvent...');
        try {
          const eventData = event as any;
          ndkEvent = new NDKEvent($ndk, {
            id: eventData.id,
            pubkey: eventData.pubkey,
            content: eventData.content,
            created_at: eventData.created_at,
            tags: eventData.tags,
            kind: eventData.kind || 1,
            sig: eventData.sig
          });
          
          // Try to set the author
          if (eventData.author) {
            const author = new NDKUser({ hexpubkey: eventData.author.hexpubkey });
            ndkEvent.author = author;
          }
          
          console.log('Converted to NDKEvent:', ndkEvent);
          console.log('New NDKEvent author:', ndkEvent.author);
        } catch (convertError) {
          console.error('Failed to convert to NDKEvent:', convertError);
          error = new Error("Failed to process event for zapping");
          state = "error";
          return;
        }
      }
      
      // Check if user is authenticated
      if (!$ndk.signer) {
        error = new Error("Please log in to send zaps");
        state = "error";
        return;
      }
      
      // Check if the event has a valid author
      if (!ndkEvent.author || !ndkEvent.author.hexpubkey) {
        error = new Error("Cannot zap this event: missing author information");
        state = "error";
        return;
      }
      
      console.log('User is authenticated, creating zap request...');
      
      // Try to ensure the event author is properly loaded
      if (!ndkEvent.author) {
        console.log('Event author is null, trying to fetch author...');
        try {
          // Try to get the author from the NDK instance
          const author = await $ndk.getUser({ pubkey: ndkEvent.pubkey });
          if (author) {
            console.log('Found author via NDK:', author);
            // Update the event's author
            ndkEvent.author = author;
          }
        } catch (fetchError) {
          console.log('Could not fetch author:', fetchError);
        }
      }
      
      // Add timeout to prevent hanging
      const zapPromise = $ndk.zap(ndkEvent, amount * 1000, { 
        comment: message
      });
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Zap creation timeout after 10 seconds')), 10000)
      );
      
      const zapResult = await Promise.race([zapPromise, timeoutPromise]) as any;
      
      console.log('Zap result received:', zapResult);
      console.log('Zap result type:', typeof zapResult);
      console.log('Zap result keys:', Object.keys(zapResult || {}));
      
      // Check what zap methods are available
      if (zapResult.getZapMethods) {
        try {
          const zapMethods = await zapResult.getZapMethods();
          console.log('Available zap methods:', zapMethods);
        } catch (methodsError) {
          console.log('Could not get zap methods:', methodsError);
        }
      }
      
      // Check if the target event author has Lightning addresses
      try {
        const targetUser = await ndkEvent.author?.fetchProfile();
        console.log('Target user profile:', targetUser);
        if (targetUser) {
          console.log('User lightning addresses:', {
            lud06: targetUser.lud06,
            lud16: targetUser.lud16
          });
        }
      } catch (profileError) {
        console.log('Could not fetch target user profile:', profileError);
      }
      
      if (!zapResult) {
        error = new Error("Failed to create zap request");
        state = "error";
        return;
      }

      // Check if zapResult has the expected methods
      if (typeof zapResult.on !== 'function') {
        console.error('Zap result does not have on method:', zapResult);
        error = new Error("Invalid zap result - missing event handlers");
        state = "error";
        return;
      }

      zapResult.on("complete", (results: any) => {
        console.log('Zap completed with results:', results);
        console.log('Results values:', Array.from(results.values()));
        
        // Check if we have any successful results (non-undefined, non-error)
        const successfulResults = Array.from(results.values()).filter((result: any) => 
          result !== undefined && !(result instanceof Error) && result !== null
        );
        
        // Check if we have any actual errors
        const errorResults = Array.from(results.values()).filter((result: any) => result instanceof Error);
        
        console.log('Successful results:', successfulResults.length);
        console.log('Error results:', errorResults.length);
        
        if (successfulResults.length > 0) {
          // We have at least one successful result
          state = "success";
          console.log('Zap completed successfully');
        } else if (errorResults.length > 0) {
          // We have actual errors
          state = "error";
          error = errorResults[0] as Error;
          console.log('Zap failed with errors:', errorResults);
        } else {
          // All results are undefined (like when Cashu is skipped)
          // This might mean no payment methods worked, but it's not necessarily an error
          console.log('All zap results are undefined - no payment methods succeeded');
          state = "error";
          error = new Error("No payment methods were available. The recipient may not have Lightning addresses configured.");
        }
      });

      useQR = qr;

      // Set up onCashuPay handler to prevent errors
      // Instead of throwing an error, return undefined to skip Cashu payments
      if (typeof zapResult.onCashuPay === 'function') {
        zapResult.onCashuPay = async () => {
          console.log('Cashu payment requested, but not supported - skipping');
          return undefined; // Return undefined to skip this payment method
        };
      } else {
        // If onCashuPay is not a function, set it as a function
        zapResult.onCashuPay = async () => {
          console.log('Cashu payment requested, but not supported - skipping');
          return undefined; // Return undefined to skip this payment method
        };
      }

      state = "pending";

      // Try WebLN first if not explicitly using QR mode
      let weblnAvailable = false;
      let webln: any = null;
      
      if (!qr) {
        try {
          console.log('Requesting WebLN provider...');
          
          // Add timeout to WebLN provider request
          const weblnPromise = requestProvider();
          const weblnTimeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('WebLN provider request timeout after 3 seconds')), 3000)
          );
          
          webln = await Promise.race([weblnPromise, weblnTimeoutPromise]) as any;
          console.log('WebLN provider found:', webln);
          console.log('WebLN provider methods:', Object.keys(webln || {}));
          
          weblnAvailable = true;
        } catch (weblnError) {
          console.log('WebLN not available, falling back to QR mode:', weblnError);
          weblnAvailable = false;
          useQR = true; // Automatically switch to QR mode
        }
      }
      
      // Always set up Lightning payment handler (both for WebLN and QR modes)
      console.log('Setting up payment handlers...');
      console.log('zapResult.onLnPay type:', typeof zapResult.onLnPay);
      console.log('zapResult.onCashuPay type:', typeof zapResult.onCashuPay);
      
      if (typeof zapResult.onLnPay === 'function') {
        console.log('Setting up onLnPay handler...');
        zapResult.onLnPay = async (payment: any) => {
          console.log('Lightning payment requested:', payment);
          
          if (weblnAvailable && !qr) {
            // Use WebLN for payment
            try {
              console.log('Processing Lightning payment with WebLN:', payment.pr);
              const result = await webln.sendPayment(payment.pr);
              console.log('WebLN payment result:', result);
              return { preimage: result.preimage };
            } catch (weblnError) {
              console.error('WebLN payment failed:', weblnError);
              throw weblnError;
            }
          } else {
            // Use QR code for payment
            console.log('Adding payment to QR list:', payment);
            paymentsToMakeQR.push(payment);
            paymentsToMakeQR = paymentsToMakeQR;
            
            subscribeToZapReceipt(payment.recipientPubkey, payment.pr);
          
            return { preimage: 'qr-mode' };
          }
        };
      } else {
        console.log('onLnPay is not available on zapResult - trying to set it manually');
        // Try to set onLnPay manually
        zapResult.onLnPay = async (payment: any) => {
          console.log('Lightning payment requested (manual handler):', payment);
          
          if (weblnAvailable && !qr) {
            // Use WebLN for payment
            try {
              console.log('Processing Lightning payment with WebLN:', payment.pr);
              const result = await webln.sendPayment(payment.pr);
              console.log('WebLN payment result:', result);
              return { preimage: result.preimage };
            } catch (weblnError) {
              console.error('WebLN payment failed:', weblnError);
              throw weblnError;
            }
          } else {
            // Use QR code for payment
            console.log('Adding payment to QR list:', payment);
            paymentsToMakeQR.push(payment);
            paymentsToMakeQR = paymentsToMakeQR;
            
            subscribeToZapReceipt(payment.recipientPubkey, payment.pr);
          
            return { preimage: 'qr-mode' };
          }
        };
      }

      console.log('Starting zap execution...');
      
      // Try to force Lightning payments by setting zapMethod
      console.log('Current zapMethod:', zapResult.zapMethod);
      if (zapResult.zapMethod) {
        zapResult.zapMethod = 'ln'; // Force Lightning payments
        console.log('Set zapMethod to Lightning');
      }
      
      // Execute the zap using the zap() method
      try {
        console.log('Calling zap()...');
        await zapResult.zap();
        console.log('Zap executed successfully');
      } catch (zapError) {
        console.error('Zap execution error:', zapError);
        error = new Error("Zap execution failed: " + (zapError instanceof Error ? zapError.message : String(zapError)));
        state = "error";
        return;
      }
      
      // Add some debugging to see if the zap actually starts
      setTimeout(() => {
        console.log('Checking zap status after 2 seconds...');
        console.log('Current state:', state);
        console.log('Payments to make QR:', paymentsToMakeQR.length);
      }, 2000);
      
    } catch (err) {
      console.error('Error while handling zap:', err);
      error = err instanceof Error ? err : new Error("Unknown error occurred");
      state = "error";
    }
  }

  function subscribeToZapReceipt(pubkey: string, expectedInvoice: string) {
    const sub = $ndk.subscribe({ kinds: [9735], "#p": [pubkey], "#e": [event.id] });
    sub.on('event', (zapEvent: NDKEvent) => {
      // Use tags property instead of getMatchingTags method
      const bolt11Tags = zapEvent.tags.filter(tag => tag[0] === 'bolt11');
      if (bolt11Tags.length > 0) {
        const receivedInvoice = bolt11Tags[0][1];
        if (receivedInvoice === expectedInvoice) {
          const status = { pubkey, paid: true };
          paymentStatuses = [...paymentStatuses, status];
        }
      }
    });
  }

  let selected_qr = 1;

  $: isPaid = (pubkey: string) => paymentStatuses.some(status => status.pubkey === pubkey && status.paid);

  // Reset state when modal opens/closes
  $: if (open) {
    console.log('ZapModal opened for event:', event?.id);
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
  <h1 slot="title">Zap</h1>
  <div class="flex flex-col gap-3">
  {#if state == "pending"}
    <div class="flex flex-col text-2xl">
      <img class="w-52 self-center" src="/pan-animated.svg" alt="Loading" />

      <span class="self-center">{useQR ? "Fetching Invoice(s)..." : "Waiting for Payment..."}</span>
      {#if useQR}
        <span class="self-center text-center">If this takes a while refresh and try again.</span>
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
        <Button on:click={() => submitNow(false)}>Zap with Extension (or QR)</Button>
        <Button on:click={() => submitNow(true)}>Zap with QR Code</Button>
      </div>
  {:else if state == "error"}
    <div class="flex flex-col items-center justify-center">
      <XIcon color="red" weight="bold" class="w-36 h-36" />
      <span class="text-2xl ml-4 text-center">An Error Occurred. <br /> {error && error.toString()}</span>
      <div class="flex gap-2 mt-4">
        <Button on:click={closeModal}>Close</Button>
        {#if error && error.toString().includes('Wallet extension not available')}
          <Button on:click={() => {
            state = "pre";
            error = null;
            useQR = true;
            submitNow(true);
          }}>Try QR Code</Button>
        {/if}
      </div>
    </div>
  {:else if state == "success"}
    {#if useQR == true}
      <div class="flex flex-col gap-3">
          <div class="flex gap-3 text-lg">
            <Avatar class="w-14 h-14 rounded-full self-center" ndk={$ndk} pubkey={paymentsToMakeQR[selected_qr - 1].recipientPubkey} />
            <div class="self-center gap-1">
              Zapping <span class="font-semibold">{amount} sats</span> to <Name class="font-semibold" ndk={$ndk} pubkey={paymentsToMakeQR[selected_qr - 1].recipientPubkey} />
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
