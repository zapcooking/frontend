<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { formatAmount } from '$lib/utils';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { getEngagementStore, fetchEngagement } from '$lib/engagementCache';
  import ZappersListModal from './ZappersListModal.svelte';
  import { canOneTapZap, sendOneTapZap, getOneTapAmount } from '$lib/oneTapZap';
  import CustomAvatar from './CustomAvatar.svelte';

  export let event: NDKEvent;
  export let onZapClick: (() => void) | undefined = undefined; // Callback for zap button click (fallback when one-tap not available)
  export let showPills: boolean = false; // Whether to show zapper pills (pill format with pfp + amount)
  export let maxPills: number = 3; // Maximum number of zapper pills to show
  export let onlyPills: boolean = false; // When true with showPills, render only the pills row (for layout above action icons)

  const store = getEngagementStore(event.id);
  let showZappersModal = false;
  let isZapping = false;

  // Sparkle burst on every successful self-zap. Triggered reactively
  // off $store.zaps.lastSelfZapAt, which markSelfZapCompleted (called
  // by the zap path on payment confirmation, NOT by the optimistic
  // update) bumps to Date.now(). Both one-tap and ZapModal paths fire
  // it after their respective payment success, so the burst happens at
  // the END of the zap regardless of which path was used.
  //
  // Numeric counter (vs boolean) keyed in the template so each burst
  // gets a fresh DOM tree and the CSS animation re-runs from frame 0.
  let sparkleBurstCount = 0;
  let prevLastSelfZapAt = $store.zaps.lastSelfZapAt;
  let sparkleTimer: ReturnType<typeof setTimeout> | null = null;

  function triggerSparkleBurst() {
    sparkleBurstCount += 1;
    if (sparkleTimer) clearTimeout(sparkleTimer);
    sparkleTimer = setTimeout(() => {
      sparkleBurstCount = 0;
    }, 1000);
  }

  $: {
    const current = $store.zaps.lastSelfZapAt;
    if (current && current !== prevLastSelfZapAt) {
      triggerSparkleBurst();
    }
    prevLastSelfZapAt = current;
  }

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
    if (sparkleTimer) {
      clearTimeout(sparkleTimer);
    }
  });

  function handleCountClick(e: MouseEvent) {
    e.stopPropagation(); // Prevent parent click handlers
    // Only open modal if there are zaps
    if ($store.zaps.count > 0) {
      showZappersModal = true;
    }
  }

  // Helper to safely check if event is a touch event (Safari on macOS doesn't have TouchEvent)
  function isTouchEvent(e: MouseEvent | TouchEvent): e is TouchEvent {
    return 'touches' in e;
  }

  // Start tracking press for long-press detection
  function handlePressStart(e: MouseEvent | TouchEvent) {
    e.stopPropagation();
    isLongPress = false;
    pressStartTime = Date.now();

    // Track touch position for mobile
    if (isTouchEvent(e) && e.touches.length > 0) {
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
    if (isTouchEvent(e) && !wasLongPress && touchStartPos !== null) {
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
        console.log('[NoteTotalZaps] One-tap zap completed successfully, amount:', result.amount);
        // Sparkle burst fires reactively via the lastSelfZapAt watcher
        // when markSelfZapCompleted (called inside sendOneTapZap on
        // confirmed payment) bumps the store. Single source of truth so
        // we don't fire twice.
        // Re-fetch engagement to pick up the real zap receipt from relays
        // (the optimistic update shows instantly, but this ensures the subscription
        // is active and will reconcile with the actual zap receipt)
        fetchEngagement($ndk, event.id, $userPublickey);
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

  // Derived values for pill display
  $: visibleZappers = showPills ? $store.zaps.topZappers.slice(0, maxPills) : [];
  $: hiddenCount = showPills ? Math.max(0, $store.zaps.topZappers.length - maxPills) : 0;
  $: totalSats = Math.floor($store.zaps.totalAmount / 1000);
</script>

{#if onlyPills && ($store.loading || $store.zaps.topZappers.length === 0)}
  <!-- Pills-only slot: nothing when loading or no zappers -->
{:else if $store.loading}
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
      on:contextmenu|preventDefault={() => {
        if (onZapClick) onZapClick();
      }}
      title={canOneTapZap()
        ? `Zap ${getOneTapAmount()} sats (hold for custom amount)`
        : 'Send a zap'}
    >
      <LightningIcon size={24} class="text-caption" weight="regular" />
    </button>
    <span class="text-caption opacity-0">0</span>
  </div>
{:else if onlyPills && showPills && $store.zaps.topZappers.length > 0}
  <!-- Pills-only row (one row only; +X at end shows remaining); contain horizontal scroll for Safari -->
  <div
    class="zap-pills-row flex flex-nowrap items-center gap-1.5 w-full min-w-0 overflow-x-auto overflow-y-hidden"
  >
    {#each visibleZappers as zapper (zapper.pubkey)}
      <button
        on:click|stopPropagation={handleCountClick}
        class="zap-pill flex items-center gap-1 h-6 pl-1 pr-2 rounded-full bg-accent-gray hover:bg-yellow-500/20 transition-colors cursor-pointer flex-shrink-0 {zapper.pubkey ===
        $userPublickey
          ? 'ring-1 ring-yellow-500'
          : ''}"
        title="{zapper.amount} sats"
      >
        <CustomAvatar pubkey={zapper.pubkey} size={18} className="rounded-full flex-shrink-0" />
        <LightningIcon size={12} class="text-yellow-500 flex-shrink-0" weight="fill" />
        <span class="text-xs text-caption font-semibold">{formatAmount(zapper.amount)}</span>
      </button>
    {/each}
    {#if hiddenCount > 0}
      <button
        on:click|stopPropagation={handleCountClick}
        class="zap-pill flex items-center gap-1 h-6 pl-1.5 pr-2 rounded-full bg-accent-gray hover:bg-yellow-500/20 text-caption text-xs font-semibold cursor-pointer transition-colors flex-shrink-0"
        title="{hiddenCount} more zappers ({formatAmount(totalSats)} sats total)"
      >
        <LightningIcon size={12} class="text-yellow-500 flex-shrink-0" weight="fill" />
        +{hiddenCount}
      </button>
    {/if}
  </div>
{:else if showPills && $store.zaps.topZappers.length > 0}
  <!-- Pill format: Lightning icon + pfp pills with amounts (inline, one row; +X at end); contain horizontal scroll for Safari -->
  <div
    class="zap-pills-row flex flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden"
  >
    <!-- Zap Button -->
    <button
      class="hover:bg-input rounded p-1 transition-colors select-none touch-none flex-shrink-0"
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
      on:contextmenu|preventDefault={() => {
        if (onZapClick) onZapClick();
      }}
      disabled={isZapping}
      title={canOneTapZap()
        ? `Zap ${getOneTapAmount()} sats (hold for custom amount)`
        : 'Send a zap'}
    >
      <!-- Instant feedback on tap: the bolt turns yellow + filled the
           moment isZapping flips (synchronous, before any await), so the
           user sees confirmation even before createZap finishes fetching
           the LNURL. Falls back to the persisted userZapped / totalSats
           state afterwards. -->
      <span class="bolt-sparkle-wrap">
        <LightningIcon
          size={18}
          class="{isZapping || totalSats > 0 ? 'text-yellow-500' : 'text-caption'} {isZapping
            ? 'animate-pulse'
            : ''}"
          weight={isZapping || $store.zaps.userZapped ? 'fill' : 'regular'}
        />
        {#if sparkleBurstCount > 0}
          {#key sparkleBurstCount}
            <span class="sparkle sparkle-0" aria-hidden="true"></span>
            <span class="sparkle sparkle-1" aria-hidden="true"></span>
            <span class="sparkle sparkle-2" aria-hidden="true"></span>
            <span class="sparkle sparkle-3" aria-hidden="true"></span>
            <span class="sparkle sparkle-4" aria-hidden="true"></span>
            <span class="sparkle sparkle-5" aria-hidden="true"></span>
          {/key}
        {/if}
      </span>
    </button>

    <!-- Zapper Pills -->
    {#each visibleZappers as zapper (zapper.pubkey)}
      <button
        on:click|stopPropagation={handleCountClick}
        class="zap-pill flex items-center gap-1 h-6 pl-1 pr-2 rounded-full bg-accent-gray hover:bg-yellow-500/20 transition-colors cursor-pointer flex-shrink-0 {zapper.pubkey ===
        $userPublickey
          ? 'ring-1 ring-yellow-500'
          : ''}"
        title="{zapper.amount} sats"
      >
        <CustomAvatar pubkey={zapper.pubkey} size={18} className="rounded-full flex-shrink-0" />
        <LightningIcon size={12} class="text-yellow-500 flex-shrink-0" weight="fill" />
        <span class="text-xs text-caption font-semibold">{formatAmount(zapper.amount)}</span>
      </button>
    {/each}

    <!-- Hidden count badge (+X pill) -->
    {#if hiddenCount > 0}
      <button
        on:click|stopPropagation={handleCountClick}
        class="zap-pill flex items-center gap-1 h-6 pl-1.5 pr-2 rounded-full bg-accent-gray hover:bg-yellow-500/20 text-caption text-xs font-semibold cursor-pointer transition-colors flex-shrink-0"
        title="{hiddenCount} more zappers ({formatAmount(totalSats)} sats total)"
      >
        <LightningIcon size={12} class="text-yellow-500 flex-shrink-0" weight="fill" />
        +{hiddenCount}
      </button>
    {/if}
  </div>
{:else}
  <!-- Default format: Lightning icon + count -->
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
      on:contextmenu|preventDefault={() => {
        if (onZapClick) onZapClick();
      }}
      disabled={isZapping}
      title={canOneTapZap()
        ? `Zap ${getOneTapAmount()} sats (hold for custom amount)`
        : 'Send a zap'}
    >
      <!-- Instant feedback on tap (see comment in the pill variant above). -->
      <span class="bolt-sparkle-wrap">
        <LightningIcon
          size={24}
          class="{isZapping || $store.zaps.totalAmount > 0
            ? 'text-yellow-500'
            : 'text-caption'} {isZapping ? 'animate-pulse' : ''}"
          weight={isZapping || $store.zaps.userZapped ? 'fill' : 'regular'}
        />
        {#if sparkleBurstCount > 0}
          {#key sparkleBurstCount}
            <span class="sparkle sparkle-0" aria-hidden="true"></span>
            <span class="sparkle sparkle-1" aria-hidden="true"></span>
            <span class="sparkle sparkle-2" aria-hidden="true"></span>
            <span class="sparkle sparkle-3" aria-hidden="true"></span>
            <span class="sparkle sparkle-4" aria-hidden="true"></span>
            <span class="sparkle sparkle-5" aria-hidden="true"></span>
          {/key}
        {/if}
      </span>
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

<style>
  .zap-pill {
    border: 1px solid rgba(245, 158, 11, 0.4);
    box-shadow: 0 0 10px rgba(245, 158, 11, 0.25);
  }

  /* Contain horizontal scroll so Safari doesn't pull the whole page sideways */
  .zap-pills-row {
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
  }

  /* Sparkle burst on zap-complete: 6 tiny dots emanate outward from the
     bolt center on a single 700 ms keyframe, fading and shrinking as
     they fly out. Each .sparkle-N sets its own (--tx, --ty) so the
     particles fan out in a hex-ish pattern. The wrap stays
     inline-flex/relative so the bolt's layout doesn't shift; pointer
     events are off on the sparkles so they never block taps.
     overflow: visible explicitly because the wrap's parent button is
     often inside a row with overflow-y-hidden (.zap-pills-row), which
     would otherwise clip particles that fly outside the row height. */
  .bolt-sparkle-wrap {
    position: relative;
    display: inline-flex;
    line-height: 0;
    overflow: visible;
  }
  .sparkle {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 6px;
    height: 6px;
    margin: -3px 0 0 -3px;
    background: #fbbf24;
    border-radius: 50%;
    pointer-events: none;
    /* High z-index so the burst paints on top of the icon and the
       surrounding pills row, not behind them. */
    z-index: 10;
    box-shadow:
      0 0 6px 1px rgba(251, 191, 36, 0.9),
      0 0 12px 2px rgba(249, 115, 22, 0.45);
    animation: bolt-sparkle 950ms ease-out forwards;
  }
  /* Magnitudes kept small enough vertically (≤ 10 px) that the burst
     fits inside a .zap-pills-row's overflow-y: hidden window without
     clipping. Horizontal range is wider since the surrounding flex row
     is overflow-x: auto and can scroll. */
  .sparkle-0 { --tx: 18px;  --ty: 0px; }
  .sparkle-1 { --tx: 12px;  --ty: -9px; }
  .sparkle-2 { --tx: -3px;  --ty: -10px; }
  .sparkle-3 { --tx: -18px; --ty: -2px; }
  .sparkle-4 { --tx: -11px; --ty: 8px; animation-delay: 40ms; }
  .sparkle-5 { --tx: 4px;   --ty: 10px; animation-delay: 70ms; }
  @keyframes bolt-sparkle {
    0% {
      transform: translate(0, 0) scale(0.5);
      opacity: 0;
    }
    8% {
      transform: translate(calc(var(--tx) * 0.15), calc(var(--ty) * 0.15)) scale(1.3);
      opacity: 1;
    }
    65% {
      transform: translate(calc(var(--tx) * 0.85), calc(var(--ty) * 0.85)) scale(0.95);
      opacity: 1;
    }
    100% {
      transform: translate(var(--tx), var(--ty)) scale(0.2);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sparkle {
      animation: none;
      display: none;
    }
  }
</style>
