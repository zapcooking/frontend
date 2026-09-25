<script lang="ts">
  /**
   * Floating progress for a mine in flight.
   *
   * Sits where the pending-publish pill sits and borrows its chrome, since
   * it means the same kind of thing: work continuing somewhere that isn't
   * the thing you're looking at. Unlike that pill this one takes clicks —
   * the Stop button is the whole reason it can be left running.
   *
   * It PULSES rather than spins. Every hash attempt is independent of the
   * last, so a sweep or a fill would imply progress toward a finish that
   * does not exist — a lie about the one thing the reader is judging. The
   * numbers carry the information: seconds elapsed, and the best difficulty
   * reached so far.
   */
  import { onDestroy } from 'svelte';
  import { fly } from 'svelte/transition';
  import HammerIcon from 'phosphor-svelte/lib/Hammer';
  import { miningOp } from '$lib/stores/miningOp';

  let elapsed = 0;
  let clock: ReturnType<typeof setInterval> | null = null;

  // Its own clock: worker reports arrive per block of attempts and can be
  // seconds apart on a slow machine, so a pill that only moved when they
  // landed would read as frozen at exactly the difficulty where the reader
  // most needs to see it is alive.
  $: if ($miningOp && !clock) {
    elapsed = 0;
    clock = setInterval(() => {
      if ($miningOp) elapsed = Math.round((Date.now() - $miningOp.startedAt) / 1000);
    }, 1000);
  } else if (!$miningOp && clock) {
    clearInterval(clock);
    clock = null;
  }

  onDestroy(() => {
    if (clock) clearInterval(clock);
  });
</script>

{#if $miningOp}
  <div class="mining-indicator" transition:fly={{ y: 12, duration: 180 }} role="status">
    <HammerIcon size={16} weight="fill" class="mining-glyph" />
    <span class="label">
      {#if $miningOp.found}
        Found it. Posting…
      {:else}
        Mining {$miningOp.bits} bits · {elapsed}s{$miningOp.best
          ? ` · best ${$miningOp.best}`
          : ''}
      {/if}
    </span>
    <!-- Disabled once the nonce lands: a button still offering to stop the
         mining it already finished offers something that no longer exists. -->
    <button type="button" on:click={$miningOp.stop} disabled={$miningOp.found}>Stop</button>
  </div>
{/if}

<style>
  .mining-indicator {
    position: fixed;
    bottom: calc(var(--bottom-nav-height, 0px) + env(safe-area-inset-bottom, 0px) + 0.75rem);
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.375rem 0.375rem 0.75rem;
    border-radius: 9999px;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    font-size: 0.8125rem;
    font-weight: 500;
    white-space: nowrap;
    max-width: calc(100vw - 2rem);
  }

  .label {
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  button {
    flex-shrink: 0;
    padding: 0.125rem 0.625rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-primary);
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
  }
  button:hover:not(:disabled) {
    background: var(--color-accent-gray, var(--color-bg-primary));
  }
  button:disabled {
    opacity: 0.5;
  }

  :global(.mining-glyph) {
    flex-shrink: 0;
    color: var(--color-primary);
    animation: mining-pulse 1.1s ease-in-out infinite;
  }
  @keyframes mining-pulse {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.mining-glyph) {
      animation: none;
      opacity: 1;
    }
  }
</style>
