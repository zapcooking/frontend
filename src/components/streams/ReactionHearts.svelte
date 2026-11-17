<script lang="ts">
  /**
   * The floating reactions themselves: emoji that rise from the bottom
   * right corner of whatever they are laid over and fade out. Drawn the
   * same way for the viewer (StreamLikes) and the host (HostReactions).
   *
   * Takes no taps and makes no network calls; callers hand it reactions
   * with `spawn` (and the viewer's quiet "this exists" cue with
   * `spawnGhost`).
   */
  import { onDestroy } from 'svelte';
  import { REACTIONS, type ReactionId } from '$lib/streams/liveReactions';

  /** Where the hearts start, measured from the bottom of the layer. */
  export let bottom = '6.5rem';

  const MAX_LIVE_HEARTS = 36;
  /** Ghosts may stack a little (that's the burst) but never crowd a busy shower. */
  const GHOST_CROWD = 3;

  interface Heart {
    id: number;
    reaction: ReactionId;
    x: number;
    rise: number;
    drift: number;
    scale: number;
    duration: number;
    /** Ambient cue: ghosted, slower. */
    ghost?: boolean;
  }

  let hearts: Heart[] = [];
  let idCounter = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function add(heart: Heart, clearAfterMs: number) {
    hearts = [...hearts.slice(-(MAX_LIVE_HEARTS - 1)), heart];
    const timer = setTimeout(() => {
      timers.delete(timer);
      hearts = hearts.filter((h) => h.id !== heart.id);
    }, clearAfterMs);
    timers.add(timer);
  }

  /** A reaction floats up. */
  export function spawn(reaction: ReactionId) {
    add(
      {
        id: idCounter++,
        reaction,
        x: 8 + Math.random() * 40,
        rise: 150 + Math.random() * 110,
        drift: (Math.random() - 0.5) * 90,
        scale: 0.65 + Math.random() * 0.7,
        duration: 1.5 + Math.random() * 1.1
      },
      2700
    );
  }

  /** A ghosted heart leaks out, unless reactions are already flowing. */
  export function spawnGhost(reaction: ReactionId) {
    if (hearts.length >= GHOST_CROWD) return;
    const life = 2.6 + Math.random() * 1.2;
    add(
      {
        id: idCounter++,
        reaction,
        x: 8 + Math.random() * 36,
        rise: 100 + Math.random() * 60,
        drift: (Math.random() - 0.5) * 70,
        scale: 0.65 + Math.random() * 0.35,
        duration: life,
        ghost: true
      },
      // Clear on the heart's own clock, so short ghosts free the guard early.
      life * 1000 + 150
    );
  }

  onDestroy(() => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  });
</script>

<div class="like-hearts" aria-hidden="true">
  {#each hearts as heart (heart.id)}
    <span
      class="like-heart"
      class:like-heart--ghost={heart.ghost}
      style="right: {heart.x}px; bottom: {bottom}; --rise: -{Math.round(
        heart.rise
      )}px; --drift: {Math.round(heart.drift)}px; --scale: {heart.scale.toFixed(
        2
      )}; animation-duration: {heart.duration.toFixed(2)}s;"
    >
      <span class="like-emoji">{REACTIONS[heart.reaction].emoji}</span>
    </span>
  {/each}
</div>

<style>
  .like-hearts {
    position: absolute;
    inset: 0;
    z-index: 35;
    overflow: hidden;
    pointer-events: none;
  }
  .like-heart {
    position: absolute;
    /* Dark halo + light glow: readable on bright and dark video alike. */
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 6px rgba(255, 255, 255, 0.35));
    animation: like-rise ease-out forwards;
  }
  .like-emoji {
    font-size: 26px;
    line-height: 1;
  }
  .like-heart--ghost {
    animation-name: like-rise-ghost;
  }
  @keyframes like-rise-ghost {
    0% {
      transform: translate(0, 0) scale(calc(var(--scale) * 0.6));
      opacity: 0;
    }
    18% {
      opacity: 0.3;
    }
    100% {
      transform: translate(var(--drift), var(--rise)) scale(var(--scale));
      opacity: 0;
    }
  }
  @keyframes like-rise {
    0% {
      transform: translate(0, 0) scale(calc(var(--scale) * 0.6));
      opacity: 0;
    }
    8% {
      transform: translate(0, calc(var(--rise) * 0.12)) scale(var(--scale));
      opacity: 1;
    }
    78% {
      transform: translate(calc(var(--drift) * 0.8), calc(var(--rise) * 0.82)) scale(var(--scale));
      opacity: 1;
    }
    100% {
      transform: translate(var(--drift), var(--rise)) scale(calc(var(--scale) * 0.9));
      opacity: 0;
    }
  }
</style>
