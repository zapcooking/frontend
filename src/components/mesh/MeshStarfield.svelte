<script lang="ts">
  // CSS-only starfield — no JS, no canvas particles.
  // 3 layers of radial-gradient dots at different sizes.
  // Pure CSS transform animation for slow drift (120s/180s/240s cycles).
  // GPU-composited, effectively zero CPU cost.
</script>

<div class="starfield" aria-hidden="true">
  <div class="star-layer star-layer-1"></div>
  <div class="star-layer star-layer-2"></div>
  <div class="star-layer star-layer-3"></div>
</div>

<style>
  .starfield {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .star-layer {
    position: absolute;
    inset: -50%;
    width: 200%;
    height: 200%;
    will-change: transform;
  }

  /* Small stars (1px) */
  .star-layer-1 {
    background-image:
      radial-gradient(1px 1px at 10% 20%, rgba(220, 230, 255, 0.6), transparent),
      radial-gradient(1px 1px at 30% 65%, rgba(220, 230, 255, 0.5), transparent),
      radial-gradient(1px 1px at 55% 15%, rgba(220, 230, 255, 0.4), transparent),
      radial-gradient(1px 1px at 70% 45%, rgba(220, 230, 255, 0.55), transparent),
      radial-gradient(1px 1px at 85% 80%, rgba(220, 230, 255, 0.45), transparent),
      radial-gradient(1px 1px at 45% 90%, rgba(220, 230, 255, 0.5), transparent),
      radial-gradient(1px 1px at 15% 50%, rgba(220, 230, 255, 0.35), transparent),
      radial-gradient(1px 1px at 90% 25%, rgba(220, 230, 255, 0.4), transparent);
    background-size: 200px 200px;
    animation: drift-1 120s linear infinite;
  }

  /* Medium stars (1.5px) */
  .star-layer-2 {
    background-image:
      radial-gradient(1.5px 1.5px at 25% 35%, rgba(200, 220, 255, 0.5), transparent),
      radial-gradient(1.5px 1.5px at 60% 70%, rgba(200, 220, 255, 0.4), transparent),
      radial-gradient(1.5px 1.5px at 80% 20%, rgba(200, 220, 255, 0.45), transparent),
      radial-gradient(1.5px 1.5px at 40% 55%, rgba(200, 220, 255, 0.35), transparent),
      radial-gradient(1.5px 1.5px at 10% 85%, rgba(200, 220, 255, 0.5), transparent),
      radial-gradient(1.5px 1.5px at 95% 60%, rgba(200, 220, 255, 0.4), transparent);
    background-size: 300px 300px;
    animation: drift-2 180s linear infinite;
  }

  /* Large stars (2px) */
  .star-layer-3 {
    background-image:
      radial-gradient(2px 2px at 20% 50%, rgba(220, 230, 255, 0.6), transparent),
      radial-gradient(2px 2px at 50% 30%, rgba(220, 230, 255, 0.5), transparent),
      radial-gradient(2px 2px at 75% 75%, rgba(220, 230, 255, 0.55), transparent),
      radial-gradient(2px 2px at 35% 10%, rgba(220, 230, 255, 0.4), transparent);
    background-size: 400px 400px;
    animation: drift-3 240s linear infinite;
  }

  @keyframes drift-1 {
    from { transform: translate(0, 0); }
    to { transform: translate(-200px, -200px); }
  }

  @keyframes drift-2 {
    from { transform: translate(0, 0); }
    to { transform: translate(150px, -150px); }
  }

  @keyframes drift-3 {
    from { transform: translate(0, 0); }
    to { transform: translate(-100px, 100px); }
  }
</style>
