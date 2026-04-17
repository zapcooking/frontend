<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { formatAmount } from '$lib/utils';
  import { extractZapAmountSats } from '$lib/zapAmount';
  import CustomAvatar from '../CustomAvatar.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';

  export let event: NDKEvent;
  export let refreshKey: number = 0;

  type ZapperInfo = {
    pubkey: string;
    totalSats: number;
  };

  let topZappers: ZapperInfo[] = [];
  let loading = true;
  let activeWebSockets: WebSocket[] = [];

  const AGGREGATOR_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://nostr.wine',
    'wss://offchain.pub',
    'wss://relay.snort.social'
  ];

  const MAX_VISIBLE = 5;

  async function fetchTopZappers(eventId: string): Promise<ZapperInfo[]> {
    const zapperMap = new Map<string, number>();
    const processedIds = new Set<string>();
    const zapEvents: any[] = [];

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
            const req = JSON.stringify([
              'REQ',
              'zaps',
              { kinds: [9735], '#e': [eventId], limit: 500 }
            ]);
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
            activeWebSockets = activeWebSockets.filter((w) => w !== ws);
          };
        } catch (e) {
          resolve();
        }
      });
    });

    await Promise.all(relayPromises);

    // Process zap events and aggregate by sender
    for (const zapEvent of zapEvents) {
      if (!zapEvent.id || processedIds.has(zapEvent.id)) continue;
      processedIds.add(zapEvent.id);

      const { sats: amountSats } = extractZapAmountSats(zapEvent);
      if (amountSats <= 0) continue;

      // Extract sender from description tag
      const descTag = zapEvent.tags?.find((t: string[]) => t[0] === 'description');
      if (descTag?.[1]) {
        try {
          const zapRequest = JSON.parse(descTag[1]);
          if (zapRequest.pubkey) {
            const current = zapperMap.get(zapRequest.pubkey) || 0;
            zapperMap.set(zapRequest.pubkey, current + amountSats);
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }

    // Convert to array and sort by amount (highest first)
    return Array.from(zapperMap.entries())
      .map(([pubkey, totalSats]) => ({ pubkey, totalSats }))
      .sort((a, b) => b.totalSats - a.totalSats);
  }

  async function loadTopZappers() {
    if (!event?.id) return;

    loading = true;
    topZappers = [];

    try {
      topZappers = await fetchTopZappers(event.id);
    } catch (error) {
      console.error('Error loading top zappers:', error);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadTopZappers();
  });

  // Reload when refreshKey changes
  $: if (refreshKey > 0) {
    loadTopZappers();
  }

  onDestroy(() => {
    activeWebSockets.forEach((ws) => {
      try {
        ws.close();
      } catch (e) {
        /* ignore */
      }
    });
    activeWebSockets = [];
  });

  $: visibleZappers = topZappers.slice(0, MAX_VISIBLE);
  $: hiddenCount = topZappers.length - MAX_VISIBLE;
  $: hiddenTotal = topZappers.slice(MAX_VISIBLE).reduce((sum, z) => sum + z.totalSats, 0);
</script>

{#if !loading && topZappers.length > 0}
  <div class="flex flex-wrap items-center gap-1.5 mb-2">
    <LightningIcon size={16} class="text-yellow-500" weight="fill" />
    {#each visibleZappers as zapper}
      <a
        href="/user/{zapper.pubkey}"
        class="flex items-center gap-1 h-6 px-1 pr-2 rounded-full bg-accent-gray hover:bg-yellow-500/20 transition-colors {zapper.pubkey ===
        $userPublickey
          ? 'ring-1 ring-yellow-500'
          : ''}"
        title="{zapper.totalSats} sats"
      >
        <CustomAvatar pubkey={zapper.pubkey} size={18} className="rounded-full" />
        <span class="text-xs text-caption">{formatAmount(zapper.totalSats)}</span>
      </a>
    {/each}

    {#if hiddenCount > 0}
      <span
        class="flex items-center h-6 px-2 rounded-full bg-accent-gray text-caption text-xs"
        title="{hiddenCount} more zappers ({hiddenTotal} sats)"
      >
        +{hiddenCount}
      </span>
    {/if}
  </div>
{/if}
