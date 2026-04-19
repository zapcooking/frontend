<script lang="ts">
  /**
   * NourishLoadingState — shared skeleton / retry / miss / offline UI
   * for Nourish score surfaces. Ships in PR 2 commit 4 to close drift
   * source #1 (silent compute on pantry timeout).
   *
   * States:
   *   pending  — pantry query in flight; skeleton shimmer, no buttons
   *   timeout  — pantry didn't respond; [Try again], plus [Score now]
   *              escape hatch when attemptCount >= 3 (member only)
   *   miss     — pantry confirmed no event; [Analyze] for members,
   *              silent for non-members (matches existing UX)
   *   offline  — navigator.onLine is false; no retry, no escape
   *
   * Variants:
   *   full     — modal context, vertical stack with message + buttons
   *   compact  — designed for future pill-context use (PR 3+). Not
   *              wired in PR 2; present so subsequent PRs don't need
   *              to introduce a second component.
   */
  import { createEventDispatcher } from 'svelte';
  import Skeleton from '../Skeleton.svelte';

  export let variant: 'full' | 'compact' = 'full';
  export let state: 'pending' | 'timeout' | 'miss' | 'offline';
  export let attemptCount = 0;
  export let hasMembership = false;

  // Escape hatch appears after three timeouts in the current 60s
  // window. Gating it on membership prevents non-members from bypassing
  // the paywall via the retry flow — the underlying analyzeRecipe path
  // already enforces this, but hiding the button is the cleaner UX.
  $: canEscape = attemptCount >= 3 && hasMembership;

  const dispatch = createEventDispatcher<{
    retry: void;
    'score-now': void;
    analyze: void;
  }>();
</script>

{#if variant === 'full'}
  <div class="nourish-loading nourish-loading--full">
    {#if state === 'pending'}
      <div class="skeleton-stack">
        <Skeleton height="24px" width="100%" />
        <Skeleton height="16px" width="70%" />
        <Skeleton height="16px" width="85%" />
      </div>
    {:else if state === 'timeout'}
      <div class="skeleton-stack">
        <Skeleton height="24px" width="100%" animate={false} />
      </div>
      <p class="msg">Couldn't reach the Nourish index.</p>
      <div class="actions">
        <button type="button" class="btn-primary" on:click={() => dispatch('retry')}>
          Try again
        </button>
        {#if canEscape}
          <button type="button" class="btn-secondary" on:click={() => dispatch('score-now')}>
            Score now
          </button>
        {/if}
      </div>
    {:else if state === 'miss'}
      <p class="msg">No Nourish score yet for this recipe.</p>
      {#if hasMembership}
        <div class="actions">
          <button type="button" class="btn-primary" on:click={() => dispatch('analyze')}>
            Analyze
          </button>
        </div>
      {/if}
    {:else if state === 'offline'}
      <p class="msg">You're offline. Nourish scores will load when you reconnect.</p>
    {/if}
  </div>
{:else}
  <!-- Compact variant for future pill-context use (PR 3+). -->
  <span class="nourish-loading nourish-loading--compact">
    {#if state === 'pending'}
      <Skeleton height="14px" width="36px" />
    {:else if state === 'timeout'}
      <button
        type="button"
        class="compact-retry"
        aria-label="Retry loading Nourish score"
        on:click={() => dispatch('retry')}
      >
        ↻
      </button>
    {/if}
  </span>
{/if}

<style>
  .nourish-loading--full {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem 0;
  }

  .skeleton-stack {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .msg {
    color: var(--color-caption);
    font-size: 0.875rem;
    margin: 0;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .btn-primary,
  .btn-secondary {
    padding: 0.4rem 0.9rem;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }

  .btn-primary {
    background: var(--color-primary);
    color: white;
  }

  .btn-secondary {
    background: var(--color-input-bg);
    color: var(--color-text-primary);
    border: 1px solid var(--color-input-border);
  }

  .btn-primary:hover,
  .btn-secondary:hover {
    opacity: 0.85;
  }

  .nourish-loading--compact {
    display: inline-flex;
    align-items: center;
  }

  .compact-retry {
    background: transparent;
    border: 1px solid var(--color-input-border);
    border-radius: 9999px;
    width: 22px;
    height: 22px;
    font-size: 12px;
    color: var(--color-caption);
    cursor: pointer;
  }
</style>
