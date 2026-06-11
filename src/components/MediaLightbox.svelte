<script lang="ts">
  /**
   * Fullscreen image lightbox with real swipe motion. The previous,
   * current and next images render side-by-side on a sliding track —
   * a swipe drags the track 1:1 with the pointer and committing
   * animates the neighbour into place (instead of swapping the src in
   * place, which reads as a laggy jump and only starts loading the
   * next image on arrival). Side panes double as a preload of the
   * adjacent images.
   *
   * Chrome (counter / close / arrows) is pinned to the backdrop
   * gutters, outside the photo frame. Navigation wraps around.
   */
  import { tick, onDestroy } from 'svelte';

  export let images: string[] = [];
  export let index = 0;
  export let onClose: () => void = () => {};

  $: count = images.length;
  $: prevIndex = (index - 1 + count) % count;
  $: nextIndex = (index + 1) % count;
  $: multiple = count > 1;

  let stageEl: HTMLDivElement;
  let trackEl: HTMLDivElement;

  const ENGAGE_PX = 8;
  const COMMIT_PX = 60;
  const SLIDE_MS = 220;

  let isPointerDown = false;
  let engaged = false;
  let suppressClick = false;
  let animating = false;
  let startX = 0;
  let startY = 0;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  function setTrack(x: number, transition: string) {
    if (!trackEl) return;
    trackEl.style.transition = transition;
    trackEl.style.transform = `translateX(${x}px)`;
  }

  /** dir 1 = advance to next (track slides left), -1 = back to prev. */
  function commit(dir: 1 | -1) {
    if (!multiple || animating || !stageEl) return;
    const width = stageEl.offsetWidth;
    if (!width) return;
    animating = true;
    setTrack(dir === 1 ? -width : width, `transform ${SLIDE_MS}ms ease-out`);
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(async () => {
      index = dir === 1 ? nextIndex : prevIndex;
      // Wait for the panes to re-render with the new neighbours before
      // resetting the track, so the swap is pixel-identical.
      await tick();
      setTrack(0, 'none');
      animating = false;
    }, SLIDE_MS + 20);
  }

  function snapBack() {
    setTrack(0, 'transform 200ms ease-out');
  }

  function handlePointerDown(e: PointerEvent) {
    if (!multiple || animating) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    isPointerDown = true;
    engaged = false;
    startX = e.clientX;
    startY = e.clientY;
    // No capture yet — a plain click must keep its original target so
    // tapping the backdrop still closes.
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isPointerDown) return;
    // Mouse button released where we couldn't see it — don't let the
    // armed state stick and resume on re-entry.
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) {
      release(e);
      return;
    }
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!engaged && Math.abs(dx) > ENGAGE_PX && Math.abs(dx) > Math.abs(dy)) {
      engaged = true;
      suppressClick = true;
      stageEl.setPointerCapture(e.pointerId);
    }
    if (engaged) setTrack(dx, 'none');
  }

  function release(e: PointerEvent) {
    if (!isPointerDown) return;
    isPointerDown = false;
    if (!engaged) return; // plain click — let it through untouched
    engaged = false;
    const dx = e.clientX - startX;
    if (dx <= -COMMIT_PX) commit(1);
    else if (dx >= COMMIT_PX) commit(-1);
    else snapBack();
  }

  // The browser fires a click after a drag — swallow it so finishing a
  // swipe doesn't close the lightbox.
  function handleClickCapture(e: MouseEvent) {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowLeft') commit(-1);
    else if (e.key === 'ArrowRight') commit(1);
  }

  onDestroy(() => {
    if (settleTimer) clearTimeout(settleTimer);
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
  <!-- Image stage — swipe / drag anywhere on it to page. Padded panes
       keep the photos clear of the chrome in the backdrop gutters. -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    bind:this={stageEl}
    class="absolute inset-0"
    style="touch-action: pan-y;"
    on:pointerdown={handlePointerDown}
    on:pointermove={handlePointerMove}
    on:pointerup={release}
    on:pointercancel={release}
    on:lostpointercapture={release}
    on:click|capture={handleClickCapture}
  >
    <div bind:this={trackEl} class="lightbox-track">
      {#if multiple}
        <div class="lightbox-pane pane-prev">
          <img src={images[prevIndex]} alt="" class="lightbox-image" draggable="false" />
        </div>
      {/if}
      <div class="lightbox-pane">
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
        <img
          src={images[index]}
          alt="Full size preview"
          class="lightbox-image"
          draggable="false"
          on:click|stopPropagation
        />
      </div>
      {#if multiple}
        <div class="lightbox-pane pane-next">
          <img src={images[nextIndex]} alt="" class="lightbox-image" draggable="false" />
        </div>
      {/if}
    </div>
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
    <button
      on:click|stopPropagation={() => commit(-1)}
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

    <button
      on:click|stopPropagation={() => commit(1)}
      class="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-10 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition"
      aria-label="Next image"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .lightbox-track {
    position: absolute;
    inset: 0;
    will-change: transform;
  }

  .lightbox-pane {
    position: absolute;
    inset: 0;
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
  .pane-prev {
    transform: translateX(-100%);
  }
  .pane-next {
    transform: translateX(100%);
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
