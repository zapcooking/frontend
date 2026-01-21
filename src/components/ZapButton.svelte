<script lang="ts">
  import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk';
  import { createEventDispatcher } from 'svelte';
  import ZapModal from './ZapModal.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { formatAmount } from '$lib/utils';
  import { canOneTapZap, sendOneTapZap, getOneTapAmount } from '$lib/oneTapZap';

  export let event: NDKEvent | null = null;
  export let user: NDKUser | null = null;
  export let showAmount = false;
  export let zapCount = 0;
  export let zapTotal = 0;
  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let variant: 'default' | 'minimal' | 'icon-only' = 'default';

  const dispatch = createEventDispatcher();

  let zapModalOpen = false;
  let isZapping = false;

  async function handleZapClick() {
    const target = event || user;
    if (!target) return;

    // If one-tap zap is available, send immediately
    if (canOneTapZap()) {
      isZapping = true;
      const result = await sendOneTapZap(target);
      isZapping = false;

      if (result.success) {
        dispatch('zap-complete', { amount: result.amount });
      } else {
        // If one-tap fails, fall back to opening the modal
        console.warn('[ZapButton] One-tap zap failed, opening modal:', result.error);
        zapModalOpen = true;
      }
    } else {
      // No one-tap available, open the modal
      zapModalOpen = true;
    }
  }

  function handleZapComplete(e: CustomEvent<{ amount: number }>) {
    zapModalOpen = false;
    dispatch('zap-complete', e.detail);
  }

  // Size classes
  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-2',
    lg: 'text-base px-4 py-3'
  };

  // Icon size classes
  const iconSizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5'
  };

  // Variant classes
  const variantClasses = {
    default:
      'bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-medium transition-colors',
    minimal:
      'text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50 rounded-lg transition-colors',
    'icon-only':
      'text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50 rounded-full p-2 transition-colors'
  };
</script>

<button
  class="flex items-center gap-2 {sizeClasses[size]} {variantClasses[variant]}"
  class:opacity-50={isZapping}
  class:cursor-wait={isZapping}
  on:click={handleZapClick}
  disabled={isZapping}
  title={canOneTapZap() ? `Zap ${getOneTapAmount()} sats` : 'Send Lightning zap'}
>
  <LightningIcon class="{iconSizeClasses[size]} {isZapping ? 'animate-pulse' : ''}" weight="fill" />

  {#if variant !== 'icon-only'}
    <span>{isZapping ? 'Zapping...' : 'Zap'}</span>

    {#if showAmount && zapCount > 0}
      <span class="text-xs opacity-75">
        {formatAmount(zapTotal)} sats
      </span>
    {/if}
  {/if}
</button>

{#if zapModalOpen && (event || user)}
  <ZapModal bind:open={zapModalOpen} event={event || user} on:zap-complete={handleZapComplete} />
{/if}
