<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { onMount, onDestroy } from 'svelte';
  import { formatAmount } from '$lib/utils';
  import { extractZapAmountSats } from '$lib/zapAmount';
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

      const { sats } = extractZapAmountSats(zapEvent);
      if (sats <= 0) continue;

      result.totalSats += sats;
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
    // Close any active WebSocket connections
    activeWebSockets.forEach(ws => {
      try { ws.close(); } catch (e) { /* ignore */ }
    });
    activeWebSockets = [];
  });
</script>

<div class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300">
  <LightningIcon size={24} class={totalZapAmount > 0 ? 'text-yellow-500' : 'text-caption'} weight={hasUserZapped ? "fill" : "regular"} />
  {#if loading}...{:else}{formatAmount(totalZapAmount)}{/if}
</div>
