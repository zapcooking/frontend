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
  import { theme } from '$lib/themeStore';

  const dispatch = createEventDispatcher<{ settled: void }>();

  export let recipes: NDKEvent[];
  export let engagement: EngagementMap = new Map();

  // Settling state — mesh is invisible until simulation stabilizes
  let settled = false;

  // Graph data
  let nodes: (MeshNode & SimulationNodeDatum)[] = [];
  let edges: (MeshEdge & SimulationLinkDatum<MeshNode & SimulationNodeDatum>)[] = [];

  // Viewport
  let containerEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;
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

  // RAF handle
  let rafId: number | null = null;

  // Safety timeout for settling
  let settleTimeout: ReturnType<typeof setTimeout> | null = null;

  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';

  // Total section count for horizontal spread
  $: sectionCount = new Set(nodes.filter((n): n is TagNode & SimulationNodeDatum => n.type === 'tag').map((n) => n.sectionIndex)).size || 1;

  // ── Node helpers ─────────────────────────────────────────────────

  function nodeSize(node: MeshNode): number {
    if (node.type === 'tag') return 56;
    switch (node.tier) {
      case 1: return 72;
      case 2: return 48;
      case 3: return 32;
      default: return 32;
    }
  }

  function nodeHalf(node: MeshNode): number {
    return nodeSize(node) / 2;
  }

  function nodeHref(node: MeshNode): string {
    if (node.type === 'recipe') return node.link;
    return `/tag/${node.name}`;
  }

  // ── Highlight helpers ────────────────────────────────────────────

  function buildNeighborSet(nodeId: string): Set<string> {
    const neighbors = new Set<string>();
    neighbors.add(nodeId);
    for (const edge of edges) {
      const src = (edge.source as MeshNode & SimulationNodeDatum).id ?? (edge.source as string);
      const tgt = (edge.target as MeshNode & SimulationNodeDatum).id ?? (edge.target as string);
      if (src === nodeId) neighbors.add(tgt);
      if (tgt === nodeId) neighbors.add(src);
    }
    return neighbors;
  }

  function isEdgeHighlighted(edge: MeshEdge): boolean {
    if (!highlightedNodeId) return false;
    const src = (edge.source as MeshNode & SimulationNodeDatum).id ?? (edge.source as string);
    const tgt = (edge.target as MeshNode & SimulationNodeDatum).id ?? (edge.target as string);
    return src === highlightedNodeId || tgt === highlightedNodeId;
  }

  function nodeOpacity(node: MeshNode): number {
    if (!highlightedNodeId) {
      if (node.type === 'tag') return 1;
      return node.tier === 3 ? 0.65 : 1;
    }
    return highlightedNeighborIds.has(node.id) ? 1 : 0.12;
  }

  // ── Simulation ───────────────────────────────────────────────────

  function initSimulation() {
    const graph = buildMeshGraph(recipes, engagement);
    nodes = graph.nodes as (MeshNode & SimulationNodeDatum)[];
    edges = graph.edges as (MeshEdge & SimulationLinkDatum<MeshNode & SimulationNodeDatum>)[];

    if (nodes.length === 0) return;

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
          switch (d.tier) {
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
          switch (d.tier) {
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
            return offset + (d.sectionIndex / Math.max(sectionCount - 1, 1)) * spread;
          }
          return width / 2;
        }).strength((d) => {
          if (d.type === 'tag') return 0.1;
          switch (d.tier) {
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
          switch (d.tier) {
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
        ).strength((d) => (d.type === 'recipe' && d.tier === 3 ? 0.04 : 0))
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
    // Post-settle: render on each tick (only fires during node drag)
    nodes = nodes;
    scheduleDrawEdges();
  }

  function forceSettle() {
    if (settled) return;
    if (settleTimeout) {
      clearTimeout(settleTimeout);
      settleTimeout = null;
    }

    // Run simulation to completion synchronously — no visible jitter
    if (simulation) {
      simulation.stop();
      while (simulation.alpha() > 0.001) {
        simulation.tick();
      }
    }

    settled = true;
    nodes = nodes;
    scheduleDrawEdges();
    dispatch('settled');
  }

  function scheduleDrawEdges() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      drawEdges();
    });
  }

  function drawEdges() {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = width * dpr;
    const ch = height * dpr;

    if (canvasEl.width !== cw || canvasEl.height !== ch) {
      canvasEl.width = cw;
      canvasEl.height = ch;
    }

    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    const hasHighlight = highlightedNodeId !== null;

    // ── Layer 1: Recipe-tag edges (structural web) ──────────────
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 0.4 / zoom;

    for (const edge of edges) {
      if (edge.edgeType !== 'recipe-tag') continue;
      const source = edge.source as MeshNode & SimulationNodeDatum;
      const target = edge.target as MeshNode & SimulationNodeDatum;
      if (source.x == null || source.y == null || target.x == null || target.y == null) continue;

      if (hasHighlight) {
        const lit = isEdgeHighlighted(edge);
        ctx.strokeStyle = isDarkMode
          ? (lit ? 'rgba(255, 122, 61, 0.25)' : 'rgba(255, 122, 61, 0.02)')
          : (lit ? 'rgba(236, 71, 0, 0.18)' : 'rgba(236, 71, 0, 0.01)');
      } else {
        ctx.strokeStyle = isDarkMode ? 'rgba(255, 122, 61, 0.08)' : 'rgba(236, 71, 0, 0.05)';
      }

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }

    // ── Layer 2: Recipe-recipe edges (community connections) ────
    for (const edge of edges) {
      if (edge.edgeType !== 'recipe-recipe') continue;
      const source = edge.source as MeshNode & SimulationNodeDatum;
      const target = edge.target as MeshNode & SimulationNodeDatum;
      if (source.x == null || source.y == null || target.x == null || target.y == null) continue;

      const lit = !hasHighlight || isEdgeHighlighted(edge);
      const w = edge.weight;
      const lineWidth = (0.5 + w * 0.7) / zoom;

      const mx = (source.x + target.x) / 2;
      const my = (source.y + target.y) / 2;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const offset = Math.min(dist * 0.15, 25);
      const cpx = mx - (dy / dist) * offset;
      const cpy = my + (dx / dist) * offset;

      if (lit && w >= 4) {
        ctx.shadowBlur = 3;
        ctx.shadowColor = isDarkMode ? 'rgba(251, 191, 36, 0.2)' : 'rgba(234, 88, 12, 0.15)';
      } else {
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      }

      if (lit) {
        const alpha = isDarkMode
          ? Math.min(0.15 + w * 0.05, 0.5)
          : Math.min(0.1 + w * 0.04, 0.4);
        const finalAlpha = hasHighlight ? Math.min(alpha * 2.5, 0.9) : alpha;
        ctx.strokeStyle = isDarkMode
          ? `rgba(251, 191, 36, ${finalAlpha})`
          : `rgba(234, 88, 12, ${finalAlpha})`;
      } else {
        ctx.strokeStyle = isDarkMode
          ? 'rgba(251, 191, 36, 0.03)'
          : 'rgba(234, 88, 12, 0.02)';
      }
      ctx.lineWidth = lit ? lineWidth : lineWidth * 0.5;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.quadraticCurveTo(cpx, cpy, target.x, target.y);
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore();
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
    scheduleDrawEdges();
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
    // Node dragging takes priority
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
        nodes = nodes;
        scheduleDrawEdges();
      }
      return;
    }

    // Pan
    if (!isPanning) return;
    panX = panStartPanX + (e.clientX - panStartX);
    panY = panStartPanY + (e.clientY - panStartY);
    scheduleDrawEdges();
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

  // ── Node interaction ──────────────────────────────────────────

  function handleNodeMouseDown(node: MeshNode & SimulationNodeDatum, e: MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation(); // don't start panning
    // Do NOT preventDefault — let native <a> click work
    draggedNode = node;
    nodeDragStartX = e.clientX;
    nodeDragStartY = e.clientY;
    nodeDragDidMove = false;
  }

  function handleNodeClick(e: MouseEvent) {
    // If we were dragging, block the navigation
    if (nodeDragDidMove) {
      e.preventDefault();
    }
    // Otherwise: native <a> click navigates normally
  }

  function handleNodeEnter(node: MeshNode & SimulationNodeDatum, e: MouseEvent) {
    highlightedNodeId = node.id;
    highlightedNeighborIds = buildNeighborSet(node.id);
    scheduleDrawEdges();

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
    scheduleDrawEdges();
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
      scheduleDrawEdges();
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
        scheduleDrawEdges();
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
    scheduleDrawEdges();
  }

  export function zoomOut() {
    const newZoom = Math.max(0.2, zoom * 0.8);
    const cx = width / 2;
    const cy = height / 2;
    panX = cx - ((cx - panX) / zoom) * newZoom;
    panY = cy - ((cy - panY) / zoom) * newZoom;
    zoom = newZoom;
    scheduleDrawEdges();
  }

  export function resetZoom() {
    zoom = 1;
    panX = 0;
    panY = 0;
    scheduleDrawEdges();
  }

  // ── Helper: compute node screen position ──────────────────────

  function nodeScreenX(n: MeshNode & SimulationNodeDatum): number {
    return (n.x || 0) * zoom + panX;
  }

  function nodeScreenY(n: MeshNode & SimulationNodeDatum): number {
    return (n.y || 0) * zoom + panY;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  onMount(() => {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        width = entry.contentRect.width;
        height = entry.contentRect.height;
      }
      if (settled) {
        scheduleDrawEdges();
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
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (settleTimeout) clearTimeout(settleTimeout);
    if (containerEl) containerEl.removeEventListener('wheel', handleWheel);
  });
</script>

<div
  class="mesh-container"
  class:dark-bg={isDarkMode}
  class:light-bg={!isDarkMode}
  class:mesh-settled={settled}
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
  style="touch-action: none;"
>
  <!-- Canvas for edge lines -->
  <canvas
    bind:this={canvasEl}
    class="absolute inset-0 w-full h-full"
    style="pointer-events: none;"
  />

  <!-- HTML overlay for nodes -->
  <div class="absolute inset-0 overflow-hidden" style="pointer-events: none;">
    {#each nodes as node (node.id)}
      {#if node.type === 'recipe'}
        {@const size = nodeSize(node)}
        {@const half = nodeHalf(node)}
        <a
          href={nodeHref(node)}
          class="mesh-recipe-node"
          class:mesh-hero={node.tier === 1}
          class:mesh-notable={node.tier === 2}
          class:mesh-community={node.tier === 3}
          class:mesh-dragging={draggedNode === node}
          style="
            left: 0;
            top: 0;
            width: {size}px;
            height: {size}px;
            transform: translate({nodeScreenX(node) - half}px, {nodeScreenY(node) - half}px);
            opacity: {nodeOpacity(node)};
            pointer-events: auto;
          "
          on:mousedown={(e) => handleNodeMouseDown(node, e)}
          on:click={handleNodeClick}
          on:mouseenter={(e) => handleNodeEnter(node, e)}
          on:mousemove={handleNodeMove}
          on:mouseleave={handleNodeLeave}
          draggable="false"
        >
          <img
            src={node.image}
            alt={node.title}
            class="rounded-full object-cover"
            style="width: 100%; height: 100%; pointer-events: none;"
            loading="lazy"
            draggable="false"
          />
        </a>
      {:else}
        <a
          href={nodeHref(node)}
          class="mesh-tag-node"
          class:mesh-dragging={draggedNode === node}
          style="
            left: 0;
            top: 0;
            transform: translate({nodeScreenX(node) - 28}px, {nodeScreenY(node) - 28}px);
            opacity: {nodeOpacity(node)};
            pointer-events: auto;
          "
          on:mousedown={(e) => handleNodeMouseDown(node, e)}
          on:click={handleNodeClick}
          on:mouseenter={(e) => handleNodeEnter(node, e)}
          on:mousemove={handleNodeMove}
          on:mouseleave={handleNodeLeave}
          draggable="false"
        >
          <div class="mesh-tag-circle" class:dark={isDarkMode}>
            {#if node.emoji}<span class="mesh-tag-emoji">{node.emoji}</span>{/if}
          </div>
          <span class="mesh-tag-label" style="color: var(--color-text-primary);">{node.name}</span>
        </a>
      {/if}
    {/each}
  </div>

  <!-- Tooltip -->
  {#if tooltipNode && !nodeDragDidMove}
    <div
      class="mesh-tooltip"
      style="
        left: {tooltipX + 12}px;
        top: {tooltipY - 30}px;
        background-color: var(--color-bg-secondary);
        color: var(--color-text-primary);
        border: 1px solid var(--color-input-border);
      "
    >
      {#if tooltipNode.tier === 1}<span class="mr-1">🔥</span>{/if}
      {tooltipNode.title}
    </div>
  {/if}
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

  .mesh-container.dark-bg {
    background: radial-gradient(ellipse at center, rgba(20,15,12,1) 0%, rgba(10,8,6,1) 100%);
  }

  .mesh-container.light-bg {
    background: radial-gradient(ellipse at center, rgba(255,252,248,1) 0%, rgba(245,240,235,1) 100%);
  }

  .mesh-container:active {
    cursor: grabbing;
  }

  /* ── Recipe nodes ─────────────────────────────────────────── */

  .mesh-recipe-node {
    position: absolute;
    display: block;
    border-radius: 9999px;
    cursor: pointer;
    transition: opacity 0.2s ease, filter 0.15s ease, transform 0.1s ease;
    text-decoration: none;
  }

  .mesh-recipe-node:hover {
    z-index: 10 !important;
    filter: brightness(1.1);
  }

  .mesh-recipe-node:active {
    filter: brightness(0.95);
    transform: scale(0.95);
  }

  .mesh-recipe-node.mesh-dragging {
    cursor: grabbing;
    z-index: 20 !important;
    filter: brightness(1.15);
  }

  /* Hero (Tier 1) */
  .mesh-hero {
    z-index: 5;
    border: 3px solid rgb(249, 115, 22);
    box-shadow:
      0 0 0 2px rgba(249, 115, 22, 0.8),
      0 0 12px 4px rgba(249, 115, 22, 0.5),
      0 0 24px 8px rgba(249, 115, 22, 0.25);
    animation: hero-pulse 4s ease-in-out infinite;
  }

  /* Notable (Tier 2) */
  .mesh-notable {
    z-index: 3;
    border: 2px solid rgba(249, 115, 22, 0.5);
    box-shadow: 0 0 8px 2px rgba(249, 115, 22, 0.15);
  }

  /* Community (Tier 3) */
  .mesh-community {
    z-index: 1;
    border: 1px solid var(--color-input-border);
  }

  @keyframes hero-pulse {
    0%, 100% {
      box-shadow:
        0 0 0 2px rgba(249, 115, 22, 0.8),
        0 0 12px 4px rgba(249, 115, 22, 0.5),
        0 0 24px 8px rgba(249, 115, 22, 0.25);
    }
    50% {
      box-shadow:
        0 0 0 3px rgba(249, 115, 22, 0.9),
        0 0 18px 6px rgba(249, 115, 22, 0.6),
        0 0 32px 12px rgba(249, 115, 22, 0.3);
    }
  }

  /* ── Tag nodes ────────────────────────────────────────────── */

  .mesh-tag-node {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    z-index: 2;
    cursor: pointer;
    transition: opacity 0.2s ease, filter 0.15s ease;
    text-decoration: none;
  }

  .mesh-tag-node:hover {
    z-index: 10 !important;
    filter: brightness(1.1);
  }

  .mesh-tag-node:hover .mesh-tag-circle {
    border-color: rgba(249, 115, 22, 0.6);
    background-color: rgba(249, 115, 22, 0.15);
  }

  .mesh-tag-node:active .mesh-tag-circle {
    transform: scale(0.93);
    background-color: rgba(249, 115, 22, 0.2);
  }

  .mesh-tag-node.mesh-dragging {
    cursor: grabbing;
    z-index: 20 !important;
  }

  .mesh-tag-circle {
    width: 56px;
    height: 56px;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(249, 115, 22, 0.08);
    border: 1px solid rgba(249, 115, 22, 0.2);
    transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
  }

  .mesh-tag-circle.dark {
    background-color: rgba(249, 115, 22, 0.12);
    border-color: rgba(249, 115, 22, 0.25);
  }

  .mesh-tag-emoji {
    font-size: 22px;
    line-height: 1;
  }

  .mesh-tag-label {
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
  }

  /* ── Tooltip ──────────────────────────────────────────────── */

  .mesh-tooltip {
    position: fixed;
    z-index: 100;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 13px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
</style>
