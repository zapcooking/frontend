<script lang="ts">
  import type { MediaItem } from '$lib/feed/types';
  import MediaTile from './MediaTile.svelte';
  import { openLightbox } from '$lib/feed/media/lightboxStore';

  /** Media items to render, in source order. */
  export let items: MediaItem[];

  $: count = items.length;
  /** Layout key — drives the CSS grid template. The 5+ case shows the
   * first 3 images normally and a "+N more" overlay on the 4th tile. */
  $: layout = count === 1 ? 'one' : count === 2 ? 'two' : count === 3 ? 'three' : 'four-plus';
  /** Items that actually render. For the 5+ case we slice to 4. */
  $: visibleItems = count <= 4 ? items : items.slice(0, 4);
  /** "+N" overlay count for the 4th tile in the 5+ case. */
  $: overflowCount = count > 4 ? count - 4 : 0;
  /** Hero (single-image) aspect ratio. Locked to 1:1 so every gallery
   * — single image, 2 / 3 / 4+ image grids — presents tiles in the
   * same uniform square format. Images are cropped to fit via
   * object-fit: cover (set on .media-tile in MediaTile.svelte); the
   * full uncropped frame is one tap away in the Lightbox. This
   * matches the Instagram / Jumble feed convention and avoids the
   * "shrinks under max-height cap, letterboxes inside the column"
   * trap that variable aspects fall into for very tall portraits
   * or very wide panoramas. */
  $: heroAspect = count === 1 ? 1 : undefined;

  function open(index: number) {
    // Open the full media set (not visibleItems) so the user can swipe
    // through the hidden ones from the overflow tile.
    openLightbox(items, index);
  }
</script>

{#if count > 0}
  <div class="gallery layout-{layout}">
    {#if layout === 'one'}
      <!-- Single image: 1:1 square cropped to fit. The full uncropped
           frame is shown in the Lightbox on tap. Loading stays the tile's
           lazy default — this component also renders feed rows far below
           the viewport, and forcing eager here would fetch every
           one-image post on mount. The feed's first-paint hero passes
           its own eager flag down via the item, not through the gallery. -->
      <MediaTile
        item={visibleItems[0]}
        aspectRatio={heroAspect}
        corner="none"
        on:open={() => open(0)}
      />
    {:else if layout === 'two'}
      <!-- Side by side, each 1:1. Overall 2:1. -->
      {#each visibleItems as item, i (item.url + i)}
        <MediaTile {item} aspectRatio={1} corner="none" on:open={() => open(i)} />
      {/each}
    {:else if layout === 'three'}
      <!-- One large left, two stacked right. The three named grid areas
           let each tile fill its slot regardless of source aspect. -->
      <div class="tile-a">
        <MediaTile item={visibleItems[0]} corner="none" on:open={() => open(0)} />
      </div>
      <div class="tile-b">
        <MediaTile item={visibleItems[1]} corner="none" on:open={() => open(1)} />
      </div>
      <div class="tile-c">
        <MediaTile item={visibleItems[2]} corner="none" on:open={() => open(2)} />
      </div>
    {:else}
      <!-- Four or more: 2x2. Tile 3 (0-indexed) carries the overflow
           scrim when there are more than 4. -->
      {#each visibleItems as item, i (item.url + i)}
        <MediaTile
          {item}
          aspectRatio={1}
          corner="none"
          overflowCount={i === 3 && overflowCount > 0 ? overflowCount : null}
          on:open={() => open(i)}
        />
      {/each}
    {/if}
  </div>
{/if}

<style>
  .gallery {
    display: grid;
    gap: 2px;
    width: 100%;
    /* Outer rounding lives on the container so per-tile corner logic
       isn't needed. The 2px gap between tiles is transparent so it
       picks up whatever background the gallery sits on (feed card,
       note bg, page bg) and the seams visually disappear instead of
       drawing a fixed-color hairline. */
    border-radius: 0.75rem;
    overflow: hidden;
    background-color: transparent;
    isolation: isolate;
  }

  /* ──────────────────────────────────────────────────────────────────
     ONE — single square tile, locked 1:1 via heroAspect in the script.
     The tile itself crops to fit via object-fit: cover (MediaTile.svelte
     default); the Lightbox shows the full uncropped frame on tap.
     ────────────────────────────────────────────────────────────────── */
  .gallery.layout-one {
    grid-template-columns: 1fr;
  }

  /* ──────────────────────────────────────────────────────────────────
     TWO — two square tiles side by side, overall 2:1.
     ────────────────────────────────────────────────────────────────── */
  .gallery.layout-two {
    grid-template-columns: 1fr 1fr;
  }

  /* ──────────────────────────────────────────────────────────────────
     THREE — one large left, two stacked right.
     Each named area stretches its tile to fill the slot. Mobile (<420px)
     collapses to a single row of three squares for tappability.
     ────────────────────────────────────────────────────────────────── */
  .gallery.layout-three {
    grid-template-columns: 2fr 1fr;
    grid-template-rows: 1fr 1fr;
    grid-template-areas:
      'a b'
      'a c';
    aspect-ratio: 4 / 3;
  }
  .gallery.layout-three .tile-a {
    grid-area: a;
  }
  .gallery.layout-three .tile-b {
    grid-area: b;
  }
  .gallery.layout-three .tile-c {
    grid-area: c;
  }
  .gallery.layout-three .tile-a,
  .gallery.layout-three .tile-b,
  .gallery.layout-three .tile-c {
    display: flex;
    width: 100%;
    height: 100%;
  }
  /* Strip the inner MediaTile aspect-ratio so each cell stretches to
     fill its named area instead of imposing its own 1:1 / dim ratio. */
  .gallery.layout-three :global(.tile-a .media-tile),
  .gallery.layout-three :global(.tile-b .media-tile),
  .gallery.layout-three :global(.tile-c .media-tile) {
    aspect-ratio: auto !important;
    height: 100%;
  }

  @media (max-width: 420px) {
    .gallery.layout-three {
      grid-template-columns: 1fr 1fr 1fr;
      grid-template-rows: 1fr;
      grid-template-areas: 'a b c';
      aspect-ratio: 3 / 1;
    }
  }

  /* ──────────────────────────────────────────────────────────────────
     FOUR+ — 2x2 grid, each cell 1:1, overall 1:1.
     ────────────────────────────────────────────────────────────────── */
  .gallery.layout-four-plus {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    aspect-ratio: 1;
  }
</style>
