<script lang="ts">
  import { onMount } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { fetchMeshRecipes, fetchMeshEngagement, buildMeshGraph, type EngagementMap } from '$lib/meshUtils';
  import type { MeshVisualTheme, MeshLayers, MeshFilters, MeshNode } from '$lib/mesh/meshTypes';
  import { meshVisualTheme, meshLayers, meshFilters, meshSelectedNodeId } from '$lib/mesh/meshStore';
  import CulinaryMesh from '../../components/CulinaryMesh.svelte';
  import MeshZoomControls from '../../components/mesh/MeshZoomControls.svelte';
  import MeshDetailDrawer from '../../components/mesh/MeshDetailDrawer.svelte';
  import MeshStarfield from '../../components/mesh/MeshStarfield.svelte';
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

  // Selected node for drawer
  let selectedNode: MeshNode | null = null;

  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';
  $: visualTheme = $meshVisualTheme;
  $: layers = $meshLayers;
  $: filters = $meshFilters;
  $: isConstellation = visualTheme === 'constellation';

  async function loadData() {
    loading = true;
    error = '';
    try {
      loadingPhase = 'recipes';
      recipes = await fetchMeshRecipes();
      if (recipes.length === 0) {
        error = 'No recipes found. The network may be slow — please try again.';
        return;
      }

      loadingPhase = 'engagement';
      engagement = await fetchMeshEngagement(recipes);

      const graph = buildMeshGraph(recipes, engagement);
      recipeCount = graph.nodes.filter((n) => n.type === 'recipe').length;
      tagCount = graph.nodes.filter((n) => n.type === 'tag').length;
      connectionCount = graph.edges.filter((e) => e.edgeType === 'recipe-recipe').length;

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

  function handleCloseDrawer() {
    selectedNode = null;
    meshSelectedNodeId.set(null);
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
      {#if isConstellation}
        <MeshStarfield />
      {/if}

      {#if dataReady}
        <CulinaryMesh
          {recipes}
          {engagement}
          {layers}
          {filters}
          {visualTheme}
          bind:this={meshComponent}
          on:settled={handleSettled}
        />
      {/if}

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

      {#if !loading && !error}
        <MeshZoomControls
          onZoomIn={() => meshComponent?.zoomIn()}
          onZoomOut={() => meshComponent?.zoomOut()}
          onResetZoom={() => meshComponent?.resetZoom()}
        />
      {/if}

      {#if selectedNode}
        <MeshDetailDrawer
          node={selectedNode}
          on:close={handleCloseDrawer}
        />
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
</style>
