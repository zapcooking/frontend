<script lang="ts">
  /**
   * NourishDimensionBar — single expandable dimension row.
   *
   * Shows icon + label + bar by default.
   * Tap/click expands to reveal the reason text and numeric score.
   * No numeric score visible in collapsed state — bars show the profile shape.
   *
   * When `flagTarget` is provided, renders a small NourishFlagButton in
   * the expanded detail row so users can contest the score.
   */

  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import NourishFlagButton from './NourishFlagButton.svelte';
  import type { FlagTarget, NourishDimension } from '$lib/nourish/flagSubmit';

  export let icon: string = '🌱';
  export let label: string = '';
  export let score: number = 0;
  export let reason: string = '';

  /**
   * When present, the expanded detail row includes a flag affordance.
   * Pass through from NourishResult's parent (NourishModal, /nourish page).
   * Null/undefined → no flag button.
   */
  export let flagTarget: FlagTarget | null = null;

  /**
   * Machine-readable dimension key, required when `flagTarget` is set.
   * Must be one of the NourishDimension values (gut / protein / realFood /
   * overall). If omitted, the flag button is suppressed.
   */
  export let flagDimension: NourishDimension | null = null;

  /** Nourish model/prompt version snapshot — required when flagTarget is set. */
  export let nourishVer: string = '';

  let expanded = false;

  function toggle() {
    if (reason) expanded = !expanded;
  }

  $: canFlag = !!flagTarget && !!flagDimension && !!nourishVer;
</script>

<button
  class="dim-row"
  class:expandable={!!reason}
  class:expanded
  on:click={toggle}
  aria-expanded={reason ? expanded : undefined}
  aria-label="{label} — tap to learn more"
>
  <span class="dim-icon">{icon}</span>
  <span class="dim-label">{label}</span>
  <div class="dim-track">
    <div class="dim-fill" style="width: {score * 10}%;" />
  </div>
  {#if reason}
    <span class="dim-caret" class:expanded>
      <CaretDownIcon size={10} weight="bold" />
    </span>
  {/if}
</button>

{#if expanded && reason}
  <div class="dim-detail">
    <span class="dim-score">{score}<span class="dim-score-max">/10</span></span>
    <p class="dim-reason">{reason}</p>
    {#if canFlag && flagTarget && flagDimension}
      <div class="dim-flag">
        <NourishFlagButton
          target={flagTarget}
          dimension={flagDimension}
          {score}
          {nourishVer}
          iconSize={12}
          dimensionLabel={label.toLowerCase()}
        />
      </div>
    {/if}
  </div>
{/if}

<style>
  .dim-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
    width: 100%;
    border: none;
    background: none;
    cursor: default;
    font-family: inherit;
    text-align: left;
    transition: opacity 150ms;
  }
  .dim-row.expandable {
    cursor: pointer;
  }
  .dim-row.expandable:hover {
    opacity: 0.85;
  }

  .dim-icon {
    font-size: 0.875rem;
    width: 20px;
    text-align: center;
    flex-shrink: 0;
  }

  .dim-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text-primary);
    width: 72px;
    flex-shrink: 0;
  }

  .dim-track {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
    overflow: hidden;
  }

  .dim-fill {
    height: 100%;
    border-radius: 3px;
    background: #22c55e;
    opacity: 0.65;
    transition: width 500ms ease-out;
  }

  .dim-caret {
    display: flex;
    color: var(--color-text-secondary);
    opacity: 0.4;
    transition: transform 200ms ease;
    flex-shrink: 0;
  }
  .dim-caret.expanded {
    transform: rotate(180deg);
    opacity: 0.7;
  }

  .dim-detail {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0 0 0.5rem 2rem;
    animation: dim-expand 150ms ease-out;
  }

  @keyframes dim-expand {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .dim-score {
    font-size: 0.875rem;
    font-weight: 700;
    color: #22c55e;
    flex-shrink: 0;
    line-height: 1.4;
  }
  .dim-score-max {
    font-size: 0.625rem;
    font-weight: 400;
    color: var(--color-text-secondary);
  }

  .dim-reason {
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--color-text-secondary);
    margin: 0;
    flex: 1;
  }

  .dim-flag {
    flex-shrink: 0;
    align-self: flex-start;
    margin-left: 0.25rem;
  }
</style>
