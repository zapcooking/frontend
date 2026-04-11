<script lang="ts">
  /**
   * NourishResult — strengths-focused result presentation.
   *
   * Shared between the /nourish page and the NourishModal on recipe pages.
   * Leads with what the food brings, not what it lacks.
   */

  import NourishDimensionBar from './NourishDimensionBar.svelte';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import type { NourishScores, IngredientSignal } from '$lib/nourish/types';

  export let scores: NourishScores;
  export let quickTake: string = '';
  export let improvements: string[] = [];
  export let ingredientSignals: IngredientSignal[] = [];
  export let onReset: (() => void) | undefined = undefined;
  export let compact: boolean = false;

  /**
   * Derive strength tags from scores — only highlight genuinely strong dimensions.
   */
  function getStrengths(s: NourishScores): string[] {
    const tags: string[] = [];
    if (s.realFood.score >= 7) tags.push('Whole foods');
    if (s.gut.score >= 7) tags.push('Gut-friendly');
    if (s.protein.score >= 7) tags.push('Protein-rich');
    // If nothing hits 7, show the strongest as a softer positive
    if (tags.length === 0) {
      const best = Math.max(s.gut.score, s.protein.score, s.realFood.score);
      if (best >= 5) {
        if (s.realFood.score === best) tags.push('Real ingredients');
        else if (s.gut.score === best) tags.push('Plant diversity');
        else tags.push('Protein source');
      }
    }
    return tags.slice(0, 3);
  }

  /**
   * Get top positive ingredient contributors.
   */
  function getPositiveContributors(signals: IngredientSignal[]): string[] {
    return signals
      .filter((s) => s.contribution !== 'neutral')
      .slice(0, 4)
      .map((s) => s.name);
  }

  $: strengths = getStrengths(scores);
  $: contributors = getPositiveContributors(ingredientSignals);
</script>

<div class="nr-result" class:compact>
  <!-- Quick take -->
  {#if quickTake || scores.summary}
    <p class="nr-quicktake">{quickTake || scores.summary}</p>
  {/if}

  <!-- Strength tags -->
  {#if strengths.length > 0}
    <div class="nr-section">
      <p class="nr-section-label">What this meal brings</p>
      <div class="nr-strengths">
        {#each strengths as tag}
          <span class="nr-tag">
            <LeafIcon size={10} weight="fill" />
            {tag}
          </span>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Nourish Profile — dimension bars -->
  <div class="nr-section">
    <p class="nr-section-label">Nourish Profile</p>
    <div class="nr-dims">
      <NourishDimensionBar icon="🥬" label="Real Food" score={scores.realFood.score} reason={scores.realFood.reason} />
      <NourishDimensionBar icon="🌱" label="Gut Health" score={scores.gut.score} reason={scores.gut.reason} />
      <NourishDimensionBar icon="💪" label="Protein" score={scores.protein.score} reason={scores.protein.reason} />
    </div>
  </div>

  <!-- Top contributors -->
  {#if contributors.length > 0}
    <div class="nr-section">
      <p class="nr-section-label">Key ingredients</p>
      <div class="nr-contributors">
        {#each contributors as name}
          <span class="nr-contributor">{name}</span>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Simple upgrades -->
  {#if improvements.length > 0}
    <div class="nr-section">
      <p class="nr-section-label">Simple upgrades</p>
      <div class="nr-upgrades">
        {#each improvements as item}
          <p class="nr-upgrade">{item}</p>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Footer actions -->
  <div class="nr-footer">
    <p class="nr-disclaimer">Profiles are estimates based on ingredients. Not medical advice.</p>
    {#if onReset}
      <button class="nr-reset" on:click={onReset}>Try another</button>
    {/if}
  </div>
</div>

<style>
  .nr-result {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .nr-result.compact {
    gap: 0.5rem;
  }

  /* Quick take */
  .nr-quicktake {
    font-size: 0.875rem;
    font-style: italic;
    line-height: 1.5;
    color: var(--color-text-primary);
    margin: 0;
    padding-bottom: 0.25rem;
  }

  /* Sections */
  .nr-section {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .nr-section-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-secondary);
    opacity: 0.6;
    margin: 0;
  }

  /* Strength tags */
  .nr-strengths {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  .nr-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
    background: rgba(34, 197, 94, 0.08);
    color: #22c55e;
    white-space: nowrap;
  }

  /* Dimension bars */
  .nr-dims {
    display: flex;
    flex-direction: column;
  }

  /* Contributors */
  .nr-contributors {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .nr-contributor {
    font-size: 0.75rem;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.04));
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  /* Upgrades */
  .nr-upgrades {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .nr-upgrade {
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--color-text-secondary);
    margin: 0;
    padding-left: 0.75rem;
    border-left: 2px solid rgba(34, 197, 94, 0.2);
  }

  /* Footer */
  .nr-footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--color-bg-tertiary, rgba(255, 255, 255, 0.04));
  }
  .nr-disclaimer {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    opacity: 0.5;
    margin: 0;
    text-align: center;
  }
  .nr-reset {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #22c55e;
    cursor: pointer;
    background: none;
    border: none;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-family: inherit;
    transition: background 150ms;
  }
  .nr-reset:hover {
    background: rgba(34, 197, 94, 0.08);
  }
</style>
