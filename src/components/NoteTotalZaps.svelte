<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { formatAmount } from '$lib/utils';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { getEngagementStore, fetchEngagement } from '$lib/engagementCache';
  import ZappersListModal from './ZappersListModal.svelte';
  import { canOneTapZap, sendOneTapZap, getOneTapAmount } from '$lib/oneTapZap';

  export let event: NDKEvent;
  export let onZapClick: (() => void) | undefined = undefined; // Callback for zap button click (fallback when one-tap not available)

  const store = getEngagementStore(event.id);
  let showZappersModal = false;
  let isZapping = false;

  onMount(() => {
    fetchEngagement($ndk, event.id, $userPublickey);
  });

  function handleCountClick(e: MouseEvent) {
    e.stopPropagation(); // Prevent parent click handlers
    // Only open modal if there are zaps
    if ($store.zaps.count > 0) {
      showZappersModal = true;
    }
  }

  async function handleZapIconClick(e: MouseEvent) {
    e.stopPropagation(); // Prevent parent click handlers

    // If one-tap zap is available, send immediately
    if (canOneTapZap()) {
      isZapping = true;
      const result = await sendOneTapZap(event);
      isZapping = false;

      if (result.success) {
        // Refresh engagement data after successful zap
        fetchEngagement($ndk, event.id, $userPublickey);
      } else if (onZapClick) {
        // Fall back to modal if one-tap fails
        onZapClick();
      }
    } else if (onZapClick) {
      // No one-tap available, use the callback to open modal
      onZapClick();
    }
  }
</script>

{#if $store.loading}
  <div
    class="flex items-center gap-1.5 rounded px-0.5 transition duration-300"
    style="color: var(--color-text-primary)"
  >
    <button class="hover:bg-input rounded p-1" on:click={handleZapIconClick} title="Send a zap">
      <LightningIcon size={24} class="text-caption" weight="regular" />
    </button>
    <span class="text-caption">–</span>
  </div>
{:else}
  <div
    class="flex items-center gap-1.5 rounded px-0.5 transition duration-300"
    style="color: var(--color-text-primary)"
  >
    <!-- Zap Icon Button -->
    <button
      class="hover:bg-input rounded p-1 transition-colors"
      class:opacity-50={isZapping}
      class:cursor-wait={isZapping}
      on:click={handleZapIconClick}
      disabled={isZapping}
      title={canOneTapZap() ? `Zap ${getOneTapAmount()} sats` : 'Send a zap'}
    >
      <LightningIcon
        size={24}
        class="{$store.zaps.totalAmount > 0 ? 'text-yellow-500' : 'text-caption'} {isZapping
          ? 'animate-pulse'
          : ''}"
        weight={$store.zaps.userZapped ? 'fill' : 'regular'}
      />
    </button>

    <!-- Count Button - Opens ZappersListModal -->
    <button
      class="hover:bg-input rounded px-1 transition-colors text-caption {$store.zaps.count > 0
        ? 'cursor-pointer'
        : ''}"
      on:click={handleCountClick}
      disabled={$store.zaps.count === 0}
      title={$store.zaps.count > 0
        ? `View ${$store.zaps.count} ${$store.zaps.count === 1 ? 'zap' : 'zaps'}`
        : 'No zaps yet'}
    >
      {formatAmount($store.zaps.totalAmount / 1000)}
    </button>
  </div>
{/if}

<ZappersListModal
  bind:open={showZappersModal}
  zappers={$store.zaps.topZappers}
  totalAmount={$store.zaps.totalAmount}
/>
