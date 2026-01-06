<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { formatAmount } from '$lib/utils';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { getEngagementStore, fetchEngagement } from '$lib/engagementCache';

  export let event: NDKEvent;
  
  const store = getEngagementStore(event.id);

  onMount(() => {
    fetchEngagement($ndk, event.id, $userPublickey);
  });
</script>

{#if $store.loading}
  <div class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300" style="color: var(--color-text-primary)">
    <LightningIcon size={24} class="text-caption" weight="regular" />
    <span class="text-caption">–</span>
  </div>
{:else}
  <div class="flex gap-1.5 hover:bg-input rounded px-0.5 transition duration-300" style="color: var(--color-text-primary)">
    <LightningIcon 
      size={24} 
      class={$store.zaps.totalAmount > 0 ? 'text-yellow-500' : 'text-caption'} 
      weight={$store.zaps.userZapped ? "fill" : "regular"} 
    />
    {formatAmount($store.zaps.totalAmount / 1000)}
  </div>
{/if}
