<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk, ensureNdkConnected } from '$lib/nostr';
  import { browser } from '$app/environment';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import SpinnerIcon from 'phosphor-svelte/lib/SpinnerGap';
  import NourishRecipeCard from '../../../components/nourish/NourishRecipeCard.svelte';
  import {
    fetchNourishRankedRecipes,
    type NourishRankedRecipe,
    type SortDimension
  } from '$lib/nourish/nourishDiscovery';

  let recipes: NourishRankedRecipe[] = [];
  let loading = true;
  let error = false;
  let sortBy: SortDimension = 'overall';

  const SORT_OPTIONS: { id: SortDimension; label: string; icon: string }[] = [
    { id: 'overall', label: 'Overall', icon: '🌿' },
    { id: 'realFood', label: 'Real Food', icon: '🥬' },
    { id: 'gut', label: 'Gut Health', icon: '🌱' },
    { id: 'protein', label: 'Protein', icon: '💪' }
  ];

  async function loadRecipes() {
    if (!$ndk) return;
    loading = true;
    error = false;

    try {
      await ensureNdkConnected();
      recipes = await fetchNourishRankedRecipes($ndk, sortBy, 40);
    } catch (err) {
      console.error('[Nourish Explore] Failed to load:', err);
      error = true;
    } finally {
      loading = false;
    }
  }

  function handleSort(dim: SortDimension) {
    sortBy = dim;
    loadRecipes();
  }

  onMount(() => {
    if (browser && $ndk) {
      loadRecipes();
    }
  });

  // Reload when NDK becomes available
  $: if (browser && $ndk && loading && recipes.length === 0 && !error) {
    loadRecipes();
  }
</script>

<svelte:head>
  <title>Nourish Explore — Beta | Zap Cooking</title>
</svelte:head>

<div class="explore-page">
  <!-- Header -->
  <div class="header">
    <div class="header-top">
      <LeafIcon size={22} weight="fill" class="text-green-500" />
      <h1 class="page-title">Nourish Explore</h1>
      <span class="beta-badge">Beta</span>
    </div>
    <p class="page-subtitle">Browse recipes by what they bring to the table.</p>
    <p class="page-note">Profiles are AI-generated estimates — use as guidance, not gospel.</p>
  </div>

  <!-- Sort controls -->
  <div class="sort-bar">
    <span class="sort-label">Sort by</span>
    <div class="sort-options">
      {#each SORT_OPTIONS as opt}
        <button
          class="sort-btn"
          class:active={sortBy === opt.id}
          on:click={() => handleSort(opt.id)}
          disabled={loading}
        >
          <span class="sort-icon">{opt.icon}</span>
          {opt.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Content -->
  {#if loading}
    <div class="state-center">
      <SpinnerIcon size={28} class="animate-spin text-green-500" />
      <p class="state-text">Finding analyzed recipes...</p>
    </div>

  {:else if error}
    <div class="state-center">
      <p class="state-text">Something went wrong. Please try again.</p>
      <button class="retry-btn" on:click={loadRecipes}>Retry</button>
    </div>

  {:else if recipes.length === 0}
    <div class="state-center">
      <LeafIcon size={32} weight="light" class="text-green-500" style="opacity: 0.3;" />
      <p class="state-text">No analyzed recipes yet.</p>
      <p class="state-sub">Once recipes are analyzed with Nourish, they'll appear here ranked by their nutrition profile.</p>
      <a href="/nourish" class="state-link">Try Nourish</a>
    </div>

  {:else}
    <div class="recipe-grid">
      {#each recipes as item (item.recipe.id)}
        <NourishRecipeCard {item} highlightDimension={sortBy} />
      {/each}
    </div>

    <p class="grid-footer">
      {recipes.length} recipe{recipes.length !== 1 ? 's' : ''} with Nourish profiles
    </p>
  {/if}
</div>

<style>
  .explore-page {
    max-width: 720px;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  /* Header */
  .header {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .header-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .page-title {
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--color-text-primary);
    margin: 0;
  }
  .beta-badge {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: rgba(34, 197, 94, 0.12);
    color: #22c55e;
  }
  .page-subtitle {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    margin: 0;
  }
  .page-note {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    opacity: 0.5;
    margin: 0;
  }

  /* Sort bar */
  .sort-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .sort-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    opacity: 0.6;
  }
  .sort-options {
    display: flex;
    gap: 0.375rem;
  }
  .sort-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.3rem 0.625rem;
    border-radius: 9999px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.03);
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: background 150ms, border-color 150ms, color 150ms;
  }
  .sort-btn:hover:not(:disabled) {
    background: rgba(34, 197, 94, 0.06);
    border-color: rgba(34, 197, 94, 0.2);
  }
  .sort-btn.active {
    background: rgba(34, 197, 94, 0.1);
    border-color: rgba(34, 197, 94, 0.3);
    color: #22c55e;
    font-weight: 600;
  }
  .sort-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .sort-icon {
    font-size: 0.75rem;
  }

  /* States */
  .state-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.5rem;
    padding: 3rem 1rem;
  }
  .state-text {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    margin: 0;
  }
  .state-sub {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    opacity: 0.6;
    margin: 0;
    max-width: 280px;
  }
  .state-link {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #22c55e;
    text-decoration: none;
    margin-top: 0.25rem;
  }
  .state-link:hover {
    text-decoration: underline;
  }
  .retry-btn {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #22c55e;
    background: none;
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 0.375rem;
    padding: 0.375rem 0.75rem;
    cursor: pointer;
    font-family: inherit;
    transition: background 150ms;
  }
  .retry-btn:hover {
    background: rgba(34, 197, 94, 0.08);
  }

  /* Recipe grid */
  .recipe-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1rem;
  }

  @media (max-width: 540px) {
    .recipe-grid {
      grid-template-columns: 1fr;
    }
  }

  .grid-footer {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
    opacity: 0.4;
    text-align: center;
    margin: 0;
  }
</style>
