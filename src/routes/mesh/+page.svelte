<script lang="ts">
  import { onMount } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { fetchMeshRecipes, fetchMeshEngagement, buildMeshGraph, type EngagementMap } from '$lib/meshUtils';
  import CulinaryMesh from '../../components/CulinaryMesh.svelte';
  import { theme } from '$lib/themeStore';

  let recipes: NDKEvent[] = [];
  let engagement: EngagementMap = new Map();
  let loading = true;
  let settling = false;
  let loadingPhase: 'recipes' | 'engagement' | 'settling' | '' = '';
  let error = '';
  let meshComponent: CulinaryMesh;
  let dataReady = false;

  // Stats
  let recipeCount = 0;
  let tagCount = 0;
  let connectionCount = 0;

  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';

  async function loadData() {
    loading = true;
    error = '';
    try {
      // Phase 1: Discover recipes
      loadingPhase = 'recipes';
      recipes = await fetchMeshRecipes();
      if (recipes.length === 0) {
        error = 'No recipes found. The network may be slow — please try again.';
        return;
      }

      // Phase 2: Map engagement
      loadingPhase = 'engagement';
      engagement = await fetchMeshEngagement(recipes);

      // Compute stats
      const graph = buildMeshGraph(recipes, engagement);
      recipeCount = graph.nodes.filter((n) => n.type === 'recipe').length;
      tagCount = graph.nodes.filter((n) => n.type === 'tag').length;
      connectionCount = graph.edges.filter((e) => e.edgeType === 'recipe-recipe').length;

      // Phase 3: Mount mesh (hidden) and let simulation settle
      dataReady = true;
      settling = true;
      loadingPhase = 'settling';
    } catch (e) {
      error = 'Failed to load recipes. Please try again.';
      loading = false;
      loadingPhase = '';
    }
  }

  function handleSettled() {
    settling = false;
    loading = false;
    loadingPhase = '';
  }

  onMount(loadData);
</script>

<svelte:head>
  <title>Culinary Mesh - zap.cooking</title>
  <meta name="description" content="Explore the culinary mesh — an interactive network visualization of all recipes on zap.cooking, clustered by cuisine, ingredient, and style." />
  <meta property="og:title" content="Culinary Mesh - zap.cooking" />
  <meta property="og:description" content="Interactive network visualization of all recipes on zap.cooking" />
</svelte:head>

<div class="mesh-page">
  <!-- Header -->
  <div class="mesh-header" style="background-color: var(--color-bg-primary); border-bottom: 1px solid var(--color-input-border);">
    <div class="px-4 py-3">
      <h1 class="text-xl font-bold" style="color: var(--color-text-primary);">
        Culinary Mesh
      </h1>
      {#if !loading && !error}
        <p class="text-sm" style="color: var(--color-caption);">
          {recipeCount} recipes &middot; {tagCount} tags &middot; {connectionCount} connections
        </p>
      {/if}
    </div>
  </div>

  <!-- Content -->
  <div class="mesh-body">
    {#if error}
      <div class="flex flex-col items-center justify-center h-full gap-3">
        <p style="color: var(--color-caption);">{error}</p>
        <button
          class="px-4 py-2 rounded-lg text-sm font-medium"
          style="background-color: var(--color-primary); color: white;"
          on:click={loadData}
        >
          Retry
        </button>
      </div>
    {:else}
      <!-- Mount mesh as soon as data is ready (invisible until settled via CSS) -->
      {#if dataReady}
        <CulinaryMesh {recipes} {engagement} bind:this={meshComponent} on:settled={handleSettled} />
      {/if}

      <!-- Loading / settling overlay -->
      {#if loading}
        <div class="mesh-loading-overlay">
          <div class="flex flex-col items-center justify-center h-full gap-3">
            <div class="mesh-spinner" />
            <p style="color: var(--color-caption);">
              {#if loadingPhase === 'recipes'}
                Discovering recipes...
              {:else if loadingPhase === 'engagement'}
                Mapping community engagement...
              {:else if loadingPhase === 'settling'}
                Arranging the mesh...
              {:else}
                Loading the culinary mesh...
              {/if}
            </p>
          </div>
        </div>
      {/if}

      <!-- Legend overlay (only when settled) -->
      {#if !loading && !error}
        <div class="mesh-legend" class:dark={isDarkMode}>
          <div class="mesh-legend-item">
            <span class="mesh-legend-dot mesh-legend-hero"></span>
            <span>Most loved</span>
          </div>
          <div class="mesh-legend-item">
            <span class="mesh-legend-dot mesh-legend-notable"></span>
            <span>Notable</span>
          </div>
          <div class="mesh-legend-item">
            <span class="mesh-legend-dot mesh-legend-community"></span>
            <span>Community</span>
          </div>
          <div class="mesh-legend-item">
            <svg width="24" height="8" viewBox="0 0 24 8" class="mesh-legend-curve">
              <path d="M 0 6 Q 12 0 24 6" stroke="currentColor" stroke-width="1.5" fill="none" />
            </svg>
            <span>Shared culture</span>
          </div>
        </div>

        <!-- Zoom controls -->
        <div class="mesh-zoom-controls" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);">
          <button
            on:click={() => meshComponent?.zoomIn()}
            class="mesh-zoom-btn"
            style="color: var(--color-text-primary);"
            aria-label="Zoom in"
          >+</button>
          <div style="border-top: 1px solid var(--color-input-border);" />
          <button
            on:click={() => meshComponent?.zoomOut()}
            class="mesh-zoom-btn"
            style="color: var(--color-text-primary);"
            aria-label="Zoom out"
          >&minus;</button>
          <div style="border-top: 1px solid var(--color-input-border);" />
          <button
            on:click={() => meshComponent?.resetZoom()}
            class="mesh-zoom-btn text-xs"
            style="color: var(--color-caption);"
            aria-label="Reset zoom"
          >Reset</button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .mesh-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
  }

  .mesh-header {
    flex-shrink: 0;
    z-index: 10;
  }

  .mesh-body {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .mesh-loading-overlay {
    position: absolute;
    inset: 0;
    z-index: 30;
    background-color: var(--color-bg-primary);
  }

  .mesh-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-input-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .mesh-zoom-controls {
    position: absolute;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    z-index: 20;
  }

  .mesh-zoom-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .mesh-zoom-btn:hover {
    opacity: 0.7;
  }

  /* ── Legend ────────────────────────────────────────────────── */

  .mesh-legend {
    position: absolute;
    bottom: 16px;
    left: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 11px;
    z-index: 20;
    background-color: rgba(255, 255, 255, 0.7);
    border: 1px solid rgba(0, 0, 0, 0.08);
    color: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
  }

  .mesh-legend.dark {
    background-color: rgba(20, 15, 12, 0.7);
    border-color: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.5);
  }

  .mesh-legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mesh-legend-dot {
    display: inline-block;
    border-radius: 9999px;
    flex-shrink: 0;
  }

  .mesh-legend-hero {
    width: 14px;
    height: 14px;
    background: rgb(249, 115, 22);
    box-shadow: 0 0 6px 2px rgba(249, 115, 22, 0.5);
  }

  .mesh-legend-notable {
    width: 10px;
    height: 10px;
    background: rgb(249, 115, 22);
    opacity: 0.7;
  }

  .mesh-legend-community {
    width: 7px;
    height: 7px;
    background: rgb(160, 160, 160);
    opacity: 0.5;
  }

  .mesh-legend-curve {
    color: rgba(251, 191, 36, 0.6);
    flex-shrink: 0;
  }

  .mesh-legend.dark .mesh-legend-curve {
    color: rgba(251, 191, 36, 0.5);
  }
</style>
