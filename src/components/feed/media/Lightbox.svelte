<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { portal } from '../../Modal.svelte';
  import {
    lightbox,
    closeLightbox,
    lightboxNext,
    lightboxPrev
  } from '$lib/feed/media/lightboxStore';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeft';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';

  let portalTarget: HTMLElement | null = null;
  let scrollLockY = 0;

  // Touch / swipe state.
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isDragging = false;
  /** Horizontal pixel offset applied to the filmstrip during a drag
   * (and during animate-out). Zero when idle. */
  let dragX = 0;
  /** True while a programmatic slide is in flight (after touch release
   * or keyboard / button nav). Suppresses additional touch input. */
  let isAnimating = false;
  /** Skip the next CSS transition for one frame — used right after
   * the index swap so resetting dragX to 0 doesn't visually slide. */
  let noTransition = false;
  /** Strip slot width, set from the viewport on mount + resize. */
  let stripWidth = 0;

  /** Distance (px) past which a regular swipe triggers nav. */
  const SWIPE_DISTANCE_THRESHOLD = 60;
  /** Velocity (px / ms) past which a *flick* triggers nav regardless
   * of distance. Tuned for natural feel — a casual short flick (~25px
   * over 50ms = 0.5 px/ms) crosses; a slow drag does not. */
  const FLICK_VELOCITY_THRESHOLD = 0.45;
  /** Vertical pixel threshold for swipe-down-to-dismiss. */
  const DISMISS_THRESHOLD = 100;
  /** Slide animation duration. */
  const ANIM_MS = 240;
  /** Rubber-band resistance at the first/last image — fingers drag
   * the strip 30% of the natural distance to signal "no further". */
  const EDGE_RESISTANCE = 0.3;

  $: state = $lightbox;
  $: currentItem = state.items[state.index];
  $: prevItem = state.index > 0 ? state.items[state.index - 1] : null;
  $: nextItem = state.index < state.items.length - 1 ? state.items[state.index + 1] : null;
  $: isVideo = currentItem?.mime?.startsWith('video/') ?? false;
  $: hasPrev = prevItem !== null;
  $: hasNext = nextItem !== null;

  /** Strip transform: base offset centers the middle slot
   * (translateX = -stripWidth); dragX shifts it during interaction. */
  $: stripTransform = `translate3d(${-stripWidth + dragX}px, 0, 0)`;
  /** No transition while the user's finger is dragging (we want 1:1
   * response) or during the post-swap dragX reset (to avoid a visible
   * snap back). Idle / animate-out / animate-back uses the transition. */
  $: stripTransition = isDragging || noTransition ? 'none' : `transform ${ANIM_MS}ms ease-out`;

  onMount(() => {
    portalTarget = document.body;
    measureStrip();
    window.addEventListener('resize', measureStrip);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', measureStrip);
    }
    unlockScroll();
  });

  function measureStrip() {
    if (typeof window !== 'undefined') stripWidth = window.innerWidth;
  }

  // Body scroll lock when open, unlock when closed.
  $: if (typeof document !== 'undefined') {
    if (state.open) lockScroll();
    else unlockScroll();
  }

  function lockScroll() {
    if (document.body.dataset.lightboxLocked === '1') return;
    // The app scrolls inside #app-scroll, not the window (window.scrollY
    // is normally 0 here) — lock that container too, and restore its
    // position on unlock.
    scrollLockY = document.getElementById('app-scroll')?.scrollTop ?? window.scrollY;
    document.body.dataset.lightboxLocked = '1';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollLockY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    const scroller = document.getElementById('app-scroll');
    if (scroller) scroller.style.overflow = 'hidden';
  }

  function unlockScroll() {
    if (document.body.dataset.lightboxLocked !== '1') return;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    const scroller = document.getElementById('app-scroll');
    if (scroller) scroller.style.overflow = '';
    delete document.body.dataset.lightboxLocked;
    window.scrollTo(0, scrollLockY);
    if (scroller) scroller.scrollTop = scrollLockY;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!state.open || isAnimating) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
    } else if (e.key === 'ArrowLeft' && hasPrev) {
      e.preventDefault();
      animateTo('prev');
    } else if (e.key === 'ArrowRight' && hasNext) {
      e.preventDefault();
      animateTo('next');
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    // Click on the backdrop element itself (not bubbled up from
    // image / controls) closes the lightbox.
    if (e.target === e.currentTarget) closeLightbox();
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1 || isAnimating) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = performance.now();
    isDragging = true;
    dragX = 0;
  }

  function handleTouchMove(e: TouchEvent) {
    if (!isDragging || e.touches.length !== 1) return;
    let raw = e.touches[0].clientX - touchStartX;
    // Rubber-band at edges — finger still moves but the strip lags so
    // the user feels resistance instead of an abrupt wall.
    if (!hasPrev && raw > 0) raw *= EDGE_RESISTANCE;
    if (!hasNext && raw < 0) raw *= EDGE_RESISTANCE;
    dragX = raw;
  }

  function handleTouchEnd(e: TouchEvent) {
    if (!isDragging) return;
    isDragging = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const elapsed = Math.max(performance.now() - touchStartTime, 1);
    const velocity = Math.abs(dx) / elapsed; // px/ms

    // Vertical swipe-down dismisses if it dominates and crosses the
    // distance threshold.
    if (Math.abs(dy) > Math.abs(dx) && dy > DISMISS_THRESHOLD) {
      dragX = 0;
      closeLightbox();
      return;
    }

    const isFlick = velocity > FLICK_VELOCITY_THRESHOLD;
    const passesDistance = Math.abs(dx) > SWIPE_DISTANCE_THRESHOLD;
    const shouldNav = isFlick || passesDistance;

    if (shouldNav && dx > 0 && hasPrev) {
      animateTo('prev');
    } else if (shouldNav && dx < 0 && hasNext) {
      animateTo('next');
    } else {
      animateBack();
    }
  }

  /** Animate the strip back to its centered position — used when a
   * swipe didn't cross either threshold. */
  function animateBack() {
    isAnimating = true;
    dragX = 0;
    window.setTimeout(() => {
      isAnimating = false;
    }, ANIM_MS);
  }

  /** Animate the strip toward an adjacent slot, then swap the store
   * index and instantly recentre. The `noTransition` flag suppresses
   * the CSS transition for the recentre so the strip doesn't slide
   * back to centre — it teleports there with the new neighbour in
   * place, making the swap invisible. */
  async function animateTo(dir: 'prev' | 'next') {
    if (dir === 'prev' && !hasPrev) return;
    if (dir === 'next' && !hasNext) return;
    isAnimating = true;
    dragX = dir === 'prev' ? stripWidth : -stripWidth;
    window.setTimeout(async () => {
      noTransition = true;
      if (dir === 'prev') lightboxPrev();
      else lightboxNext();
      dragX = 0;
      // Wait two ticks: one for Svelte to apply the index/dragX
      // updates, a second so the no-transition style applies before
      // we re-enable transitions. Without this, the browser sometimes
      // animates the dragX reset and the user sees a visible snap.
      await tick();
      requestAnimationFrame(() => {
        noTransition = false;
        isAnimating = false;
      });
    }, ANIM_MS);
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if state.open && portalTarget && currentItem}
  <div use:portal={portalTarget}>
    <!-- The backdrop is a role="dialog" container with a global Esc
         handler on svelte:window. The lint warnings about click /
         touch on a non-button element are intentional here: the
         backdrop's click closes the lightbox (a well-known pattern
         that doesn't have a button equivalent), and touch handlers
         power swipe gestures. -->
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      on:click={handleBackdropClick}
      on:touchstart={handleTouchStart}
      on:touchmove={handleTouchMove}
      on:touchend={handleTouchEnd}
      transition:fade={{ duration: 150 }}
    >
      <!-- Top bar: counter on the left, close on the right. -->
      <div class="lightbox-topbar">
        <div class="counter">
          {#if state.items.length > 1}
            <span aria-live="polite">{state.index + 1} / {state.items.length}</span>
          {/if}
        </div>
        <button
          type="button"
          class="icon-btn"
          aria-label="Close media viewer"
          on:click={closeLightbox}
        >
          <CloseIcon size={28} weight="bold" />
        </button>
      </div>

      <!-- Filmstrip: three slots (prev / current / next), each one
           viewport wide. The strip is translated by -stripWidth so
           the middle slot sits centred; swipe / animate-to shifts
           dragX to slide. -->
      <div
        class="lightbox-strip"
        style="transform: {stripTransform}; transition: {stripTransition}; width: {stripWidth *
          3}px;"
      >
        <div class="slot" style="width: {stripWidth}px;">
          {#if prevItem}
            {#if prevItem.mime.startsWith('video/')}
              <!-- preload="metadata" fetches the first frame so the
                   neighbour slot shows what's coming as the user
                   swipes, instead of a black tile. muted so the
                   browser will actually buffer the preview. -->
              <!-- svelte-ignore a11y-media-has-caption -->
              <video
                class="lightbox-media"
                src={prevItem.url}
                preload="metadata"
                muted
                playsinline
              ></video>
            {:else}
              <img class="lightbox-media" src={prevItem.url} alt={prevItem.alt ?? ''} />
            {/if}
          {/if}
        </div>
        <!-- {#key} forces the current slot to remount whenever the
             item URL changes. Otherwise navigating video → video
             would just update the existing <video>'s src attribute,
             which doesn't refire `autoplay`, and the new video would
             sit paused on its first frame until the user tapped play. -->
        {#key currentItem.url}
          <div class="slot" style="width: {stripWidth}px;">
            {#if isVideo}
              <!-- muted is required for autoplay to work in Chrome,
                   Safari, and Firefox post-2018. controls let the
                   user unmute if they want sound. -->
              <!-- svelte-ignore a11y-media-has-caption -->
              <video
                class="lightbox-media"
                src={currentItem.url}
                controls
                autoplay
                muted
                playsinline
              ></video>
            {:else}
              <img class="lightbox-media" src={currentItem.url} alt={currentItem.alt ?? ''} />
            {/if}
          </div>
        {/key}
        <div class="slot" style="width: {stripWidth}px;">
          {#if nextItem}
            {#if nextItem.mime.startsWith('video/')}
              <!-- svelte-ignore a11y-media-has-caption -->
              <video
                class="lightbox-media"
                src={nextItem.url}
                preload="metadata"
                muted
                playsinline
              ></video>
            {:else}
              <img class="lightbox-media" src={nextItem.url} alt={nextItem.alt ?? ''} />
            {/if}
          {/if}
        </div>
      </div>

      <!-- Prev / next: hidden on touch-only contexts via @media hover. -->
      {#if hasPrev}
        <button
          type="button"
          class="nav-btn nav-prev"
          aria-label="Previous"
          on:click={() => animateTo('prev')}
        >
          <CaretLeftIcon size={32} weight="bold" />
        </button>
      {/if}
      {#if hasNext}
        <button
          type="button"
          class="nav-btn nav-next"
          aria-label="Next"
          on:click={() => animateTo('next')}
        >
          <CaretRightIcon size={32} weight="bold" />
        </button>
      {/if}

      {#if currentItem.alt}
        <div class="caption" aria-hidden="true">{currentItem.alt}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .lightbox-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background-color: rgba(0, 0, 0, 0.94);
    /* The strip overflows by design; clip it at the backdrop. */
    overflow: hidden;
    /* iOS rubber-band would scroll the page beneath even with our
       body-fixed lock when fingers pull at edges. */
    overscroll-behavior: contain;
    /* touch-action: none stops the browser from interpreting our
       horizontal swipes as page scroll / back-nav gestures. */
    touch-action: none;
  }
  .lightbox-topbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: max(0.5rem, env(safe-area-inset-top, 0)) 0.75rem 0.5rem;
    z-index: 2;
  }
  .counter {
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.875rem;
    font-weight: 500;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    background-color: rgba(0, 0, 0, 0.4);
    min-height: 1.75rem;
    display: flex;
    align-items: center;
  }
  .icon-btn {
    background: rgba(0, 0, 0, 0.4);
    border: none;
    color: rgba(255, 255, 255, 0.95);
    cursor: pointer;
    border-radius: 9999px;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s;
  }
  .icon-btn:hover,
  .icon-btn:focus-visible {
    background-color: rgba(255, 255, 255, 0.12);
  }
  .icon-btn:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .lightbox-strip {
    position: absolute;
    inset: 0;
    display: flex;
    will-change: transform;
  }
  .slot {
    flex: 0 0 auto;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .lightbox-media {
    /* Fill the slot, then object-fit: contain scales the media to
       its largest fitting size while preserving aspect (letterbox
       where needed). Without explicit width/height the browser
       renders <video> at intrinsic size (e.g. 1280x720) inside a
       much larger slot — the "video at a fraction of the screen"
       bug. width/height: 100% is what unlocks contain. */
    width: 100%;
    height: 100%;
    object-fit: contain;
    user-select: none;
    -webkit-user-drag: none;
    touch-action: pinch-zoom;
  }
  .nav-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0, 0, 0, 0.4);
    border: none;
    color: rgba(255, 255, 255, 0.95);
    cursor: pointer;
    border-radius: 9999px;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s;
    z-index: 2;
  }
  .nav-btn:hover,
  .nav-btn:focus-visible {
    background-color: rgba(255, 255, 255, 0.12);
  }
  .nav-btn:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .nav-prev {
    left: 0.75rem;
  }
  .nav-next {
    right: 0.75rem;
  }
  .caption {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 0.75rem 1rem max(0.75rem, env(safe-area-inset-bottom, 0));
    color: rgba(255, 255, 255, 0.92);
    font-size: 0.875rem;
    text-align: center;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0));
    pointer-events: none;
    z-index: 2;
  }
  /* Hide prev/next chevrons on coarse-pointer devices (phones,
     tablets) where swipe is the primary navigation. They stay on
     hover-capable devices (desktop, trackpad-paired tablets). */
  @media (hover: none) {
    .nav-btn {
      display: none;
    }
  }
  /* Reduce-motion users get instant transitions instead of slides. */
  @media (prefers-reduced-motion: reduce) {
    .lightbox-strip {
      transition: none !important;
    }
  }
</style>
