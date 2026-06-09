<script lang="ts">
  /**
   * Cheffy in a round, theme-tinted badge — the avatar form used in
   * the conversation thread, the header card, and zap states.
   *
   * Animation is deliberately restrained and opt-in via `animate`:
   *  - thinking → a tiny hat bounce
   *  - cooking  → a gentle wobble + steam puff
   *  - excited  → a brief pop
   * All motion is disabled under `prefers-reduced-motion`.
   */
  import CheffyIcon, { type CheffyExpression } from './icons/CheffyIcon.svelte';

  export let size: number = 40;
  export let expression: CheffyExpression = 'neutral';
  /** Turn on the small idle/working motion tied to the expression. */
  export let animate: boolean = false;
  /** Accessible label; omit for decorative use (badge becomes aria-hidden). */
  export let title: string = '';
  let className = '';
  export { className as class };

  // Badge padding scales with the icon so the character never crowds
  // the ring.
  $: pad = Math.round(size * 0.18);
  $: box = size + pad * 2;
</script>

<span
  class={`cheffy-avatar ${className}`}
  class:animate
  class:is-thinking={animate && expression === 'thinking'}
  class:is-cooking={animate && expression === 'cooking'}
  class:is-excited={animate && expression === 'excited'}
  style={`width:${box}px;height:${box}px;`}
  aria-hidden={title ? undefined : 'true'}
>
  {#if animate && expression === 'cooking'}
    <span class="steam" aria-hidden="true">
      <i></i><i></i><i></i>
    </span>
  {/if}
  <CheffyIcon {size} {expression} {title} />
</span>

<style>
  .cheffy-avatar {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background-color: color-mix(in srgb, var(--color-primary) 14%, transparent);
    color: var(--color-primary);
    flex-shrink: 0;
  }

  /* ── Restrained motion ──────────────────────────────────── */
  .is-thinking :global(svg.cheffy-icon) {
    animation: cheffy-bounce 1.6s ease-in-out infinite;
    transform-origin: 50% 70%;
  }
  .is-cooking :global(svg.cheffy-icon) {
    animation: cheffy-wobble 2.2s ease-in-out infinite;
    transform-origin: 50% 80%;
  }
  .is-excited :global(svg.cheffy-icon) {
    animation: cheffy-pop 0.5s ease-out 1;
    transform-origin: 50% 80%;
  }

  @keyframes cheffy-bounce {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8%);
    }
  }
  @keyframes cheffy-wobble {
    0%,
    100% {
      transform: rotate(-3deg);
    }
    50% {
      transform: rotate(3deg);
    }
  }
  @keyframes cheffy-pop {
    0% {
      transform: scale(0.85);
    }
    60% {
      transform: scale(1.08);
    }
    100% {
      transform: scale(1);
    }
  }

  /* Steam puff for the cooking state */
  .steam {
    position: absolute;
    top: -18%;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 3px;
    pointer-events: none;
  }
  .steam i {
    width: 3px;
    height: 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary) 35%, transparent);
    animation: cheffy-steam 1.8s ease-in-out infinite;
  }
  .steam i:nth-child(2) {
    animation-delay: 0.3s;
  }
  .steam i:nth-child(3) {
    animation-delay: 0.6s;
  }

  @keyframes cheffy-steam {
    0% {
      opacity: 0;
      transform: translateY(4px) scaleY(0.6);
    }
    40% {
      opacity: 0.8;
    }
    100% {
      opacity: 0;
      transform: translateY(-6px) scaleY(1.1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .is-thinking :global(svg.cheffy-icon),
    .is-cooking :global(svg.cheffy-icon),
    .is-excited :global(svg.cheffy-icon) {
      animation: none;
    }
    .steam i {
      animation: none;
      opacity: 0.5;
    }
  }
</style>
