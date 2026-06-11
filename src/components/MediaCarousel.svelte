<script lang="ts">
  /**
   * Horizontal media carousel for posts with multiple inline images /
   * videos. Tiles take ~72% of the container width at a 4:5 aspect
   * with uniform height, 14px corners and a 6px gap, so the next tile
   * peeks in from the right edge — making it obvious there's more to
   * swipe without any chrome. Paging is native scroll-snap and the
   * indicator is a "current / total" capsule bottom-centre rather than
   * dots. Desktop gets hover-revealed chevrons plus mouse drag-to-swipe
   * since there's no touch gesture there.
   *
   * A single media item renders in a frame that shrink-wraps the
   * photo, with no carousel chrome.
   */
  import { onDestroy } from 'svelte';
  import VideoPreview from './VideoPreview.svelte';

  export let items: string[] = [];
  /** Called when an image tile is tapped (videos play inline). */
  export let onItemClick: (url: string, index: number) => void = () => {};
  /** Optional CDN/proxy rewrite applied to tile image sources. */
  export let optimizeUrl: (url: string) => string = (url) => url;

  // Matches the detection used by the feed/NoteContent extractors; any
  // non-video media URL is treated as an image.
  const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|avi|mkv|m4v)(\?.*)?$/i;

  function isVideo(url: string): boolean {
    try {
      return VIDEO_EXTENSIONS.test(new URL(url).pathname);
    } catch {
      return false;
    }
  }

  // 6px gap between tiles — keep in sync with the CSS `gap` below.
  const TILE_GAP_PX = 6;

  let scroller: HTMLDivElement;
  let currentIndex = 0;

  function tileStep(): number {
    const tile = scroller?.firstElementChild as HTMLElement | null;
    return tile ? tile.offsetWidth + TILE_GAP_PX : 0;
  }

  function handleScroll() {
    const step = tileStep();
    if (!step) return;
    currentIndex = Math.max(
      0,
      Math.min(items.length - 1, Math.round(scroller.scrollLeft / step))
    );
  }

  function scrollToIndex(index: number) {
    const step = tileStep();
    if (!step) return;
    scroller.scrollTo({ left: index * step, behavior: 'smooth' });
  }

  function handleImageError(e: Event) {
    const target = e.target as HTMLImageElement;
    if (target) target.style.display = 'none';
  }

  // ── Mouse drag-to-swipe ─────────────────────────────────────────
  // Native scroll containers only pan via touch / trackpad; a mouse
  // gets no swipe gesture. Translate mouse drags into scrollLeft so
  // desktop users can grab the gallery like on mobile. Touch input is
  // ignored here (native scrolling already handles it).
  let isPointerDown = false;
  let dragActive = false; // styling + snap state; true once threshold crossed
  let dragMoved = false; // suppresses the post-drag click
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartScrollLeft = 0;
  let dragStartIndex = 0;
  // Snap must stay off while we drag and while the release animation
  // runs — mandatory snap would fight both.
  let snapDisabled = false;
  let snapRestoreTimer: ReturnType<typeof setTimeout> | null = null;

  function handlePointerDown(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    isPointerDown = true;
    dragMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartScrollLeft = scroller.scrollLeft;
    dragStartIndex = currentIndex;
    // Deliberately NOT capturing the pointer here: capture (and the
    // drag styling) only engage once the move threshold is crossed,
    // otherwise a plain click would be retargeted away from the tile
    // button and never open the modal.
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isPointerDown) return;
    // The button was released somewhere we couldn't see it (e.g. the
    // pointerup landed outside the gallery before the drag engaged and
    // captured the pointer). Without this check the armed state sticks
    // and the next hover resumes "dragging" with no button pressed.
    if (!(e.buttons & 1)) {
      endDrag(e);
      return;
    }
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    // Engage only on a clearly horizontal pull — a click with a little
    // wobble (or a mostly-vertical movement) shouldn't grab the gallery.
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
    const step = tileStep();
    if (!step) return;

    const dx = e.clientX - dragStartX;
    const nearest = Math.round(scroller.scrollLeft / step);
    let target = nearest;
    // Flick: a short-but-decisive drag advances one tile in the drag
    // direction even if the nearest snap point is still the start.
    if (Math.abs(dx) > 40) {
      target =
        dx < 0 ? Math.max(dragStartIndex + 1, nearest) : Math.min(dragStartIndex - 1, nearest);
    }
    target = Math.max(0, Math.min(items.length - 1, target));

    // Keep snap off until the release animation settles, otherwise
    // mandatory snap jumps instantly and kills the smooth scroll.
    snapDisabled = true;
    scroller.scrollTo({ left: target * step, behavior: 'smooth' });
    if (snapRestoreTimer) clearTimeout(snapRestoreTimer);
    snapRestoreTimer = setTimeout(() => {
      snapDisabled = false;
    }, 350);
    currentIndex = target;
  }

  // After a drag the browser still fires a click on whatever's under
  // the cursor — swallow it (capture phase) so releasing a drag over a
  // tile doesn't open the image modal or toggle a video.
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

{#if items.length === 1}
  {#if isVideo(items[0])}
    <VideoPreview url={items[0]} />
  {:else}
    <button
      type="button"
      class="single-media-button"
      on:click={() => onItemClick(items[0], 0)}
    >
      <img
        src={optimizeUrl(items[0])}
        alt=""
        class="single-media-image"
        loading="lazy"
        decoding="async"
        draggable="false"
        on:error={handleImageError}
      />
    </button>
  {/if}
{:else if items.length > 1}
  <div class="relative group">
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      bind:this={scroller}
      class="media-carousel"
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
      {#each items as url, index}
        <div class="media-tile">
          {#if isVideo(url)}
            <VideoPreview {url} fill />
          {:else}
            <button
              type="button"
              class="tile-button"
              on:click={() => onItemClick(url, index)}
            >
              <img
                src={optimizeUrl(url)}
                alt=""
                loading="lazy"
                decoding="async"
                draggable="false"
                on:error={handleImageError}
              />
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Desktop chevrons — touch users swipe, so these only appear on
         hover-capable viewports and fade in when the gallery is
         hovered. -->
    {#if currentIndex > 0}
      <button
        type="button"
        class="carousel-arrow carousel-arrow--left"
        aria-label="Previous media"
        on:click={() => scrollToIndex(currentIndex - 1)}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
    {/if}
    {#if currentIndex < items.length - 1}
      <button
        type="button"
        class="carousel-arrow carousel-arrow--right"
        aria-label="Next media"
        on:click={() => scrollToIndex(currentIndex + 1)}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    {/if}

    <div class="count-badge" aria-hidden="true">
      {currentIndex + 1} / {items.length}
    </div>
  </div>
{/if}

<style>
  /* ── Single media item ───────────────────────────────────────────
     The frame shrink-wraps the image so the rounded box always matches
     the photo's own proportions — no letterbox / pillarbox bars. Very
     tall images cap at 70vh (and narrow accordingly); very wide ones
     cap at full width with a short box. Images smaller than the column
     render at natural size rather than upscaling. */
  .single-media-button {
    display: block;
    width: fit-content;
    max-width: 100%;
    border: none;
    padding: 0;
    background: transparent;
    border-radius: 14px;
    overflow: hidden;
    cursor: pointer;
  }
  .single-media-image {
    display: block;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 70vh;
    -webkit-user-drag: none;
    user-select: none;
    transition: opacity 0.15s ease-out;
  }
  .single-media-button:hover .single-media-image {
    opacity: 0.95;
  }

  /* ── Multi-item gallery ──────────────────────────────────────── */
  .media-carousel {
    display: flex;
    gap: 6px; /* keep in sync with TILE_GAP_PX */
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    /* Both directions allowed — the browser disambiguates the gesture,
       so vertical feed scrolling still works when the touch starts on
       a tile. */
    touch-action: pan-y pan-x;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .media-carousel::-webkit-scrollbar {
    display: none;
  }

  /* Mouse drag-to-swipe states. Snap is disabled during the drag and
     the release animation; while dragging, kill child pointer events
     so image hover/cursor styles don't flicker mid-drag. */
  @media (hover: hover) {
    .media-carousel {
      cursor: grab;
    }
  }
  .media-carousel.is-dragging {
    cursor: grabbing;
    user-select: none;
  }
  .media-carousel.is-dragging :global(*) {
    pointer-events: none;
  }
  .media-carousel.no-snap {
    scroll-snap-type: none;
  }

  .media-tile {
    /* ~72% of the container so the next tile peeks from the right
       edge, signalling there's more to swipe. */
    flex: 0 0 72%;
    aspect-ratio: 4 / 5;
    border-radius: 14px;
    overflow: hidden;
    scroll-snap-align: start;
    scroll-snap-stop: always;
    background: var(--color-input, #1f2937);
  }

  .tile-button {
    display: block;
    width: 100%;
    height: 100%;
    border: none;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }
  .tile-button img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-user-drag: none;
    transition: opacity 0.15s ease-out;
  }
  .tile-button:hover img {
    opacity: 0.95;
  }

  /* ── Count badge ("1 / 2" capsule, bottom-centre) ──────────────── */
  .count-badge {
    position: absolute;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 2px 10px;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.4);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.25rem;
    pointer-events: none;
    z-index: 10;
  }

  /* ── Desktop chevrons ────────────────────────────────────────── */
  .carousel-arrow {
    display: none;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    cursor: pointer;
    z-index: 10;
    opacity: 0;
    transition: opacity 0.15s ease-out, background-color 0.15s ease-out;
  }
  .carousel-arrow--left {
    left: 8px;
  }
  .carousel-arrow--right {
    right: 8px;
  }
  .carousel-arrow:hover {
    background: rgba(0, 0, 0, 0.7);
  }
  @media (hover: hover) and (min-width: 640px) {
    .carousel-arrow {
      display: flex;
    }
    .group:hover .carousel-arrow,
    .carousel-arrow:focus-visible {
      opacity: 1;
    }
  }
</style>
