<script lang="ts" context="module">
  import { blurhashToDataUrl } from '$lib/feed/blurhash';

  /** Memoize blurhash → data URL across all tile instances. The decode
   * is sync and ~3ms on a 32x32 canvas, but repeating it for every
   * remount when a tile scrolls back into view is wasteful. */
  const blurhashCache = new Map<string, string | null>();

  function getBlurhashUrl(hash: string | undefined | null): string | null {
    if (!hash) return null;
    if (blurhashCache.has(hash)) return blurhashCache.get(hash) ?? null;
    const url = blurhashToDataUrl(hash);
    blurhashCache.set(hash, url);
    return url;
  }
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { MediaItem } from '$lib/feed/types';

  export let item: MediaItem;
  /** Override the tile's aspect ratio. Galleries with fixed layouts
   * (2x2, 1 large + 2 small) pass `1` or another constant so all tiles
   * line up regardless of source image dimensions. When omitted we
   * fall back to `item.dim` (kills CLS) and finally `1` (square). */
  export let aspectRatio: number | undefined = undefined;
  /** `eager` only for the very first tile of a hero (single-image)
   * gallery. Everything else uses `lazy`. */
  export let loading: 'eager' | 'lazy' = 'lazy';
  /** Show a "+N more" overlay on top of the image. Used by 5+ image
   * galleries on the 4th tile. */
  export let overflowCount: number | null = null;
  /** Border-radius variant. The MediaGallery passes "tl", "tr", "bl",
   * "br", "all", or "none" so the outer corners of the grid stay
   * rounded but inner edges are flush. */
  export let corner: 'all' | 'tl' | 'tr' | 'bl' | 'br' | 'none' = 'all';

  const dispatch = createEventDispatcher<{ open: void }>();

  $: ratio = aspectRatio ?? (item.dim ? item.dim.w / item.dim.h : 1);
  $: blurhashUrl = getBlurhashUrl(item.blurhash);
  $: isVideo = item.mime.startsWith('video/');

  let mediaLoaded = false;
  let mediaErrored = false;
  let fallbackIndex = -1;
  // Poster failures are handled separately from the media URL chain: the
  // poster <img> shares this component with the image branch, but a bad
  // poster must fall straight to the empty tile, not consume one of the
  // video URL's fallbacks (which would only change currentUrl, never the
  // poster src — the error would loop with nowhere to go).
  let posterErrored = false;

  $: currentUrl = (() => {
    if (fallbackIndex < 0) return item.url;
    return item.fallback?.[fallbackIndex] ?? item.url;
  })();

  function handleLoaded() {
    mediaLoaded = true;
    mediaErrored = false;
  }

  function handleError() {
    const next = fallbackIndex + 1;
    if (item.fallback && next < item.fallback.length) {
      fallbackIndex = next;
      mediaLoaded = false;
      return;
    }
    mediaErrored = true;
    mediaLoaded = true; // stop showing the blurhash skeleton
  }

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    dispatch('open');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    dispatch('open');
  }
</script>

<!-- The tile is a button-styled div so screen readers announce the
     activation, but we don't use a real <button> because galleries
     nest these inside note cards that may themselves be clickable —
     a button inside a button breaks HTML semantics. -->
<div
  class="media-tile corner-{corner}"
  class:is-video={isVideo}
  class:has-overflow={overflowCount !== null}
  style="aspect-ratio: {ratio};{blurhashUrl
    ? ` background-image: url('${blurhashUrl}');`
    : ''}"
  role="button"
  tabindex="0"
  aria-label={item.alt || (isVideo ? 'Open video' : 'Open image')}
  on:click={handleClick}
  on:keydown={handleKeydown}
>
  {#if isVideo}
    <!-- For video items we render an <img> poster (not a <video>
         element) in the gallery — browsers render <video> frames
         inconsistently before media data loads, often showing the
         video at its intrinsic aspect inside the styled box. The
         poster <img> behaves identically to image tiles and the
         actual <video> only mounts in the Lightbox when the user
         taps in. Falls back to a plain bg-secondary tile when no
         poster URL is available. -->
    {#if item.poster && !posterErrored}
      <img
        class="media-element"
        class:is-loaded={mediaLoaded}
        src={item.poster}
        alt={item.alt ?? ''}
        {loading}
        decoding="async"
        on:load={handleLoaded}
        on:error={() => {
          posterErrored = true;
          mediaLoaded = true; // stop showing the blurhash skeleton
        }}
      />
    {/if}
    {#if !mediaErrored}
      <!-- Play badge: dark circular backdrop with a white triangle.
           Size scales with the tile via container-query units so the
           badge reads as a substantial play button at any cell
           size — full-width hero through a 2x2 grid cell. -->
      <div class="play-badge" aria-hidden="true">
        <svg
          class="play-glyph"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
    {/if}
  {:else}
    <img
      class="media-element"
      class:is-loaded={mediaLoaded}
      src={currentUrl}
      alt={item.alt ?? ''}
      {loading}
      decoding="async"
      on:load={handleLoaded}
      on:error={handleError}
    />
  {/if}

  {#if mediaErrored}
    <!-- Video and image error states render differently so a broken
         video tile reads as a video (play icon + label) rather than a
         bare alert that looks like a missing image. -->
    <div class="error-state" aria-hidden="true">
      {#if isVideo}
        <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
        <span class="error-label">Video unavailable</span>
      {:else}
        ⚠
      {/if}
    </div>
  {/if}

  {#if overflowCount !== null && overflowCount > 0}
    <div class="overflow-scrim" aria-hidden="true">
      <span class="overflow-count">+{overflowCount}</span>
    </div>
  {/if}
</div>

<style>
  .media-tile {
    position: relative;
    width: 100%;
    overflow: hidden;
    background-color: var(--color-bg-secondary);
    background-size: cover;
    background-position: center;
    cursor: pointer;
    /* The blurhash data URL is tiny (32x32) and looks chunky if not
       smoothed. Filter it slightly for a softer placeholder; the real
       image crossfades over the top. */
    isolation: isolate;
    /* Establish a container-query context so .play-badge can scale
       its width via `cqi` (container inline-size) units. */
    container-type: inline-size;
  }
  .media-tile.corner-all {
    border-radius: 0.75rem;
  }
  .media-tile.corner-tl {
    border-top-left-radius: 0.75rem;
  }
  .media-tile.corner-tr {
    border-top-right-radius: 0.75rem;
  }
  .media-tile.corner-bl {
    border-bottom-left-radius: 0.75rem;
  }
  .media-tile.corner-br {
    border-bottom-right-radius: 0.75rem;
  }
  .media-tile:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .media-element {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    /* display:block guards against browsers laying out <video> as an
       inline-replaced element with its intrinsic dimensions rather
       than the styled 100% box. */
    display: block;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.25s ease-out;
  }
  .media-element.is-loaded {
    opacity: 1;
  }
  .play-badge {
    position: absolute;
    /* Centered via 50% / translate so the badge stays put regardless
       of the tile size. */
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    /* Scale with the tile: 18% of the tile's smaller dimension,
       clamped to [40px, 88px]. Reads as a substantial play button at
       any cell size, from full-width hero to a 4-up grid cell. */
    width: clamp(40px, 18cqi, 88px);
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background-color: rgba(0, 0, 0, 0.55);
    color: rgba(255, 255, 255, 0.95);
    pointer-events: none;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
    /* Fallback width for browsers that don't support container query
       units (older Safari). cqi falls back to 0 so without this the
       badge would collapse; the clamp() above masks it for modern
       browsers and this explicit fallback covers the rest. */
  }
  .play-glyph {
    width: 50%;
    height: 50%;
    /* Nudge the triangle's optical center — geometric center of an
       equilateral play triangle sits slightly left of its bounding
       box. */
    margin-left: 6%;
  }
  .error-state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: var(--color-caption);
    font-size: 2rem;
    background-color: var(--color-bg-secondary);
  }
  .error-label {
    font-size: 0.75rem;
    letter-spacing: 0.02em;
  }
  .overflow-scrim {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.55);
    pointer-events: none;
  }
  .overflow-count {
    font-size: 1.75rem;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
  }
  /* Reduce-motion users skip the crossfade. The image still snaps in
     when loaded; no animation. */
  @media (prefers-reduced-motion: reduce) {
    .media-element {
      transition: none;
    }
  }
</style>
