<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { onMount, onDestroy } from 'svelte';
  import { decode } from '@gandlaf21/bolt11-decode';
  import { formatAmount } from '$lib/utils';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';

  export let event: NDKEvent;
  let loading = true;
  let totalZapAmount: number = 0;
  let processedEvents = new Set<string>();
  let hasUserZapped = false;
  let subscription: NDKSubscription | null = null;

  async function loadZaps() {
    if (!event?.id) return;
    
    loading = true;
    totalZapAmount = 0;
    processedEvents.clear();
    hasUserZapped = false;

    try {
      // For recipes, we need to use the 'a' tag format
      const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1];
      if (!dTag) {
        console.warn('No d tag found for recipe event');
        return;
      }

      const aTag = `${event.kind}:${event.author?.hexpubkey || event.pubkey}:${dTag}`;

      // Then subscribe to new zap events
      subscription = $ndk.subscribe({
        kinds: [9735],
        '#a': [aTag]
      });

      subscription.on('event', (zapEvent: NDKEvent) => {
        processZapEvent(zapEvent);
      });

    } catch (error) {
      console.error('Error loading recipe zaps:', error);
    } finally {
      loading = false;
    }
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

          // Check if current user zapped
          if (zapEvent.tags.some(tag => tag[0] === 'P' && tag[1] === $userPublickey)) {
            hasUserZapped = true;
          }

          console.log(`Processed recipe zap: ${amount} sats, total: ${totalZapAmount}`);
        }
      }
    } catch (error) {
      console.error('Error decoding bolt11:', error);
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
</script>

<div class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300">
  <LightningIcon size={24} color={hasUserZapped ? '#facc15' : ''} weight={hasUserZapped ? "fill" : "regular"} />
  {#if loading}...{:else}{formatAmount(totalZapAmount / 1000)} sats{/if}
</div>
