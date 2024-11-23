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

  //const defaultZapUSDAmounts = [0.05, 0.5, 2, 5, 10, 21, 50, 100, 200];
  const defaultZapSatsAmounts = [
    21, 121, 400, 1000, 2100, 4200, 10000, 21000, 42000, 69000, 100000, 210000, 500000, 1000000
  ];

  let selectedCurrency: 'SATS' | 'USD' = 'SATS';

  export let open = false;
  export let event: NDKEvent | NDKUser;
  let amount: number = 21;
  let message: string = '';

  // only if we are using qr codes!
  $: paymentsToMakeQR = [];

  // "pre" | "pending" | "success" | "error"
  $: state = "pre";
  $: useQR = false;
  let error: Error;

  // TODO: add loading state while fetching invoice(s).

  async function submitNow(qr: boolean) {
    const a = await $ndk.zap(event, amount * 1000, message);
    a.on("complete", (results) => {
      const allSuccessful = Array.from(results.values()).every(result => result !== undefined && !(result instanceof Error));
      state = allSuccessful ? "success" : "error";
    });

    useQR = qr;

    // try webln first.
    if (a) {
      a.onCashuPay = () => {
        error = new Error("Cannot Zap This User");
        return error;
      };
      try {
        state = "pending";
        if (!qr) {
          const webln = await requestProvider();
          a.onLnPay = async (payment) => { 
            let preimage = (await webln.sendPayment(payment.pr)).preimage

            return { preimage };
          };
        } else {
          a.onLnPay = async (payment) => {
            paymentsToMakeQR.push(payment);
            paymentsToMakeQR = paymentsToMakeQR;
          
            return true; // we don't have a preimage to return
          };
        }
      } catch (err) {
        console.log('error while handleing zap', err);
        state = "error";
      }
      a.zap();
    }
  }

  let selected_qr = 1;
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
          on:click={() => open = false}>Cancel</Button
        >
        <Button on:click={() => submitNow(false)}>Zap with Extension</Button>
        <Button on:click={() => submitNow(true)}>Zap with QR Code</Button>
      </div>
  {:else if state == "error"}
    <div class="flex flex-col items-center justify-center">
      <XIcon color="red" weight="bold" class="w-36 h-36" />
      <span class="text-2xl ml-4 text-center">An Error Occurred. <br /> {error.toString()}</span>
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
          <div class="break-all">
            {paymentsToMakeQR[selected_qr - 1].pr}
          </div>
          <div class="flex gap-3 justify-center">
            {#if selected_qr > 1}
              <LeftIcon class="self-center" />
            {/if}
            <span class="self-center">{selected_qr}/{paymentsToMakeQR.length}</span>
            {#if selected_qr < paymentsToMakeQR.length}
              <RightIcon class="self-center" />
            {/if}
          </div>
      </div>
    {:else}
      <div class="flex flex-col items-center justify-center">
        <Checkmark color="#90EE90" weight="fill" class="w-36 h-36" />
        <span class="text-2xl ml-4">Payment Completed</span>
      </div>
    {/if}
  {/if}
    </div>
</Modal>

