<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { onMount, onDestroy } from 'svelte';
  import { formatAmount } from '$lib/utils';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { createZapCache, getZapCache } from '$lib/zapCache';
  import NoteTotalZapsSkeleton from './NoteTotalZapsSkeleton.svelte';

  export let event: NDKEvent;
  let loading = true;
  let totalZapAmount: number = 0;
  let hasUserZapped = false;
  let zapCache: any = null;

  async function loadZaps() {
    if (!event?.id) return;
    
    loading = true;

    try {
      // Get or create zap cache
      if (!zapCache) {
        zapCache = createZapCache($ndk, $userPublickey);
      }

      // Get zap data from cache
      const zapData = await zapCache.getZapData(event.id);
      totalZapAmount = zapData.totalAmount;
      hasUserZapped = zapData.userHasZapped;

    } catch (error) {
      console.error('Error loading zaps:', error);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadZaps();
  });

  onDestroy(() => {
    // Clean up cache entry when component is destroyed
    if (zapCache && event?.id) {
      zapCache.removeEvent(event.id);
    }
  });

  // Reload when event changes
  $: if (event?.id) {
    loadZaps();
  }

  // Update when user public key changes
  $: if (zapCache && $userPublickey) {
    zapCache.updateUserPublickey($userPublickey);
    loadZaps(); // Reload to update userHasZapped status
  }
</script>

{#if loading}
  <NoteTotalZapsSkeleton />
{:else}
  <div class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300">
    <LightningIcon size={24} color={hasUserZapped ? '#facc15' : ''} weight={hasUserZapped ? "fill" : "regular"} />
    {formatAmount(totalZapAmount / 1000)} sats
  </div>
{/if}
