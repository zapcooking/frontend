<script lang="ts">
  /**
   * NourishDimensionTile — one dimension rendered as a compact tile for
   * the 2-column grid in NourishResult.
   *
   * Design contract:
   *   - Green-family only. Saturation varies by score tier — never amber,
   *     never red. The card should read as "more or less of a good thing,"
   *     not a report card.
   *   - Three tiers: strong (7–10), moderate (4–6), light (0–3). Strong
   *     gets the vivid accent; moderate gets medium; light gets a faded
   *     track + muted label ("lightly present") in place of the numeric
   *     score and tiny-bar visual.
   *   - Tap expands in-place to show the per-dimension `reason` plus the
   *     numeric score (for users who want it). Other tiles in the grid
   *     stay put — CSS grid auto-rows handles the size change.
   *   - Flag affordance passes through when `flagDimension` is set. The
   *     four new v2 dimensions (antiInflammatory, bloodSugar,
   *     immuneSupportive, brainHealth) aren't in the flag-event type
   *     yet; callers pass `null` for those and the flag button is
   *     suppressed.
   */

  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import NourishFlagButton from './NourishFlagButton.svelte';
  import type { FlagTarget, NourishDimension } from '$lib/nourish/flagSubmit';

  export let icon: string = '🌱';
  export let label: string = '';
  export let score: number = 0;
  export let reason: string = '';

  /** When present, the expanded detail row renders a flag button. */
  export let flagTarget: FlagTarget | null = null;

  /**
   * Machine-readable dimension key for flag events. Must be one of the
   * NourishDimension values (gut / protein / realFood / overall).
   * Pass `null` for the v2 dimensions the flag type doesn't yet cover.
   */
  export let flagDimension: NourishDimension | null = null;

  /** PromptVersion snapshot for the flag event. */
  export let promptVersion: string = '';

  let expanded = false;

  // Native <button> handles Enter/Space → click synthesis on its own;
  // no explicit keydown handler needed. A custom handler here would
  // double-fire on Enter/Space across some browsers + ATs.
  function toggle() {
    if (reason) expanded = !expanded;
  }

  // Score tier drives saturation. Thresholds match the user-facing
  // language tiers: strong = "well represented," moderate = "some,"
  // light = "lightly present" (no numeric).
  $: tier = score >= 7 ? 'strong' : score >= 4 ? 'moderate' : 'light';

  // Fill width — min 12% when score > 0 so the track never looks empty
  // and "broken." Score 0 → 0% (flat faded track).
  $: fillWidth = score === 0 ? 0 : Math.max(12, score * 10);

  // Soft language for light scores — the spec's core emotional move.
  // "2/10" reads as a failing grade; "lightly present" says the same
  // thing without judgment.
  $: softLabel =
    score === 0
      ? 'Not a focus here'
      : score <= 2
        ? 'Lightly present'
        : '';

  $: canFlag = !!flagTarget && !!flagDimension && !!promptVersion;
</script>

<div
  class="tile"
  class:tile-light={tier === 'light'}
  class:tile-moderate={tier === 'moderate'}
  class:tile-strong={tier === 'strong'}
  class:expanded
>
  <button
    type="button"
    class="tile-head"
    class:expandable={!!reason}
    on:click={toggle}
    aria-expanded={reason ? expanded : undefined}
    aria-label="{label} — {reason ? 'tap to learn more' : ''}"
  >
    <span class="tile-icon" aria-hidden="true">{icon}</span>
    <span class="tile-label">{label}</span>
    {#if reason}
      <span class="tile-caret" class:rot={expanded}>
        <CaretDownIcon size={10} weight="bold" />
      </span>
    {/if}
  </button>

  <div class="tile-track" aria-hidden="true">
    <div class="tile-fill" style="width: {fillWidth}%;"></div>
  </div>

  {#if softLabel}
    <p class="tile-soft">{softLabel}</p>
  {/if}

  {#if expanded && reason}
    <div class="tile-detail">
      <p class="tile-reason">{reason}</p>
      <div class="tile-detail-foot">
        <span class="tile-score">{score}<span class="tile-score-max">/10</span></span>
        {#if canFlag && flagTarget && flagDimension}
          <NourishFlagButton
            target={flagTarget}
            dimension={flagDimension}
            {score}
            {promptVersion}
            iconSize={12}
            dimensionLabel={label.toLowerCase()}
          />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Three green tiers. CSS vars so callers / future themes can tune
     without re-editing every tile. All three stay in the green family
     — the whole point of this redesign is that nothing ever reads as
     amber or red. */
  .tile {
    --tile-green-strong: #22c55e;
    --tile-green-moderate: #4ade80;
    --tile-green-light: #86efac;
    --tile-track-bg: rgba(255, 255, 255, 0.05);

    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.55rem 0.65rem 0.6rem;
    border-radius: 0.55rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.02);
    transition: background 150ms ease, border-color 150ms ease;
    min-width: 0;
  }
  .tile.expanded {
    background: rgba(34, 197, 94, 0.05);
    border-color: rgba(34, 197, 94, 0.2);
  }

  .tile-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0;
    margin: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    width: 100%;
    cursor: default;
  }
  .tile-head.expandable {
    cursor: pointer;
  }
  .tile-head.expandable:hover {
    opacity: 0.85;
  }

  .tile-icon {
    font-size: 0.9rem;
    flex-shrink: 0;
    line-height: 1;
  }

  .tile-label {
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--color-text-primary);
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tile-caret {
    display: inline-flex;
    color: var(--color-text-secondary);
    opacity: 0.45;
    transition: transform 180ms ease, opacity 180ms ease;
    flex-shrink: 0;
  }
  .tile-caret.rot {
    transform: rotate(180deg);
    opacity: 0.8;
  }

  .tile-track {
    height: 5px;
    border-radius: 3px;
    background: var(--tile-track-bg);
    overflow: hidden;
  }
  .tile-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 420ms ease-out, background 180ms ease;
  }

  /* Tier saturation — strong is vivid and fully opaque; moderate eases
     off slightly; light is noticeably muted. Same hue family
     throughout so the visual register never says "warning." */
  .tile-strong .tile-fill {
    background: var(--tile-green-strong);
    opacity: 1;
  }
  .tile-moderate .tile-fill {
    background: var(--tile-green-moderate);
    opacity: 0.85;
  }
  .tile-light .tile-fill {
    background: var(--tile-green-light);
    opacity: 0.55;
  }

  .tile-soft {
    margin: 0;
    font-size: 0.68rem;
    color: var(--color-text-secondary);
    font-style: italic;
    opacity: 0.7;
    line-height: 1.2;
  }

  .tile-detail {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.1rem;
    animation: tile-expand 180ms ease-out;
  }
  @keyframes tile-expand {
    from { opacity: 0; transform: translateY(-2px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .tile-reason {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.45;
    color: var(--color-text-secondary);
  }

  .tile-detail-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .tile-score {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--tile-green-strong);
    line-height: 1.1;
  }
  .tile-score-max {
    font-size: 0.58rem;
    font-weight: 400;
    color: var(--color-text-secondary);
    margin-left: 0.05rem;
  }

  /* Keep the score color tier-aware too — a light-tier dimension
     shouldn't have a bright-green numeric in the expansion. */
  .tile-light .tile-score {
    color: var(--tile-green-light);
  }
  .tile-moderate .tile-score {
    color: var(--tile-green-moderate);
  }
</style>
