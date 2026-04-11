<script lang="ts">
  /**
   * NourishPill — compact score presentation for recipe cards and headers.
   *
   * Three display modes:
   *   'pill'     — "🌿 Nourish 7"          (clean, minimal)
   *   'labeled'  — "🌿 7 Strong"            (score + meaning)
   *   'expand'   — "🌿 Nourish 7 ▸" → inline breakdown  (hybrid)
   *
   * Recommended: 'expand' — compact by default, rich on interaction.
   */

  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';

  export let overall: number | null = null;
  export let gut: number | null = null;
  export let protein: number | null = null;
  export let realFood: number | null = null;
  export let mode: 'pill' | 'labeled' | 'expand' = 'expand';
  export let onClick: (() => void) | undefined = undefined;

  let expanded = false;

  /** Map a 0–10 score to a human-readable label. */
  function scoreLabel(score: number): string {
    if (score <= 3) return 'Low';
    if (score <= 6) return 'Moderate';
    return 'Strong';
  }

  /** Color for the score badge based on value. */
  function scoreColor(score: number): string {
    if (score <= 3) return '#ef4444';  // red
    if (score <= 6) return '#eab308';  // amber
    return '#22c55e';                  // green
  }

  function handleClick() {
    if (mode === 'expand') {
      expanded = !expanded;
    }
    if (onClick) onClick();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }

  $: label = overall !== null ? scoreLabel(overall) : '';
  $: color = overall !== null ? scoreColor(overall) : '#22c55e';
  $: hasSubscores = gut !== null && protein !== null && realFood !== null;
</script>

{#if overall !== null}
  <div class="nourish-pill-wrapper">
    <button
      class="nourish-pill"
      on:click={handleClick}
      on:keydown={handleKeydown}
      aria-label="Nourish score {overall} out of 10 — {label}"
      aria-expanded={mode === 'expand' ? expanded : undefined}
      style="--pill-color: {color};"
    >
      <span class="pill-icon"><LeafIcon size={14} weight="fill" /></span>

      {#if mode === 'pill'}
        <span class="pill-text">Nourish</span>
        <span class="pill-score">{overall}</span>
      {:else if mode === 'labeled'}
        <span class="pill-score">{overall}</span>
        <span class="pill-label">{label}</span>
      {:else}
        <!-- expand mode -->
        <span class="pill-text">Nourish</span>
        <span class="pill-score">{overall}</span>
        <span class="pill-caret" class:expanded>
          <CaretRightIcon size={10} weight="bold" />
        </span>
      {/if}
    </button>

    <!-- Expanded inline breakdown -->
    {#if mode === 'expand' && expanded && hasSubscores}
      <div class="nourish-breakdown" role="region" aria-label="Nourish score breakdown">
        {#each [
          { label: 'Real Food', score: realFood, color: '#f97316' },
          { label: 'Gut', score: gut, color: '#22c55e' },
          { label: 'Protein', score: protein, color: '#3b82f6' }
        ] as item}
          <div class="breakdown-row">
            <span class="breakdown-label">{item.label}</span>
            <div class="breakdown-track">
              <div
                class="breakdown-fill"
                style="width: {(item.score ?? 0) * 10}%; background: {item.color};"
              />
            </div>
            <span class="breakdown-value" style="color: {item.color};">{item.score}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .nourish-pill-wrapper {
    display: inline-flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .nourish-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.625rem;
    border-radius: 9999px;
    border: 1px solid var(--pill-color, #22c55e);
    background: color-mix(in srgb, var(--pill-color, #22c55e) 8%, transparent);
    cursor: pointer;
    transition: background 150ms, box-shadow 150ms;
    font-family: inherit;
    line-height: 1;
    white-space: nowrap;
  }

  .nourish-pill:hover {
    background: color-mix(in srgb, var(--pill-color, #22c55e) 15%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--pill-color, #22c55e) 12%, transparent);
  }

  .nourish-pill:focus-visible {
    outline: 2px solid var(--pill-color, #22c55e);
    outline-offset: 2px;
  }

  .pill-icon {
    display: flex;
    color: var(--pill-color, #22c55e);
    flex-shrink: 0;
  }

  .pill-text {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    letter-spacing: 0.01em;
  }

  .pill-score {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--pill-color, #22c55e);
  }

  .pill-label {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .pill-caret {
    display: flex;
    color: var(--color-text-secondary);
    opacity: 0.5;
    transition: transform 200ms ease;
  }
  .pill-caret.expanded {
    transform: rotate(90deg);
  }

  /* ── Breakdown ── */
  .nourish-breakdown {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.5rem 0.625rem;
    border-radius: 0.5rem;
    background: var(--color-input-bg, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--color-input-border, rgba(255, 255, 255, 0.06));
    min-width: 160px;
  }

  .breakdown-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .breakdown-label {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    width: 52px;
    flex-shrink: 0;
  }

  .breakdown-track {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
    min-width: 48px;
  }

  .breakdown-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 400ms ease-out;
  }

  .breakdown-value {
    font-size: 0.6875rem;
    font-weight: 700;
    width: 16px;
    text-align: right;
    flex-shrink: 0;
  }
</style>
