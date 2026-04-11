<script lang="ts">
  /**
   * NourishRecipeCard — recipe card for the Nourish discovery page.
   *
   * Shows image, title, author, mini nourish dimension bars, and quick take.
   * Clicking navigates to the full recipe page.
   */

  import { nip19 } from 'nostr-tools';
  import Avatar from '../Avatar.svelte';
  import CustomName from '../CustomName.svelte';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import { getImageOrPlaceholder } from '$lib/placeholderImages';
  import { lazyLoad } from '$lib/lazyLoad';
  import type { NourishRankedRecipe, SortDimension } from '$lib/nourish/nourishDiscovery';
  import { getDimensionScore } from '$lib/nourish/nourishDiscovery';

  export let item: NourishRankedRecipe;
  export let highlightDimension: SortDimension = 'overall';

  $: link = (() => {
    const d = item.recipe.tags.find((t) => t[0] === 'd')?.[1];
    if (!d) return '#';
    return `/recipe/${nip19.naddrEncode({
      identifier: d,
      kind: item.recipe.kind || 30023,
      pubkey: item.recipe.pubkey
    })}`;
  })();

  $: imageUrl = getImageOrPlaceholder(item.image, item.recipe.id);
  $: highlightScore = getDimensionScore(item.nourish, highlightDimension);

  const DIMS = [
    { key: 'realFood' as const, label: 'Real Food', icon: '🥬' },
    { key: 'gut' as const, label: 'Gut', icon: '🌱' },
    { key: 'protein' as const, label: 'Protein', icon: '💪' }
  ];

  function getScore(key: 'realFood' | 'gut' | 'protein'): number {
    return item.nourish.scores[key].score;
  }

  /** Strength tags — only show dimensions scoring 7+ */
  function getStrengths(): string[] {
    const s = item.nourish.scores;
    const tags: string[] = [];
    if (s.realFood.score >= 7) tags.push('Whole foods');
    if (s.gut.score >= 7) tags.push('Gut-friendly');
    if (s.protein.score >= 7) tags.push('Protein-rich');
    return tags.slice(0, 2);
  }

  $: strengths = getStrengths();
</script>

<a href={link} class="nrc-card">
  <!-- Image -->
  <div class="nrc-image-wrap">
    <div use:lazyLoad={{ url: imageUrl }} class="nrc-image" />
  </div>

  <!-- Content -->
  <div class="nrc-content">
    <!-- Title + author -->
    <h3 class="nrc-title">{item.title}</h3>
    <div class="nrc-author">
      <Avatar pubkey={item.authorPubkey} size={18} />
      <span class="nrc-author-name"><CustomName pubkey={item.authorPubkey} /></span>
    </div>

    <!-- Strength tags -->
    {#if strengths.length > 0}
      <div class="nrc-strengths">
        {#each strengths as tag}
          <span class="nrc-tag">{tag}</span>
        {/each}
      </div>
    {/if}

    <!-- Mini dimension bars -->
    <div class="nrc-bars">
      {#each DIMS as dim}
        {@const score = getScore(dim.key)}
        <div class="nrc-bar-row" class:highlight={highlightDimension === dim.key}>
          <span class="nrc-bar-icon">{dim.icon}</span>
          <div class="nrc-bar-track">
            <div class="nrc-bar-fill" style="width: {score * 10}%;" />
          </div>
        </div>
      {/each}
    </div>

    <!-- Quick take -->
    {#if item.nourish.scores.summary}
      <p class="nrc-summary">{item.nourish.scores.summary}</p>
    {/if}
  </div>
</a>

<style>
  .nrc-card {
    display: flex;
    flex-direction: column;
    border-radius: 0.75rem;
    overflow: hidden;
    border: 1px solid var(--color-input-border, rgba(255, 255, 255, 0.06));
    background: var(--color-input-bg, rgba(255, 255, 255, 0.02));
    transition: border-color 150ms, transform 150ms;
    text-decoration: none;
    color: inherit;
  }
  .nrc-card:hover {
    border-color: rgba(34, 197, 94, 0.25);
    transform: translateY(-2px);
  }

  /* Image */
  .nrc-image-wrap {
    width: 100%;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    position: relative;
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.04));
  }
  .nrc-image {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    opacity: 0;
    transition: opacity 300ms;
  }
  .nrc-image:global(.image-loaded) {
    opacity: 1;
  }

  /* Content */
  .nrc-content {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.625rem 0.75rem 0.75rem;
  }

  .nrc-title {
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.3;
    color: var(--color-text-primary);
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .nrc-author {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .nrc-author-name {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
  }

  /* Strengths */
  .nrc-strengths {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .nrc-tag {
    font-size: 0.625rem;
    font-weight: 500;
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    background: rgba(34, 197, 94, 0.08);
    color: #22c55e;
    white-space: nowrap;
  }

  /* Mini bars */
  .nrc-bars {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-top: 0.125rem;
  }
  .nrc-bar-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .nrc-bar-row.highlight .nrc-bar-fill {
    opacity: 0.85;
  }
  .nrc-bar-icon {
    font-size: 0.5rem;
    width: 12px;
    text-align: center;
    flex-shrink: 0;
  }
  .nrc-bar-track {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
    overflow: hidden;
  }
  .nrc-bar-fill {
    height: 100%;
    border-radius: 2px;
    background: #22c55e;
    opacity: 0.5;
    transition: width 400ms ease-out;
  }

  /* Summary */
  .nrc-summary {
    font-size: 0.6875rem;
    font-style: italic;
    line-height: 1.4;
    color: var(--color-text-secondary);
    opacity: 0.7;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
