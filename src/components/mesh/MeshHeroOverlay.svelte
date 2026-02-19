<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { MeshNode, MeshEdge, RecipeNode } from '$lib/mesh/meshTypes';
  import { theme } from '$lib/themeStore';

  export let nodes: MeshNode[] = [];
  export let edges: MeshEdge[] = [];
  export let ready: boolean = false;

  let canvasEl: HTMLCanvasElement;
  let containerEl: HTMLDivElement;
  let nodesContainerEl: HTMLDivElement;
  let width = 0;
  let height = 0;
  let rafId: number | null = null;
  let driftTime = 0;
  let resizeObserver: ResizeObserver | null = null;

  $: resolvedTheme = $theme === 'system' ? theme.getResolvedTheme() : $theme;
  $: isDarkMode = resolvedTheme === 'dark';

  // Stable phase data — only regenerate when node IDs actually change
  type NodePhaseData = { _phase: number; _driftAmplitudeX: number; _driftAmplitudeY: number };
  let phaseMap = new Map<string, NodePhaseData>();
  let stableNodes: (MeshNode & NodePhaseData)[] = [];

  // Pre-built node lookup map for O(1) edge resolution
  let nodeMap = new Map<string, MeshNode & NodePhaseData>();

  // Cached DOM element references — rebuilt once when nodes change
  let cachedNodeEls: HTMLElement[] | null = null;

  $: {
    // Only rebuild phases for nodes we haven't seen before
    let changed = false;
    for (const n of nodes) {
      if (!phaseMap.has(n.id)) {
        phaseMap.set(n.id, {
          _phase: Math.random() * Math.PI * 2,
          _driftAmplitudeX: 2 + Math.random() * 3,
          _driftAmplitudeY: 1.5 + Math.random() * 2.5
        });
        changed = true;
      }
    }
    // Always rebuild stableNodes when nodes array changes (identity check by Svelte)
    stableNodes = nodes.map((n) => ({ ...n, ...phaseMap.get(n.id)! }));

    // Rebuild the lookup map
    nodeMap = new Map();
    for (const n of stableNodes) {
      nodeMap.set(n.id, n);
    }

    // Invalidate cached DOM refs when nodes change structurally
    cachedNodeEls = null;
  }

  function nodeSize(node: MeshNode): number {
    if (node.type === 'tag') return 44;
    if (node.type === 'chef') return 36;
    switch ((node as RecipeNode).tier) {
      case 1: return 56;
      case 2: return 38;
      case 3: return 26;
      default: return 26;
    }
  }

  // Pre-compute half sizes to avoid recalculating every frame
  let halfSizes: number[] = [];
  $: halfSizes = stableNodes.map((n) => nodeSize(n) / 2);

  // Compute offset to center the node cluster within the actual container.
  // The simulation positions nodes around a fixed center (300, 250),
  // so we find the bounding-box midpoint and shift everything to the container center.
  let offsetX = 0;
  let offsetY = 0;

  $: if (stableNodes.length > 0 && width > 0 && height > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of stableNodes) {
      if (n.x == null || n.y == null) continue;
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    if (minX !== Infinity) {
      offsetX = width / 2 - (minX + maxX) / 2;
      offsetY = height / 2 - (minY + maxY) / 2;
    }
  }

  function animationLoop() {
    if (!canvasEl || !ready) {
      rafId = requestAnimationFrame(animationLoop);
      return;
    }

    driftTime += 0.0005;

    const ox = offsetX;
    const oy = offsetY;

    // Draw edges on canvas
    const ctx = canvasEl.getContext('2d');
    if (ctx) {
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

      ctx.lineWidth = 0.5;
      ctx.strokeStyle = isDarkMode ? 'rgba(255, 122, 61, 0.06)' : 'rgba(236, 71, 0, 0.04)';

      // Batch all edges into a single path for one stroke call
      ctx.beginPath();
      for (const edge of edges) {
        const srcId = typeof edge.source === 'string' ? edge.source : (edge.source as MeshNode).id;
        const tgtId = typeof edge.target === 'string' ? edge.target : (edge.target as MeshNode).id;
        const source = nodeMap.get(srcId);
        const target = nodeMap.get(tgtId);

        if (!source || !target || source.x == null || source.y == null || target.x == null || target.y == null) continue;

        const sx = source.x + ox + Math.sin(driftTime + source._phase) * source._driftAmplitudeX;
        const sy = source.y + oy + Math.cos(driftTime * 0.7 + source._phase) * source._driftAmplitudeY;
        const tx = target.x + ox + Math.sin(driftTime + target._phase) * target._driftAmplitudeX;
        const ty = target.y + oy + Math.cos(driftTime * 0.7 + target._phase) * target._driftAmplitudeY;

        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
      }
      ctx.stroke();

      ctx.restore();
    }

    // Update node positions via direct DOM manipulation
    // Cache DOM refs — only query once after mount / node change
    if (!cachedNodeEls && nodesContainerEl) {
      cachedNodeEls = Array.from(nodesContainerEl.querySelectorAll('.hero-node'));
    }
    if (cachedNodeEls) {
      for (let i = 0; i < stableNodes.length && i < cachedNodeEls.length; i++) {
        const n = stableNodes[i];
        if (n.x == null || n.y == null) continue;
        const dx = Math.sin(driftTime + n._phase) * n._driftAmplitudeX;
        const dy = Math.cos(driftTime * 0.7 + n._phase) * n._driftAmplitudeY;
        cachedNodeEls[i].style.transform = `translate(${n.x + ox + dx - halfSizes[i]}px, ${n.y + oy + dy - halfSizes[i]}px)`;
      }
    }

    rafId = requestAnimationFrame(animationLoop);
  }

  function scrollToRecipes() {
    const section = document.querySelector('[data-section="fresh-kitchen"]');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth' });
    }
  }

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
    }

    rafId = requestAnimationFrame(animationLoop);
  });

  onDestroy(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (resizeObserver) resizeObserver.disconnect();
  });
</script>

<div
  class="mesh-hero"
  class:dark={isDarkMode}
  class:ready
  bind:this={containerEl}
>
  <!-- Canvas for edges -->
  <canvas
    bind:this={canvasEl}
    class="hero-canvas"
  />

  <!-- Nodes overlay -->
  <div class="hero-nodes" bind:this={nodesContainerEl}>
    {#each stableNodes as node, i (node.id)}
      {@const size = nodeSize(node)}
      {#if node.type === 'recipe'}
        <div
          class="hero-node hero-recipe-node"
          class:tier-1={node.tier === 1}
          class:tier-2={node.tier === 2}
          class:tier-3={node.tier === 3}
          style="
            width: {size}px;
            height: {size}px;
            left: 0;
            top: 0;
            transform: translate({(node.x || 0) + offsetX - size / 2}px, {(node.y || 0) + offsetY - size / 2}px);
          "
        >
          <img
            src={node.image}
            alt=""
            class="rounded-full object-cover"
            style="width: 100%; height: 100%;"
            loading="lazy"
            draggable="false"
          />
        </div>
      {:else if node.type === 'tag'}
        <div
          class="hero-node hero-tag-node"
          style="
            left: 0;
            top: 0;
            transform: translate({(node.x || 0) + offsetX - 22}px, {(node.y || 0) + offsetY - 22}px);
          "
        >
          <div class="hero-tag-circle" class:dark={isDarkMode}>
            {#if node.emoji}<span class="text-lg">{node.emoji}</span>{/if}
          </div>
        </div>
      {/if}
    {/each}
  </div>

  <!-- Centered overlay content -->
  <div class="hero-overlay">
    <h1 class="hero-title" style="color: {isDarkMode ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.9)'};">
      Culinary Mesh
    </h1>
    <div class="hero-ctas">
      <a href="/mesh" class="hero-cta-primary">
        Explore the Mesh
      </a>
      <button class="hero-cta-secondary" on:click={scrollToRecipes}>
        I'm Hungry
      </button>
    </div>
  </div>

</div>

<style>
  .mesh-hero {
    position: relative;
    height: 30vh;
    min-height: 200px;
    max-height: 280px;
    overflow: hidden;
    border-radius: 16px;
    background: radial-gradient(ellipse at center, rgba(255,252,248,1) 0%, rgba(245,240,235,1) 100%);
    opacity: 0;
    transition: opacity 0.8s ease-out;
  }

  .mesh-hero.dark {
    background: radial-gradient(ellipse at center, rgba(20,15,12,1) 0%, rgba(10,8,6,1) 100%);
  }

  .mesh-hero.ready {
    opacity: 1;
  }

  .hero-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .hero-nodes {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .hero-node {
    position: absolute;
    border-radius: 9999px;
    pointer-events: none;
  }

  .hero-recipe-node {
    border: 1px solid var(--color-input-border);
    opacity: 0.7;
  }

  .hero-recipe-node.tier-1 {
    border: 2px solid rgb(249, 115, 22);
    box-shadow: 0 0 8px 2px rgba(249, 115, 22, 0.3);
    opacity: 0.9;
  }

  .hero-recipe-node.tier-2 {
    border: 1.5px solid rgba(249, 115, 22, 0.4);
    opacity: 0.8;
  }

  .hero-recipe-node.tier-3 {
    opacity: 0.5;
  }

  .hero-tag-node {
    opacity: 0.6;
  }

  .hero-tag-circle {
    width: 44px;
    height: 44px;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(249, 115, 22, 0.06);
    border: 1px solid rgba(249, 115, 22, 0.15);
  }

  .hero-tag-circle.dark {
    background-color: rgba(249, 115, 22, 0.1);
    border-color: rgba(249, 115, 22, 0.2);
  }

  /* Overlay */
  .hero-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 5;
    pointer-events: none;
    text-align: center;
    padding: 1rem;
  }

  .hero-title {
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    text-shadow: 0 2px 20px rgba(0, 0, 0, 0.1);
  }

  .hero-ctas {
    display: flex;
    gap: 12px;
    margin-top: 1.25rem;
    pointer-events: auto;
  }

  .hero-cta-primary {
    padding: 10px 24px;
    border-radius: 999px;
    background-color: var(--color-primary);
    color: white;
    font-weight: 600;
    font-size: 14px;
    text-decoration: none;
    transition: opacity 0.15s;
    box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3);
  }

  .hero-cta-primary:hover {
    opacity: 0.9;
  }

  .hero-cta-secondary {
    padding: 10px 24px;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(8px);
    color: var(--color-text-primary);
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .hero-cta-secondary:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  @media (max-width: 640px) {
    .mesh-hero {
      height: 25vh;
      min-height: 160px;
      border-radius: 12px;
    }

    .hero-title {
      font-size: 1.5rem;
    }

    .hero-ctas {
      flex-direction: column;
      gap: 8px;
    }
  }
</style>
