<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { onMount, onDestroy } from 'svelte';
  import { formatAmount } from '$lib/utils';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { decode } from '@gandlaf21/bolt11-decode';
  import NoteTotalZapsSkeleton from './NoteTotalZapsSkeleton.svelte';

  export let event: NDKEvent;
  let loading = true;
  let totalZapAmount: number = 0;
  let hasUserZapped = false;
  let processedEvents = new Set<string>();
  let subscription: NDKSubscription | null = null;

  async function loadZaps() {
    if (!event?.id) {
      loading = false;
      return;
    }
    
    loading = true;
    totalZapAmount = 0;
    processedEvents.clear();
    hasUserZapped = false;

    try {
      if (subscription) {
        subscription.stop();
      }

      subscription = $ndk.subscribe({
        kinds: [9735],
        '#e': [event.id]
      });

      subscription.on('event', (zapEvent: NDKEvent) => {
        processZapEvent(zapEvent);
      });

      subscription.on('eose', () => {
        loading = false;
      });

    } catch (error) {
      console.error('Error loading zaps:', error);
      loading = false;
    }
  }

  onMount(() => {
    loadZaps();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
    }
    subscription = null;
  });

  // Reload when event changes
  $: if (event?.id) {
    loadZaps();
  }

  function processZapEvent(zapEvent: NDKEvent) {
    if (!zapEvent.sig || processedEvents.has(zapEvent.sig)) {
      return;
    }

    const bolt11 = zapEvent.tags.find((tag) => tag[0] === 'bolt11')?.[1];
    if (!bolt11) {
      return;
    }

    try {
      const decoded = decode(bolt11);
      const amountSection = decoded.sections.find((section) => section.name === 'amount');

      if (amountSection && amountSection.value) {
        const amount = Number(amountSection.value);
        if (!isNaN(amount) && amount > 0) {
          totalZapAmount += amount;
          processedEvents.add(zapEvent.sig);

          if (zapEvent.tags.some((tag) => tag[0] === 'P' && tag[1] === $userPublickey)) {
            hasUserZapped = true;
          }

          console.log(`Processed note zap: ${amount} sats, total: ${totalZapAmount}`);
        }
      }
    } catch (error) {
      console.error('Error decoding bolt11:', error);
    }
  }
</script>

{#if loading}
  <NoteTotalZapsSkeleton />
{:else}
  <div class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300" style="color: var(--color-text-primary)">
    <LightningIcon size={24} class={totalZapAmount > 0 ? 'text-yellow-500' : 'text-caption'} weight={hasUserZapped ? "fill" : "regular"} />
    {formatAmount(totalZapAmount / 1000)}
  </div>
{/if}
