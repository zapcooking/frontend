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
        loading = false;
        return;
      }

      const aTag = `${event.kind}:${event.author?.hexpubkey || event.pubkey}:${dTag}`;

      // Fetch existing zaps with both #e (event ID) and #a (address) tags
      // Different clients use different tagging conventions
      // Explicitly request no limit to get all zaps
      const zapsByE = await $ndk.fetchEvents({
        kinds: [9735],
        '#e': [event.id],
        limit: 1000 // Request up to 1000 zaps
      });

      const zapsByA = await $ndk.fetchEvents({
        kinds: [9735],
        '#a': [aTag],
        limit: 1000 // Request up to 1000 zaps
      });

      // Process all found zaps (deduplicate with Set)
      const allZaps = new Set([...zapsByE, ...zapsByA]);
      allZaps.forEach((zapEvent) => {
        processZapEvent(zapEvent);
      });

      // We've processed existing zaps, now stop loading
      loading = false;

      // Stop existing subscription if any
      if (subscription) {
        subscription.stop();
      }

      // Subscribe to listen for NEW zaps (both #e and #a tags)
      // Guard: ensure we have valid event.id and aTag before subscribing
      if (!event.id || !aTag) {
        return;
      }
      
      const filters = [
        { kinds: [9735], '#a': [aTag] },
        { kinds: [9735], '#e': [event.id] }
      ];
      
      if (filters.length === 0) {
        return;
      }
      
      subscription = $ndk.subscribe(filters);

      subscription.on('event', (zapEvent: NDKEvent) => {
        processZapEvent(zapEvent);
      });

    } catch (error) {
      console.error('Error loading recipe zaps:', error);
      loading = false;
    }
  }

  function processZapEvent(zapEvent: NDKEvent) {
    // Use event ID as unique identifier (more reliable than sig in NDK)
    const eventId = zapEvent.id;
    if (!eventId || processedEvents.has(eventId)) {
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
          processedEvents.add(eventId);

          // Check if current user zapped
          if (zapEvent.tags.some(tag => tag[0] === 'P' && tag[1] === $userPublickey)) {
            hasUserZapped = true;
          }
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
  <LightningIcon size={24} class={totalZapAmount > 0 ? 'text-yellow-500' : 'text-black'} weight={hasUserZapped ? "fill" : "regular"} />
  {#if loading}...{:else}{formatAmount(totalZapAmount / 1000)} sats{/if}
</div>
