<script lang="ts">
  /**
   * The picture for a Go live stream that has no recipe photo: the Zap
   * Cooking logo on the brand background, "Live from Zap Cooking", and the
   * host's avatar small in the corner. Deliberately the same in light and
   * dark mode (it is a brand tile, like the share image it matches:
   * static/live-share.png). Fills its parent; the parent sets the shape.
   */
  import Avatar from '../Avatar.svelte';

  /** Host pubkey for the corner avatar; omitted, no avatar. */
  export let host: string | null = null;
  export let hostName = '';
</script>

<div class="live-art @container absolute inset-0 flex flex-col items-center justify-center">
  <img
    src="/zap_cooking_logo_white.svg"
    alt="Zap Cooking"
    class="live-art-logo h-auto select-none"
    draggable="false"
  />
  <p class="live-art-text mt-[4%] flex items-center gap-[0.5em] font-semibold text-white/90">
    <span class="live-art-dot inline-block rounded-full" aria-hidden="true"></span>
    Live from Zap Cooking
  </p>
  {#if host}
    <span class="absolute bottom-2 left-2 rounded-full ring-2 ring-white/80" title={hostName}>
      <Avatar pubkey={host} size={28} alt={hostName} interactive={false} />
    </span>
  {/if}
</div>

<style>
  .live-art {
    background:
      radial-gradient(120% 90% at 85% 110%, rgba(236, 71, 0, 0.45), transparent 60%),
      radial-gradient(80% 70% at 0% 0%, rgba(236, 71, 0, 0.16), transparent 55%), #111827;
  }
  .live-art-logo {
    width: 62%;
    max-width: 22rem;
  }
  .live-art-text {
    font-size: clamp(0.7rem, 5.2cqw, 1.35rem);
    letter-spacing: 0.01em;
  }
  .live-art-dot {
    width: 0.55em;
    height: 0.55em;
    background: #ef4444;
    box-shadow: 0 0 0 0.18em rgba(239, 68, 68, 0.3);
  }
</style>
