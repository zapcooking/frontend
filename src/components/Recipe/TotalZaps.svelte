<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { onMount, onDestroy } from 'svelte';
  import { formatAmount } from '$lib/utils';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { browser } from '$app/environment';

  export let event: NDKEvent;
  let loading = true;
  let totalZapAmount: number = 0;
  let processedZapIds = new Set<string>();
  let hasUserZapped = false;
  let subscription: NDKSubscription | null = null;
  let mounted = false;
  let activeWebSockets: WebSocket[] = [];

  // Aggregator relays known to have good zap data
  // Tested for response time (<800ms) and zap coverage
  const AGGREGATOR_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://nostr.wine',
    'wss://offchain.pub',
    'wss://relay.snort.social'
  ];

  // Extract zap amount from bolt11 invoice
  function extractAmountFromBolt11(bolt11: string): number | null {
    // Format: lnbc[amount][unit] where unit determines multiplier
    // m = milli (0.001), u = micro (0.000001), n = nano (0.000000001), p = pico
    const match = bolt11.match(/^lnbc(\d+)([munp]?)/i);
    if (!match) return null;

    let amount = parseInt(match[1]);
    const unit = match[2]?.toLowerCase() || '';

    // Convert to millisats based on unit
    // Note: BOLT11 amounts are in BTC units with multipliers
    if (unit === 'p') amount = Math.floor(amount / 10); // pico-BTC to msat
    else if (unit === 'n') amount = amount * 100; // nano-BTC to msat
    else if (unit === 'u') amount = amount * 100000; // micro-BTC to msat
    else if (unit === 'm') amount = amount * 100000000; // milli-BTC to msat
    else amount = amount * 100000000000; // BTC to msat

    return amount;
  }

  // Fetch zaps directly from relays using raw WebSocket (similar to Habla.news approach)
  async function fetchZapsFromRelays(eventId: string): Promise<{ totalSats: number; zapCount: number; zapperPubkeys: string[] }> {
    const result = { totalSats: 0, zapCount: 0, zapperPubkeys: [] as string[] };
    const zapEvents: any[] = [];

    // Query all aggregator relays in parallel
    const relayPromises = AGGREGATOR_RELAYS.map((relayUrl) => {
      return new Promise<void>((resolve) => {
        try {
          const ws = new WebSocket(relayUrl);
          activeWebSockets.push(ws);

          const timeout = setTimeout(() => {
            ws.close();
            resolve();
          }, 6000);

          ws.onopen = () => {
            // Query for zaps by #e tag (event ID)
            const req = JSON.stringify(['REQ', 'zaps', { kinds: [9735], '#e': [eventId], limit: 500 }]);
            ws.send(req);
          };

          ws.onmessage = (msg) => {
            try {
              const data = JSON.parse(msg.data);
              if (data[0] === 'EVENT' && data[2]?.kind === 9735) {
                zapEvents.push(data[2]);
              } else if (data[0] === 'EOSE') {
                clearTimeout(timeout);
                ws.close();
                resolve();
              }
            } catch (e) {
              // Ignore parse errors
            }
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            resolve();
          };

          ws.onclose = () => {
            activeWebSockets = activeWebSockets.filter(w => w !== ws);
          };
        } catch (e) {
          resolve();
        }
      });
    });

    // Wait for all relays to respond (or timeout)
    await Promise.all(relayPromises);

    // Process all collected zap events
    for (const zapEvent of zapEvents) {
      if (!zapEvent.id || processedZapIds.has(zapEvent.id)) continue;
      processedZapIds.add(zapEvent.id);

      const bolt11Tag = zapEvent.tags?.find((t: string[]) => t[0] === 'bolt11');
      const bolt11 = bolt11Tag?.[1];
      if (!bolt11) continue;

      const amountMsats = extractAmountFromBolt11(bolt11);
      if (amountMsats && amountMsats > 0) {
        result.totalSats += Math.floor(amountMsats / 1000);
        result.zapCount++;

        // Extract sender from description tag (contains zap request)
        const descTag = zapEvent.tags?.find((t: string[]) => t[0] === 'description');
        if (descTag?.[1]) {
          try {
            const zapRequest = JSON.parse(descTag[1]);
            if (zapRequest.pubkey) {
              result.zapperPubkeys.push(zapRequest.pubkey);
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }

    return result;
  }

  async function loadZaps() {
    if (!event?.id || !mounted) return;

    loading = true;
    totalZapAmount = 0;
    processedZapIds.clear();
    hasUserZapped = false;

    try {
      // Fetch zaps directly from aggregator relays (Habla.news approach)
      const relayResult = await fetchZapsFromRelays(event.id);

      totalZapAmount = relayResult.totalSats;

      // Check if current user zapped
      if ($userPublickey && relayResult.zapperPubkeys.includes($userPublickey)) {
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
          // For new zaps, try to extract amount from bolt11
          if (!processedZapIds.has(zapEvent.id)) {
            processedZapIds.add(zapEvent.id);
            const bolt11 = zapEvent.tags.find((tag) => tag[0] === 'bolt11')?.[1];
            if (bolt11) {
              const amountMsats = extractAmountFromBolt11(bolt11);
              if (amountMsats && amountMsats > 0) {
                totalZapAmount += Math.floor(amountMsats / 1000); // Convert to sats
              }
            }
          }
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
    // Close any active WebSocket connections
    activeWebSockets.forEach(ws => {
      try { ws.close(); } catch (e) { /* ignore */ }
    });
    activeWebSockets = [];
  });
</script>

<div class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300">
  <LightningIcon size={24} class={totalZapAmount > 0 ? 'text-yellow-500' : 'text-caption'} weight={hasUserZapped ? "fill" : "regular"} />
  {#if loading}...{:else}{formatAmount(totalZapAmount)} sats{/if}
</div>
