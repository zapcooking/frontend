<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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

  // Long press handling
  const LONG_PRESS_DURATION = 500; // ms
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let isLongPress = false;
  let pressStartTime = 0;
  let touchStartPos: { x: number; y: number } | null = null;
  const TOUCH_MOVE_THRESHOLD = 10; // pixels - if touch moves more than this, cancel long press
  let lastTapTime = 0; // Debounce to prevent double-handling from touch + click

  onMount(() => {
    fetchEngagement($ndk, event.id, $userPublickey);
  });

  onDestroy(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
  });

  function handleCountClick(e: MouseEvent) {
    e.stopPropagation(); // Prevent parent click handlers
    // Only open modal if there are zaps
    if ($store.zaps.count > 0) {
      showZappersModal = true;
    }
  }

  // Start tracking press for long-press detection
  function handlePressStart(e: MouseEvent | TouchEvent) {
    e.stopPropagation();
    isLongPress = false;
    pressStartTime = Date.now();
    
    // Track touch position for mobile
    if (e instanceof TouchEvent && e.touches.length > 0) {
      touchStartPos = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      };
    }

    // Only use long press for one-tap zap users (they need a way to access custom amounts)
    if (canOneTapZap() && onZapClick) {
      longPressTimer = setTimeout(() => {
        isLongPress = true;
        // Vibrate on mobile to indicate long press detected
        if ('vibrate' in navigator) {
          navigator.vibrate(50);
        }
        // Open the zap modal for custom amount
        onZapClick();
      }, LONG_PRESS_DURATION);
    }
  }

  // Cancel long press timer and handle tap for touch events
  function handlePressEnd(e: MouseEvent | TouchEvent) {
    const wasLongPress = isLongPress;
    const hadTimer = longPressTimer !== null;
    
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    
    // For touch events on Safari, we need to trigger the zap action here
    // because the click event may not fire after preventDefault on touchstart
    if (e instanceof TouchEvent && !wasLongPress && touchStartPos !== null) {
      // This was a tap (touchstart -> touchend without long press or movement)
      // Trigger the zap action immediately
      touchStartPos = null;
      handleZapIconClick(e);
      return;
    }
    
    touchStartPos = null;
  }

  // Handle touch move - cancel long press if user is scrolling
  function handleTouchMove(e: TouchEvent) {
    if (!touchStartPos || !longPressTimer) return;
    
    if (e.touches.length > 0) {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const deltaX = Math.abs(currentX - touchStartPos.x);
      const deltaY = Math.abs(currentY - touchStartPos.y);
      
      // If touch moved significantly, cancel long press (user is scrolling)
      if (deltaX > TOUCH_MOVE_THRESHOLD || deltaY > TOUCH_MOVE_THRESHOLD) {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        touchStartPos = null;
      }
    }
  }

  // Handle the actual click/tap - works for both mouse and touch
  async function handleZapIconClick(e: MouseEvent | TouchEvent) {
    e.stopPropagation(); // Prevent parent click handlers
    e.preventDefault(); // Prevent default on Safari mobile

    // Debounce: prevent double-handling from touch + click events firing together
    const now = Date.now();
    if (now - lastTapTime < 300) {
      console.log('[NoteTotalZaps] Debounced duplicate tap');
      return;
    }
    lastTapTime = now;

    // If this was a long press, the modal is already open, don't do one-tap
    if (isLongPress) {
      isLongPress = false;
      return;
    }

    // If already zapping, don't allow another zap
    if (isZapping) {
      console.log('[NoteTotalZaps] Already zapping, ignoring tap');
      return;
    }

    // If one-tap zap is available, send immediately
    if (canOneTapZap()) {
      console.log('[NoteTotalZaps] One-tap zap starting...');
      
      // Haptic feedback on tap - immediate confirmation that tap was registered
      if ('vibrate' in navigator) {
        navigator.vibrate(30); // Short vibration on tap
      }
      
      // Set loading state immediately for visual feedback
      isZapping = true;
      
      // Optimistic update happens inside sendOneTapZap
      // The store should update reactively and show the new amount
      const result = await sendOneTapZap(event);
      
      console.log('[NoteTotalZaps] One-tap zap result:', result);
      isZapping = false;

      if (result.success) {
        // Haptic feedback on success - double pulse to confirm payment sent
        if ('vibrate' in navigator) {
          navigator.vibrate([40, 50, 40]); // Two short pulses
        }
        // The optimistic update already showed the zap, and the subscription will correct it
        // when the real zap receipt arrives. No need to force refresh here.
        console.log('[NoteTotalZaps] One-tap zap completed successfully, amount:', result.amount);
      } else {
        // Haptic feedback on failure - long vibration to indicate error
        if ('vibrate' in navigator) {
          navigator.vibrate(200); // Longer single vibration for error
        }
        console.log('[NoteTotalZaps] One-tap zap failed:', result.error);
        // If zap failed, we need to revert the optimistic update
        // Refresh to get accurate counts (this will revert the optimistic update)
        fetchEngagement($ndk, event.id, $userPublickey);
        
        if (onZapClick) {
          // Fall back to modal if one-tap fails
          onZapClick();
        }
      }
    } else if (onZapClick) {
      // No one-tap available, use the callback to open modal
      onZapClick();
    }
  }

  // Handle touch cancel (e.g., scroll started)
  function handleTouchCancel() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    isLongPress = false;
    touchStartPos = null;
  }
</script>

{#if $store.loading}
  <div
    class="flex items-center gap-1.5 rounded px-0.5 transition duration-300"
    style="color: var(--color-text-primary)"
  >
    <button 
      class="hover:bg-input rounded p-1 select-none touch-none" 
      style="touch-action: manipulation; -webkit-tap-highlight-color: transparent;"
      on:mousedown={handlePressStart}
      on:mouseup={handlePressEnd}
      on:mouseleave={handlePressEnd}
      on:touchstart|preventDefault={handlePressStart}
      on:touchmove|preventDefault={handleTouchMove}
      on:touchend|preventDefault={handlePressEnd}
      on:touchcancel={handleTouchCancel}
      on:click|preventDefault={handleZapIconClick}
      on:contextmenu|preventDefault={() => { if (onZapClick) onZapClick(); }}
      title={canOneTapZap() ? `Zap ${getOneTapAmount()} sats (hold for custom amount)` : 'Send a zap'}
    >
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
      class="hover:bg-input rounded p-1 transition-colors select-none touch-none"
      class:opacity-50={isZapping}
      class:cursor-wait={isZapping}
      style="touch-action: manipulation; -webkit-tap-highlight-color: transparent;"
      on:mousedown={handlePressStart}
      on:mouseup={handlePressEnd}
      on:mouseleave={handlePressEnd}
      on:touchstart|preventDefault={handlePressStart}
      on:touchmove|preventDefault={handleTouchMove}
      on:touchend|preventDefault={handlePressEnd}
      on:touchcancel={handleTouchCancel}
      on:click|preventDefault={handleZapIconClick}
      on:contextmenu|preventDefault={() => { if (onZapClick) onZapClick(); }}
      disabled={isZapping}
      title={canOneTapZap() ? `Zap ${getOneTapAmount()} sats (hold for custom amount)` : 'Send a zap'}
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
