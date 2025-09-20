<script lang="ts">
  import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk';
  import { onMount, onDestroy } from 'svelte';
  import { ndk } from '$lib/nostr';
  import { ZapManager } from '$lib/zapManager';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { formatAmount } from '$lib/utils';

  export let event: NDKEvent | null = null;
  export let user: NDKUser | null = null;
  export let showIcon = true;
  export let showCount = true;
  export let showTotal = true;
  export let size: 'sm' | 'md' | 'lg' = 'md';

  let zapCount = 0;
  let zapTotal = 0;
  let loading = true;
  let zapManager: ZapManager;
  let subscription: any = null;

  // Size classes
  const sizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base'
  };

  const iconSizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5'
  };

  onMount(async () => {
    zapManager = new ZapManager($ndk);
    await loadZapTotals();
    subscribeToZapReceipts();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
    }
  });

  async function loadZapTotals() {
    try {
      loading = true;
      
      if (event) {
        const totals = await zapManager.getZapTotals(event.pubkey, event.id);
        zapCount = totals.count;
        zapTotal = totals.total;
      } else if (user) {
        const totals = await zapManager.getZapTotals(user.hexpubkey);
        zapCount = totals.count;
        zapTotal = totals.total;
      }
    } catch (error) {
      console.error('Failed to load zap totals:', error);
    } finally {
      loading = false;
    }
  }

  function subscribeToZapReceipts() {
    if (event) {
      subscription = zapManager.subscribeToZapReceipts(
        event.pubkey,
        event.id,
        () => {
          // Reload totals when new zap receipt arrives
          loadZapTotals();
        }
      );
    } else if (user) {
      subscription = zapManager.subscribeToZapReceipts(
        user.hexpubkey,
        undefined,
        () => {
          // Reload totals when new zap receipt arrives
          loadZapTotals();
        }
      );
    }
  }
</script>

<div class="flex items-center gap-1 {sizeClasses[size]} text-gray-600">
  {#if loading}
    <div class="animate-pulse">...</div>
  {:else}
    {#if showIcon}
      <LightningIcon class="{iconSizeClasses[size]}" weight="fill" />
    {/if}
    
    {#if showCount && zapCount > 0}
      <span>{zapCount}</span>
    {/if}
    
    {#if showTotal && zapTotal > 0}
      <span class="font-medium">{formatAmount(zapTotal)} sats</span>
    {/if}
    
    {#if !showCount && !showTotal && zapCount === 0}
      <span class="opacity-50">No zaps yet</span>
    {/if}
  {/if}
</div>

