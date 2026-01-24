<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { browser } from '$app/environment';
  import { isIOS } from '$lib/platform';

  // Configuration
  export let threshold: number = 80; // Pull distance to trigger refresh
  export let maxPull: number = 120; // Maximum visual pull distance
  export let disabled: boolean = false;

  const dispatch = createEventDispatcher<{ refresh: void }>();

  // State
  let isPulling = false;
  let isRefreshing = false;
  let pullDistance = 0;
  let startY = 0;
  let currentY = 0;
  let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Store event handlers for cleanup
  let documentTouchMoveHandler: ((e: TouchEvent) => void) | null = null;

  // DOM refs
  let containerEl: HTMLElement;

  // Check if we're at the top of the scroll
  // Improved for iOS Capacitor compatibility
  function isAtTop(): boolean {
    // Check multiple scroll positions for better compatibility
    // iOS WebView may use documentElement or body instead of window
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const docScrollTop = document.documentElement.scrollTop || 0;
    const bodyScrollTop = document.body.scrollTop || 0;
    
    // If any of these indicate we're scrolled, we're not at top
    if (scrollY > 0 || docScrollTop > 0 || bodyScrollTop > 0) {
      return false;
    }
    
    // Also check if any scrollable parent has scrolled
    let el: HTMLElement | null = containerEl;
    while (el) {
      if (el.scrollTop > 0) return false;
      el = el.parentElement;
    }
    
    return true;
  }

  function handleTouchStart(e: TouchEvent) {
    if (disabled || isRefreshing) return;
    if (!isAtTop()) return;

    startY = e.touches[0].clientY;
    currentY = startY;
    isPulling = true;
  }

  function handleTouchMove(e: TouchEvent) {
    if (!isPulling || disabled || isRefreshing) return;

    currentY = e.touches[0].clientY;
    const delta = currentY - startY;

    // Check if we're still at top (re-check on each move for iOS)
    const stillAtTop = isAtTop();

    // Only track downward pulls when at top
    if (delta > 0 && stillAtTop) {
      // Apply resistance curve for natural feel
      // Use slightly less resistance on iOS for better feel
      const resistance = isIOS() ? 0.6 : 0.5;
      pullDistance = Math.min(maxPull, delta * resistance);
      
      // Prevent page bounce on iOS when pulling
      if (pullDistance > 10) {
        e.preventDefault();
        // Also prevent default on the event's target for iOS
        if (isIOS() && e.cancelable) {
          e.stopPropagation();
        }
      }
    } else {
      // Reset if scrolling up or not at top
      pullDistance = 0;
      isPulling = false;
    }
  }

  function handleTouchEnd() {
    if (!isPulling || disabled) return;

    if (pullDistance >= threshold && !isRefreshing) {
      // Trigger refresh
      triggerRefresh();
    } else {
      // Reset without refresh
      resetPull();
    }
    
    isPulling = false;
  }

  async function triggerRefresh() {
    isRefreshing = true;
    pullDistance = 60; // Hold at spinner position
    
    // Safety timeout - auto-complete after 15 seconds to prevent stuck spinner
    refreshTimeout = setTimeout(() => {
      if (isRefreshing) {
        console.warn('[PullToRefresh] Safety timeout triggered after 15s');
        complete();
      }
    }, 15000);
    
    dispatch('refresh');
  }

  // Called by parent when refresh is complete
  export function complete() {
    // Clear safety timeout
    if (refreshTimeout) {
      clearTimeout(refreshTimeout);
      refreshTimeout = null;
    }
    isRefreshing = false;
    resetPull();
  }

  function resetPull() {
    pullDistance = 0;
    startY = 0;
    currentY = 0;
  }

  // Calculate visual transform
  $: transform = pullDistance > 0 ? `translateY(${pullDistance}px)` : '';
  $: spinnerOpacity = Math.min(1, pullDistance / threshold);
  $: spinnerScale = Math.min(1, 0.5 + (pullDistance / threshold) * 0.5);
  $: isTriggered = pullDistance >= threshold;

  onMount(() => {
    if (!browser) return;
    
    // For iOS Capacitor, we need to attach listeners more aggressively
    // Add listeners to both container and window/document for better iOS support
    documentTouchMoveHandler = (e: TouchEvent) => {
      // Only handle if we're pulling
      if (isPulling) {
        handleTouchMove(e);
      }
    };
    
    // Use capture phase on iOS for better event handling
    const options = { passive: false, capture: isIOS() };
    
    containerEl?.addEventListener('touchmove', handleTouchMove as any, options);
    
    // Also listen on document for iOS WebView edge cases
    if (isIOS() && documentTouchMoveHandler) {
      document.addEventListener('touchmove', documentTouchMoveHandler, options);
    }
  });

  onDestroy(() => {
    if (!browser) return;
    
    containerEl?.removeEventListener('touchmove', handleTouchMove as any);
    
    // Clean up document listener for iOS
    if (isIOS() && documentTouchMoveHandler) {
      const options = { passive: false, capture: true };
      document.removeEventListener('touchmove', documentTouchMoveHandler, options);
      documentTouchMoveHandler = null;
    }
    
    // Clean up any pending timeout
    if (refreshTimeout) {
      clearTimeout(refreshTimeout);
      refreshTimeout = null;
    }
  });
</script>

<div 
  class="pull-to-refresh-container"
  bind:this={containerEl}
  on:touchstart={handleTouchStart}
  on:touchend={handleTouchEnd}
  on:touchcancel={handleTouchEnd}
>
  <!-- Pull indicator -->
  <div 
    class="pull-indicator"
    style="
      opacity: {spinnerOpacity};
      /* Keep centered: include translateX(-50%) even when scaling */
      transform: translateX(-50%) scale({spinnerScale}) translateY({Math.max(0, pullDistance - 40)}px);
    "
    class:triggered={isTriggered}
    class:refreshing={isRefreshing}
  >
    <div class="spinner" class:spinning={isRefreshing || isTriggered}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        {#if isRefreshing}
          <!-- Spinning loader -->
          <circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10" />
        {:else}
          <!-- Arrow down icon -->
          <path d="M12 5v14M5 12l7 7 7-7" stroke-linecap="round" stroke-linejoin="round" />
        {/if}
      </svg>
    </div>
    {#if isRefreshing}
      <span class="refresh-text">Refreshing...</span>
    {:else if isTriggered}
      <span class="refresh-text">Release to refresh</span>
    {:else if pullDistance > 20}
      <span class="refresh-text">Pull to refresh</span>
    {/if}
  </div>

  <!-- Content with transform -->
  <div 
    class="pull-content"
    style="transform: {transform}; transition: {isPulling ? 'none' : 'transform 0.3s ease-out'};"
  >
    <slot />
  </div>
</div>

<style>
  .pull-to-refresh-container {
    position: relative;
    min-height: 100%;
    /* Allow vertical scrolling but prevent horizontal and zoom */
    touch-action: pan-y;
    /* Improve scrolling on iOS */
    -webkit-overflow-scrolling: touch;
    /* Prevent iOS bounce when at top */
    overscroll-behavior-y: contain;
  }

  .pull-indicator {
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 60px);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 100;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }

  .spinner {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-primary, white);
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    color: var(--color-primary, #EC4700);
  }

  .spinner svg {
    width: 20px;
    height: 20px;
  }

  .spinner.spinning svg {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .refresh-text {
    font-size: 12px;
    font-weight: 500;
    color: var(--color-caption, #6b7280);
    background: var(--color-bg-primary, white);
    padding: 4px 12px;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    white-space: nowrap;
  }

  .pull-content {
    will-change: transform;
  }

  /* Triggered state */
  .pull-indicator.triggered .spinner {
    background: var(--color-primary, #EC4700);
    color: white;
  }

  .pull-indicator.refreshing .spinner {
    background: var(--color-primary, #EC4700);
    color: white;
  }
</style>

