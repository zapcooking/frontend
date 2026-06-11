<script lang="ts">
  /**
   * Fullscreen image lightbox. Paging uses the same mechanism as the
   * inline gallery — a native horizontal scroll-snap pager with one
   * full-screen pane per image — so touch swiping direction, momentum
   * and snap feel identical to the feed carousel by construction.
   * Offscreen panes double as a preload of neighbouring images.
   *
   * Desktop adds the gallery's mouse drag-to-swipe plus hover-style
   * chevrons; chrome (counter / close / arrows) is pinned to the
   * backdrop gutters, outside the photo frame.
   */
  import { onMount, onDestroy } from 'svelte';

  export let images: string[] = [];
  export let index = 0;
  export let onClose: () => void = () => {};

  $: count = images.length;
  $: multiple = count > 1;

  let scroller: HTMLDivElement;

  function paneWidth(): number {
    return scroller?.offsetWidth || 0;
  }

  onMount(() => {
    // Jump straight to the tapped image (no animation on open).
    const w = paneWidth();
    if (w && index > 0) scroller.scrollLeft = index * w;
  });

  function handleScroll() {
    const w = paneWidth();
    if (!w) return;
    index = Math.max(0, Math.min(count - 1, Math.round(scroller.scrollLeft / w)));
  }

  function scrollToIndex(i: number) {
    const w = paneWidth();
    if (!w) return;
    scroller.scrollTo({ left: i * w, behavior: 'smooth' });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowLeft' && index > 0) scrollToIndex(index - 1);
    else if (e.key === 'ArrowRight' && index < count - 1) scrollToIndex(index + 1);
  }

  // ── Mouse drag-to-swipe — same rules as the inline gallery ──────
  // Touch is handled natively by the scroller; these only run for a
  // mouse. Capture and drag styling engage after a clearly horizontal
  // 8px pull so plain clicks keep their original target.
  let isPointerDown = false;
  let dragActive = false;
  let dragMoved = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartScrollLeft = 0;
  let dragStartIndex = 0;
  let snapDisabled = false;
  let snapRestoreTimer: ReturnType<typeof setTimeout> | null = null;

  function handlePointerDown(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    isPointerDown = true;
    dragMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartScrollLeft = scroller.scrollLeft;
    dragStartIndex = index;
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isPointerDown) return;
    // Button released where we couldn't see it — don't let the armed
    // state stick and resume on re-entry.
    if (!(e.buttons & 1)) {
      endDrag(e);
      return;
    }
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (!dragMoved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      dragMoved = true;
      dragActive = true;
      scroller.setPointerCapture(e.pointerId);
    }
    if (dragMoved) scroller.scrollLeft = dragStartScrollLeft - dx;
  }

  function endDrag(e: PointerEvent) {
    if (!isPointerDown) return;
    isPointerDown = false;
    dragActive = false;
    if (!dragMoved) return; // plain click — let it through untouched
    const w = paneWidth();
    if (!w) return;

    const dx = e.clientX - dragStartX;
    const nearest = Math.round(scroller.scrollLeft / w);
    let target = nearest;
    // Flick: a short-but-decisive drag advances one pane in the drag
    // direction even if the nearest snap point is still the start.
    if (Math.abs(dx) > 40) {
      target =
        dx < 0 ? Math.max(dragStartIndex + 1, nearest) : Math.min(dragStartIndex - 1, nearest);
    }
    target = Math.max(0, Math.min(count - 1, target));

    // Keep snap off until the release animation settles, otherwise
    // mandatory snap jumps instantly and kills the smooth scroll.
    snapDisabled = true;
    scroller.scrollTo({ left: target * w, behavior: 'smooth' });
    if (snapRestoreTimer) clearTimeout(snapRestoreTimer);
    snapRestoreTimer = setTimeout(() => {
      snapDisabled = false;
    }, 350);
  }

  // The browser fires a click after a drag — swallow it so finishing a
  // swipe doesn't close the lightbox.
  function suppressClickAfterDrag(e: MouseEvent) {
    if (dragMoved) {
      e.stopPropagation();
      e.preventDefault();
      dragMoved = false;
    }
  }

  onDestroy(() => {
    if (snapRestoreTimer) clearTimeout(snapRestoreTimer);
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
<div
  class="fixed inset-0 z-50 bg-black/85 overflow-hidden"
  on:click={onClose}
  role="dialog"
  aria-modal="true"
>
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    bind:this={scroller}
    class="lightbox-scroller"
    class:is-dragging={dragActive}
    class:no-snap={dragActive || snapDisabled}
    on:scroll={handleScroll}
    on:pointerdown={handlePointerDown}
    on:pointermove={handlePointerMove}
    on:pointerup={endDrag}
    on:pointercancel={endDrag}
    on:lostpointercapture={endDrag}
    on:click|capture={suppressClickAfterDrag}
  >
    {#each images as url, i}
      <div class="lightbox-pane">
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
        <img
          src={url}
          alt={i === index ? 'Full size preview' : ''}
          class="lightbox-image"
          loading="lazy"
          draggable="false"
          on:click|stopPropagation
        />
      </div>
    {/each}
  </div>

  <!-- Close button -->
  <button
    class="absolute top-3 right-3 z-10 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition"
    on:click|stopPropagation={onClose}
    aria-label="Close image"
  >
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  </button>

  {#if multiple}
    <!-- Image counter -->
    <div
      class="absolute top-3 left-3 z-10 bg-black/60 text-white text-sm px-3 py-1.5 rounded-full"
    >
      {index + 1} / {count}
    </div>

    <!-- Previous / next — desktop only; touch users swipe -->
    {#if index > 0}
      <button
        on:click|stopPropagation={() => scrollToIndex(index - 1)}
        class="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-10 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition"
        aria-label="Previous image"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>
    {/if}

    {#if index < count - 1}
      <button
        on:click|stopPropagation={() => scrollToIndex(index + 1)}
        class="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-10 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition"
        aria-label="Next image"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    {/if}
  {/if}
</div>

<style>
  .lightbox-scroller {
    position: absolute;
    inset: 0;
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    touch-action: pan-y pan-x;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .lightbox-scroller::-webkit-scrollbar {
    display: none;
  }
  @media (hover: hover) {
    .lightbox-scroller {
      cursor: grab;
    }
  }
  .lightbox-scroller.is-dragging {
    cursor: grabbing;
    user-select: none;
  }
  .lightbox-scroller.is-dragging :global(*) {
    pointer-events: none;
  }
  .lightbox-scroller.no-snap {
    scroll-snap-type: none;
  }

  .lightbox-pane {
    flex: 0 0 100%;
    width: 100%;
    height: 100%;
    scroll-snap-align: center;
    scroll-snap-stop: always;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4rem 0.75rem;
  }
  @media (min-width: 640px) {
    .lightbox-pane {
      padding-left: 4rem;
      padding-right: 4rem;
    }
  }

  .lightbox-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 0.5rem;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    -webkit-user-drag: none;
    user-select: none;
  }
</style>
