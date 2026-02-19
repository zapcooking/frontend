<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import {
    forceSimulation,
    forceLink,
    forceManyBody,
    forceCenter,
    forceCollide,
    forceX,
    forceY,
    forceRadial
  } from 'd3-force';
  import type { Simulation, SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { buildMeshGraph, type MeshNode, type MeshEdge, type RecipeNode, type TagNode, type EngagementMap } from '$lib/meshUtils';
  import type { MeshVisualTheme, MeshLayers, MeshFilters } from '$lib/mesh/meshTypes';
  import { setCachedLayout, getCachedLayout, applyCachedLayout } from '$lib/mesh/meshLayout';
  import { theme } from '$lib/themeStore';
  import MeshCanvas from './mesh/MeshCanvas.svelte';
  import MeshNodes from './mesh/MeshNodes.svelte';
  import MeshTooltip from './mesh/MeshTooltip.svelte';

  const dispatch = createEventDispatcher<{ settled: void; nodeSelect: { node: MeshNode } }>();

  export let recipes: NDKEvent[];
  export let engagement: EngagementMap = new Map();
  export let layers: MeshLayers | undefined = undefined;
  export let filters: MeshFilters | undefined = undefined;
  export let visualTheme: MeshVisualTheme = 'default';
  export let showTopEdges: boolean = false;

  // Settling state
  let settled = false;

  // Graph data — use a version counter instead of `nodes = nodes` to trigger Svelte updates
  let nodes: (MeshNode & SimulationNodeDatum)[] = [];
  let edges: (MeshEdge & SimulationLinkDatum<MeshNode & SimulationNodeDatum>)[] = [];
  let nodeVersion = 0; // Bump this to trigger node re-render without full array diff

  // Viewport
  let containerEl: HTMLDivElement;
  let width = 0;
  let height = 0;

  // Zoom & Pan
  let zoom = 1;
  let panX = 0;
  let panY = 0;

  // Pan drag state
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartPanX = 0;
  let panStartPanY = 0;

  // Node drag state
  let draggedNode: (MeshNode & SimulationNodeDatum) | null = null;
  let nodeDragStartX = 0;
  let nodeDragStartY = 0;
  let nodeDragDidMove = false;
  const DRAG_THRESHOLD = 8;

  // Touch state
  let lastTouchDist = 0;

  // Simulation
  let simulation: Simulation<MeshNode & SimulationNodeDatum, MeshEdge & SimulationLinkDatum<MeshNode & SimulationNodeDatum>> | null = null;

  // Hover highlight
  let highlightedNodeId: string | null = null;
  let highlightedNeighborIds: Set<string> = new Set();

  // Tooltip
  let tooltipNode: (RecipeNode & SimulationNodeDatum) | null = null;
  let tooltipX = 0;
  let tooltipY = 0;

  // Resize observer
  let resizeObserver: ResizeObserver | null = null;

  // Safety timeout for settling
  let settleTimeout: ReturnType<typeof setTimeout> | null = null;

  // Hover throttle
  let lastHoverTime = 0;

  // Canvas component reference
  let meshCanvas: MeshCanvas;

  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';
  $: isConstellation = visualTheme === 'constellation';

  // Total section count for horizontal spread
  $: sectionCount = new Set(nodes.filter((n): n is (TagNode & SimulationNodeDatum) => n.type === 'tag').map((n) => n.sectionIndex)).size || 1;

  // ── Pre-computed adjacency list for O(1) neighbor lookups ────────

  let adjacency = new Map<string, Set<string>>();

  function rebuildAdjacency() {
    adjacency = new Map();
    for (const edge of edges) {
      const src = (edge.source as MeshNode & SimulationNodeDatum).id ?? (edge.source as string);
      const tgt = (edge.target as MeshNode & SimulationNodeDatum).id ?? (edge.target as string);
      if (!adjacency.has(src)) adjacency.set(src, new Set());
      if (!adjacency.has(tgt)) adjacency.set(tgt, new Set());
      adjacency.get(src)!.add(tgt);
      adjacency.get(tgt)!.add(src);
    }
  }

  function buildNeighborSet(nodeId: string): Set<string> {
    const neighbors = new Set<string>();
    neighbors.add(nodeId);
    const adj = adjacency.get(nodeId);
    if (adj) {
      for (const id of adj) neighbors.add(id);
    }
    return neighbors;
  }

  // ── Simulation ───────────────────────────────────────────────────

  function initSimulation() {
    const graph = buildMeshGraph(recipes, engagement, layers, filters);
    nodes = graph.nodes as (MeshNode & SimulationNodeDatum)[];
    edges = graph.edges as (MeshEdge & SimulationLinkDatum<MeshNode & SimulationNodeDatum>)[];

    if (nodes.length === 0) return;

    rebuildAdjacency();

    // Try to apply cached layout
    const nodeIds = nodes.map((n) => n.id);
    const cached = getCachedLayout(nodeIds, edges.length);
    if (cached) {
      const allApplied = applyCachedLayout(nodes, cached);
      if (allApplied) {
        settled = true;
        nodeVersion++;
        dispatch('settled');
        return;
      }
    }

    const recipeTagEdges = edges.filter((e) => e.edgeType === 'recipe-tag');
    const recipeRecipeEdges = edges.filter((e) => e.edgeType === 'recipe-recipe');

    simulation = forceSimulation<MeshNode & SimulationNodeDatum>(nodes)
      .force(
        'link-tag',
        forceLink<MeshNode & SimulationNodeDatum, MeshEdge & SimulationLinkDatum<MeshNode & SimulationNodeDatum>>(recipeTagEdges)
          .id((d) => d.id)
          .distance(90)
          .strength(0.4)
      )
      .force(
        'link-recipe',
        forceLink<MeshNode & SimulationNodeDatum, MeshEdge & SimulationLinkDatum<MeshNode & SimulationNodeDatum>>(recipeRecipeEdges)
          .id((d) => d.id)
          .distance(60)
          .strength(0.6)
      )
      .force(
        'charge',
        forceManyBody<MeshNode & SimulationNodeDatum>().strength((d) => {
          if (d.type === 'tag') return 150;
          if (d.type === 'chef') return -20;
          const tier = (d as RecipeNode).tier;
          switch (tier) {
            case 1: return -10;
            case 2: return -25;
            case 3: return -40;
            default: return -30;
          }
        })
      )
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collide',
        forceCollide<MeshNode & SimulationNodeDatum>().radius((d) => {
          if (d.type === 'tag') return 40;
          if (d.type === 'chef') return 30;
          const tier = (d as RecipeNode).tier;
          switch (tier) {
            case 1: return 44;
            case 2: return 30;
            case 3: return 20;
            default: return 20;
          }
        })
      )
      .force(
        'x',
        forceX<MeshNode & SimulationNodeDatum>().x((d) => {
          if (d.type === 'tag') {
            const spread = width * 0.8;
            const offset = width * 0.1;
            return offset + ((d as TagNode).sectionIndex / Math.max(sectionCount - 1, 1)) * spread;
          }
          return width / 2;
        }).strength((d) => {
          if (d.type === 'tag') return 0.1;
          if (d.type === 'chef') return 0.05;
          const tier = (d as RecipeNode).tier;
          switch (tier) {
            case 1: return 0.15;
            case 2: return 0.08;
            case 3: return 0.03;
            default: return 0.05;
          }
        })
      )
      .force(
        'y',
        forceY<MeshNode & SimulationNodeDatum>().y(height / 2).strength((d) => {
          if (d.type === 'tag') return 0.1;
          if (d.type === 'chef') return 0.05;
          const tier = (d as RecipeNode).tier;
          switch (tier) {
            case 1: return 0.15;
            case 2: return 0.08;
            case 3: return 0.03;
            default: return 0.05;
          }
        })
      )
      .force(
        'radial',
        forceRadial<MeshNode & SimulationNodeDatum>(
          Math.min(width, height) * 0.35,
          width / 2,
          height / 2
        ).strength((d) => (d.type === 'recipe' && (d as RecipeNode).tier === 3 ? 0.04 : 0))
      )
      .alphaDecay(0.008)
      .velocityDecay(0.35)
      .on('tick', handleTick);

    settleTimeout = setTimeout(() => {
      if (!settled) forceSettle();
    }, 6000);
  }

  function handleTick() {
    if (!settled) {
      if (simulation && simulation.alpha() < 0.05) {
        forceSettle();
      }
      return;
    }
    // Only bump version during drag (structural change), not every tick
    meshCanvas?.scheduleDrawEdges();
  }

  function forceSettle() {
    if (settled) return;
    if (settleTimeout) {
      clearTimeout(settleTimeout);
      settleTimeout = null;
    }

    if (simulation) {
      simulation.stop();
      // Non-blocking: run ticks in batches yielding to the main thread
      settleAsync();
      return;
    }

    finishSettle();
  }

  function settleAsync() {
    if (!simulation) { finishSettle(); return; }

    const BATCH_SIZE = 50;
    let ticked = 0;
    while (simulation.alpha() > 0.001 && ticked < BATCH_SIZE) {
      simulation.tick();
      ticked++;
    }

    if (simulation.alpha() > 0.001) {
      // Yield to browser, then continue
      setTimeout(settleAsync, 0);
    } else {
      finishSettle();
    }
  }

  function finishSettle() {
    setCachedLayout(nodes, edges.length);
    settled = true;
    nodeVersion++;
    meshCanvas?.scheduleDrawEdges();
    dispatch('settled');
  }

  // ── Screen ↔ Graph coordinate conversion ─────────────────────

  function screenToGraphX(sx: number): number {
    return (sx - panX) / zoom;
  }

  function screenToGraphY(sy: number): number {
    return (sy - panY) / zoom;
  }

  // ── Zoom & Pan ────────────────────────────────────────────────

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newZoom = Math.min(3, Math.max(0.2, zoom * factor));

    const rect = containerEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    panX = mx - ((mx - panX) / zoom) * newZoom;
    panY = my - ((my - panY) / zoom) * newZoom;
    zoom = newZoom;
  }

  function handleContainerMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = panX;
    panStartPanY = panY;
  }

  function handleContainerMouseMove(e: MouseEvent) {
    if (draggedNode) {
      const dx = e.clientX - nodeDragStartX;
      const dy = e.clientY - nodeDragStartY;
      if (!nodeDragDidMove && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
        nodeDragDidMove = true;
        if (simulation) {
          simulation.alphaTarget(0.1).restart();
        }
      }
      if (nodeDragDidMove) {
        const rect = containerEl.getBoundingClientRect();
        draggedNode.fx = screenToGraphX(e.clientX - rect.left);
        draggedNode.fy = screenToGraphY(e.clientY - rect.top);
        nodeVersion++; // Trigger re-render for dragged node position
      }
      return;
    }

    if (!isPanning) return;
    panX = panStartPanX + (e.clientX - panStartX);
    panY = panStartPanY + (e.clientY - panStartY);
  }

  function handleContainerMouseUp() {
    if (draggedNode) {
      if (nodeDragDidMove) {
        draggedNode.fx = null;
        draggedNode.fy = null;
        if (simulation) {
          simulation.alphaTarget(0);
        }
      }
      draggedNode = null;
      nodeDragDidMove = false;
      return;
    }
    isPanning = false;
  }

  // ── Node interaction (passed to MeshNodes) ─────────────────────

  function handleNodeMouseDown(node: MeshNode & SimulationNodeDatum, e: MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    draggedNode = node;
    nodeDragStartX = e.clientX;
    nodeDragStartY = e.clientY;
    nodeDragDidMove = false;
  }

  function handleNodeClick(e: MouseEvent) {
    if (nodeDragDidMove) {
      e.preventDefault();
    }
  }

  function handleNodeEnter(node: MeshNode & SimulationNodeDatum, e: MouseEvent) {
    const now = performance.now();
    if (now - lastHoverTime < 33) return; // 30fps throttle
    lastHoverTime = now;

    highlightedNodeId = node.id;
    highlightedNeighborIds = buildNeighborSet(node.id);

    if (node.type === 'recipe') {
      tooltipNode = node as RecipeNode & SimulationNodeDatum;
      tooltipX = e.clientX;
      tooltipY = e.clientY;
    }
  }

  function handleNodeMove(e: MouseEvent) {
    if (tooltipNode) {
      tooltipX = e.clientX;
      tooltipY = e.clientY;
    }
  }

  function handleNodeLeave() {
    highlightedNodeId = null;
    highlightedNeighborIds = new Set();
    tooltipNode = null;
  }

  // ── Touch ─────────────────────────────────────────────────────

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length === 1) {
      isPanning = true;
      panStartX = e.touches[0].clientX;
      panStartY = e.touches[0].clientY;
      panStartPanX = panX;
      panStartPanY = panY;
    } else if (e.touches.length === 2) {
      isPanning = false;
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }

  function handleTouchMove(e: TouchEvent) {
    if (e.touches.length === 1 && isPanning) {
      panX = panStartPanX + (e.touches[0].clientX - panStartX);
      panY = panStartPanY + (e.touches[0].clientY - panStartY);
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastTouchDist > 0) {
        const factor = dist / lastTouchDist;
        const newZoom = Math.min(3, Math.max(0.2, zoom * factor));

        const rect = containerEl.getBoundingClientRect();
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

        panX = mx - ((mx - panX) / zoom) * newZoom;
        panY = my - ((my - panY) / zoom) * newZoom;
        zoom = newZoom;
      }
      lastTouchDist = dist;
    }
  }

  function handleTouchEnd() {
    isPanning = false;
    lastTouchDist = 0;
  }

  // ── Public zoom controls ──────────────────────────────────────

  export function zoomIn() {
    const newZoom = Math.min(3, zoom * 1.25);
    const cx = width / 2;
    const cy = height / 2;
    panX = cx - ((cx - panX) / zoom) * newZoom;
    panY = cy - ((cy - panY) / zoom) * newZoom;
    zoom = newZoom;
  }

  export function zoomOut() {
    const newZoom = Math.max(0.2, zoom * 0.8);
    const cx = width / 2;
    const cy = height / 2;
    panX = cx - ((cx - panX) / zoom) * newZoom;
    panY = cy - ((cy - panY) / zoom) * newZoom;
    zoom = newZoom;
  }

  export function resetZoom() {
    zoom = 1;
    panX = 0;
    panY = 0;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  onMount(() => {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        width = entry.contentRect.width;
        height = entry.contentRect.height;
      }
    });

    if (containerEl) {
      resizeObserver.observe(containerEl);
      width = containerEl.clientWidth;
      height = containerEl.clientHeight;
      containerEl.addEventListener('wheel', handleWheel, { passive: false });
    }

    requestAnimationFrame(() => {
      if (width > 0 && height > 0) {
        initSimulation();
      }
    });
  });

  onDestroy(() => {
    if (simulation) simulation.stop();
    if (resizeObserver) resizeObserver.disconnect();
    if (settleTimeout) clearTimeout(settleTimeout);
    if (containerEl) containerEl.removeEventListener('wheel', handleWheel);
  });
</script>

<div
  class="mesh-container"
  class:mesh-settled={settled}
  class:constellation={isConstellation}
  style="background: {isConstellation
    ? 'radial-gradient(ellipse at center, rgba(10,12,25,1) 0%, rgba(3,5,15,1) 100%)'
    : isDarkMode
      ? 'radial-gradient(ellipse at center, rgba(20,15,12,1) 0%, rgba(10,8,6,1) 100%)'
      : 'radial-gradient(ellipse at center, rgba(255,252,248,1) 0%, rgba(245,240,235,1) 100%)'};"
  bind:this={containerEl}
  on:mousedown={handleContainerMouseDown}
  on:mousemove={handleContainerMouseMove}
  on:mouseup={handleContainerMouseUp}
  on:mouseleave={handleContainerMouseUp}
  on:touchstart|passive={handleTouchStart}
  on:touchmove={handleTouchMove}
  on:touchend={handleTouchEnd}
  on:touchcancel={handleTouchEnd}
  role="application"
  aria-label="Culinary Mesh visualization"
  style:touch-action="none"
>
  <MeshCanvas
    bind:this={meshCanvas}
    {edges}
    {width}
    {height}
    {panX}
    {panY}
    {zoom}
    {highlightedNodeId}
    {isDarkMode}
    {visualTheme}
    {showTopEdges}
  />

  <MeshNodes
    {nodes}
    {nodeVersion}
    {panX}
    {panY}
    {zoom}
    {width}
    {height}
    {highlightedNodeId}
    {highlightedNeighborIds}
    {draggedNode}
    {isDarkMode}
    {visualTheme}
    onNodeMouseDown={handleNodeMouseDown}
    onNodeClick={handleNodeClick}
    onNodeEnter={handleNodeEnter}
    onNodeMove={handleNodeMove}
    onNodeLeave={handleNodeLeave}
  />

  <MeshTooltip
    {tooltipNode}
    {tooltipX}
    {tooltipY}
    {nodeDragDidMove}
  />
</div>

<style>
  .mesh-container {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    cursor: grab;
    user-select: none;
    opacity: 0;
    transition: opacity 0.6s ease-out;
  }

  .mesh-container.mesh-settled {
    opacity: 1;
  }

  .mesh-container:active {
    cursor: grabbing;
  }
</style>
