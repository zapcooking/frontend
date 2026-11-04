<script lang="ts">
  /**
   * PlatedStamp — the cook's just-published photo on a plate with a
   * "PLATED" stamp, for a moment after a successful publish. Purely
   * decorative: hidden from assistive tech (the "Plated!" toast is the
   * announcement), click-through, and gone in under 1.5 s. Reduced motion
   * shows the finished, stamped plate without animating. Mounted only from
   * the post-publish callback, so it can never appear before success; a
   * photo that fails (or is slow) to load skips it.
   */
  import { onDestroy } from 'svelte';
  import { optimizeImageUrl } from '$lib/imageOptimizer';
  import { PLATED_COPY } from '$lib/plated/copy';
  import { PLATED_STAMP_MS, platedStampTimer } from '$lib/plated/stamp';

  export let photo: string;
  export let onDone: () => void;

  let showing = false;
  const timer = platedStampTimer(
    () => (showing = true),
    () => onDone()
  );

  onDestroy(() => timer.cancel());
</script>

<div
  class="plated-stamp"
  class:showing
  style="--stamp-ms: {PLATED_STAMP_MS}ms"
  aria-hidden="true"
  data-testid="plated-stamp"
>
  <div class="plate">
    <img
      src={optimizeImageUrl(photo, { width: 400 })}
      alt=""
      width="200"
      height="200"
      decoding="async"
      on:load={timer.loaded}
      on:error={timer.failed}
    />
    <span class="stamp">{PLATED_COPY.stamp}</span>
  </div>
</div>

<style>
  .plated-stamp {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    /* Laid out (so the photo loads) but invisible until it has. */
    visibility: hidden;
  }

  .plated-stamp.showing {
    visibility: visible;
    animation: plated-stamp-life var(--stamp-ms) ease-out both;
  }

  .plate {
    position: relative;
    width: 200px;
    height: 200px;
    border-radius: 9999px;
    padding: 12px;
    background: var(--color-bg-primary);
    box-shadow:
      inset 0 0 0 1px var(--color-input-border),
      0 12px 40px rgba(0, 0, 0, 0.28);
  }

  .plate img {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 9999px;
    object-fit: cover;
    box-shadow: 0 0 0 1px var(--color-input-border);
  }

  /* Lower right, clear of the middle of the dish. */
  .stamp {
    position: absolute;
    right: -10px;
    bottom: 18px;
    padding: 4px 10px;
    border: 3px solid var(--color-primary);
    border-radius: 6px;
    background: color-mix(in srgb, var(--color-bg-primary) 88%, transparent);
    color: var(--color-primary);
    font-size: 1.125rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    line-height: 1.2;
    transform: rotate(-8deg);
  }

  .showing .stamp {
    animation: plated-stamp-press var(--stamp-ms) ease-out both;
  }

  /* Plate settles in, holds, fades. */
  @keyframes plated-stamp-life {
    0% {
      opacity: 0;
      transform: scale(0.92);
    }
    16% {
      opacity: 1;
      transform: scale(1);
    }
    78% {
      opacity: 1;
      transform: scale(1);
    }
    100% {
      opacity: 0;
      transform: scale(1);
    }
  }

  /* The stamp comes down just after the plate lands. */
  @keyframes plated-stamp-press {
    0%,
    20% {
      opacity: 0;
      transform: rotate(-8deg) scale(1.6);
    }
    32% {
      opacity: 1;
      transform: rotate(-8deg) scale(0.96);
    }
    38%,
    100% {
      opacity: 1;
      transform: rotate(-8deg) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .plated-stamp.showing,
    .showing .stamp {
      animation: none;
    }
  }
</style>
