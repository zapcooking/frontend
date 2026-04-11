<script lang="ts">
  /**
   * NourishPill — strengths-focused nutrition profile for recipe cards and headers.
   *
   * Design philosophy:
   *   - No judgment — no red/yellow/green, no "low/high" labels
   *   - Highlight what a recipe brings to the table, not what it lacks
   *   - Encourage curiosity, not evaluation
   *   - "Nourish Profile" framing, not "Nourish Score"
   *
   * Compact by default, expands inline to show what this recipe is rich in.
   */

  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';

  export let overall: number | null = null;
  export let gut: number | null = null;
  export let protein: number | null = null;
  export let realFood: number | null = null;
  export let compact: boolean = false;
  export let onClick: (() => void) | undefined = undefined;

  let expanded = false;

  // Nourish brand color — consistent, non-judgmental
  const NOURISH_COLOR = '#22c55e';

  /**
   * Describe what this recipe is rich in — strengths only.
   * Returns up to 2 short positive descriptors.
   */
  function getStrengths(gut: number, protein: number, realFood: number): string[] {
    const strengths: string[] = [];
    // Only highlight dimensions that are genuinely strong (7+)
    if (realFood >= 7) strengths.push('Whole foods');
    if (gut >= 7) strengths.push('Gut-friendly');
    if (protein >= 7) strengths.push('Protein-rich');
    // If nothing hits 7+, mention whatever is highest as a softer positive
    if (strengths.length === 0) {
      const best = Math.max(gut, protein, realFood);
      if (best >= 5) {
        if (realFood === best) strengths.push('Real ingredients');
        else if (gut === best) strengths.push('Plant diversity');
        else strengths.push('Protein source');
      }
    }
    return strengths.slice(0, 2);
  }

  /** Dimension label for the expanded profile view. */
  const DIMENSIONS = [
    { key: 'realFood', label: 'Real Food', icon: '🥬' },
    { key: 'gut',      label: 'Gut Health', icon: '🌱' },
    { key: 'protein',  label: 'Protein',    icon: '💪' }
  ] as const;

  function getDimensionValue(key: string): number {
    if (key === 'realFood') return realFood ?? 0;
    if (key === 'gut') return gut ?? 0;
    if (key === 'protein') return protein ?? 0;
    return 0;
  }

  function handlePillClick() {
    if (!compact) {
      expanded = !expanded;
    }
    if (onClick) onClick();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handlePillClick();
    }
  }

  $: hasSubscores = gut !== null && protein !== null && realFood !== null;
  $: strengths = hasSubscores ? getStrengths(gut!, protein!, realFood!) : [];
</script>

{#if overall !== null}
  <div class="nourish-wrapper">
    <button
      class="nourish-pill"
      on:click={handlePillClick}
      on:keydown={handleKeydown}
      aria-label="Nourish Profile{strengths.length > 0 ? ` — ${strengths.join(', ')}` : ''}"
      aria-expanded={!compact ? expanded : undefined}
    >
      <span class="pill-leaf"><LeafIcon size={14} weight="fill" /></span>
      <span class="pill-name">Nourish</span>
      {#if !compact}
        <span class="pill-caret" class:expanded>
          <CaretRightIcon size={10} weight="bold" />
        </span>
      {/if}
    </button>

    <!-- Expanded: strengths-focused profile -->
    {#if !compact && expanded && hasSubscores}
      <div class="nourish-profile" role="region" aria-label="Nourish Profile">
        <!-- Strength tags -->
        {#if strengths.length > 0}
          <div class="profile-strengths">
            {#each strengths as s}
              <span class="strength-tag">{s}</span>
            {/each}
          </div>
        {/if}

        <!-- Dimension bars — neutral presentation, no color-coding by value -->
        <div class="profile-dims">
          {#each DIMENSIONS as dim}
            {@const val = getDimensionValue(dim.key)}
            <div class="dim-row">
              <span class="dim-icon">{dim.icon}</span>
              <span class="dim-label">{dim.label}</span>
              <div class="dim-track">
                <div class="dim-fill" style="width: {val * 10}%;" />
              </div>
            </div>
          {/each}
        </div>

        <!-- Invite to learn more -->
        <button class="profile-details" on:click={() => { if (onClick) onClick(); }}>
          See full profile
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .nourish-wrapper {
    display: inline-flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  /* ── Pill ── */
  .nourish-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
    border: 1px solid rgba(34, 197, 94, 0.25);
    background: rgba(34, 197, 94, 0.06);
    cursor: pointer;
    transition: background 150ms, border-color 150ms;
    font-family: inherit;
    line-height: 1;
    white-space: nowrap;
  }
  .nourish-pill:hover {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.4);
  }
  .nourish-pill:focus-visible {
    outline: 2px solid #22c55e;
    outline-offset: 2px;
  }

  .pill-leaf {
    display: flex;
    color: #22c55e;
    flex-shrink: 0;
  }
  .pill-name {
    font-size: 0.6875rem;
    font-weight: 600;
    color: #22c55e;
    letter-spacing: 0.01em;
  }
  .pill-caret {
    display: flex;
    color: #22c55e;
    opacity: 0.4;
    transition: transform 200ms ease;
  }
  .pill-caret.expanded {
    transform: rotate(90deg);
    opacity: 0.7;
  }

  /* ── Expanded profile ── */
  .nourish-profile {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border-radius: 0.625rem;
    background: var(--color-input-bg, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--color-input-border, rgba(255, 255, 255, 0.06));
    min-width: 180px;
    max-width: 220px;
  }

  /* Strength tags */
  .profile-strengths {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .strength-tag {
    font-size: 0.625rem;
    font-weight: 500;
    padding: 0.125rem 0.375rem;
    border-radius: 9999px;
    background: rgba(34, 197, 94, 0.08);
    color: #22c55e;
    white-space: nowrap;
  }

  /* Dimension rows */
  .profile-dims {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .dim-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .dim-icon {
    font-size: 0.625rem;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
  }
  .dim-label {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    width: 56px;
    flex-shrink: 0;
  }
  .dim-track {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
    overflow: hidden;
  }
  .dim-fill {
    height: 100%;
    border-radius: 2px;
    background: #22c55e;
    opacity: 0.7;
    transition: width 400ms ease-out;
  }

  /* Details link */
  .profile-details {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    opacity: 0.6;
    cursor: pointer;
    text-align: left;
    padding: 0;
    border: none;
    background: none;
    font-family: inherit;
    transition: opacity 150ms;
  }
  .profile-details:hover {
    opacity: 1;
    color: #22c55e;
  }
</style>
