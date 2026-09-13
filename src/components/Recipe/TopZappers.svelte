<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { formatAmount } from '$lib/utils';
  import { fetchZapTally } from '$lib/recipeZaps';
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

  const MAX_VISIBLE = 5;

  async function fetchTopZappers(eventId: string): Promise<ZapperInfo[]> {
    // Zap receipts come from the aggregator relays via the shared NDK
    // pool (used to be five dedicated raw WebSockets per mount).
    const tally = await fetchZapTally(eventId);
    return Array.from(tally.satsByZapper.entries())
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
    // Nothing to tear down — the tally fetch runs through the shared
    // NDK pool with closeOnEose.
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
