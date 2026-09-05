<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { onMount, onDestroy } from 'svelte';
  import { formatAmount } from '$lib/utils';
  import { extractZapAmountSats } from '$lib/zapAmount';
  import { fetchZapTally } from '$lib/recipeZaps';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { browser } from '$app/environment';

  export let event: NDKEvent;
  let loading = true;
  let totalZapAmount: number = 0;
  let processedZapIds = new Set<string>();
  let hasUserZapped = false;
  let subscription: NDKSubscription | null = null;
  let mounted = false;

  async function loadZaps() {
    if (!event?.id || !mounted) return;

    loading = true;
    totalZapAmount = 0;
    processedZapIds.clear();
    hasUserZapped = false;

    try {
      // Zap receipts come from the aggregator relays via the shared NDK
      // pool (used to be five dedicated raw WebSockets per mount).
      const tally = await fetchZapTally(event.id);

      totalZapAmount = tally.totalSats;

      // Check if current user zapped
      if ($userPublickey && tally.satsByZapper.has($userPublickey)) {
        hasUserZapped = true;
      }

      loading = false;

      // Also subscribe to new zaps via NDK for real-time updates
      if (subscription) {
        subscription.stop();
      }

      const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1];
      if (dTag) {
        const aTag = `${event.kind}:${event.author?.hexpubkey || event.pubkey}:${dTag}`;

        const filters = [
          { kinds: [9735], '#a': [aTag] },
          { kinds: [9735], '#e': [event.id] }
        ];

        subscription = $ndk.subscribe(filters);

        subscription.on('event', (zapEvent: NDKEvent) => {
          if (processedZapIds.has(zapEvent.id)) return;
          processedZapIds.add(zapEvent.id);
          const { sats } = extractZapAmountSats(zapEvent);
          if (sats > 0) totalZapAmount += sats;
        });
      }

    } catch (error) {
      console.error('Error loading recipe zaps:', error);
      loading = false;
    }
  }

  onMount(() => {
    mounted = true;
    loadZaps();
  });

  onDestroy(() => {
    mounted = false;
    if (subscription) {
      subscription.stop();
    }
    subscription = null;
  });
</script>

<div class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300">
  <LightningIcon size={24} class={totalZapAmount > 0 ? 'text-yellow-500' : 'text-caption'} weight={hasUserZapped ? "fill" : "regular"} />
  {#if loading}...{:else}{formatAmount(totalZapAmount)}{/if}
</div>
