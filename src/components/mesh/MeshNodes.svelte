<script lang="ts">
  import type { MeshNode, RecipeNode, TagNode, ChefNode, MeshVisualTheme, SimMeshNode } from '$lib/mesh/meshTypes';
  import type { SimulationNodeDatum } from 'd3-force';
  import { getViewportBounds, isInViewport } from '$lib/mesh/meshViewport';
  import { membershipStatusMap, queueMembershipLookup } from '$lib/stores/membershipStatus';
  import Avatar from '../Avatar.svelte';

  export let nodes: (MeshNode & SimulationNodeDatum)[] = [];
  export let nodeVersion: number = 0;
  export let panX: number;
  export let panY: number;
  export let zoom: number;
  export let width: number;
  export let height: number;
  export let highlightedNodeId: string | null = null;
  export let highlightedNeighborIds: Set<string> = new Set();
  export let draggedNode: (MeshNode & SimulationNodeDatum) | null = null;
  export let isDarkMode: boolean = false;
  export let visualTheme: MeshVisualTheme = 'default';

  // Event handlers are passed as callbacks
  export let onNodeMouseDown: (node: MeshNode & SimulationNodeDatum, e: MouseEvent) => void = () => {};
  export let onNodeClick: (e: MouseEvent) => void = () => {};
  export let onNodeEnter: (node: MeshNode & SimulationNodeDatum, e: MouseEvent) => void = () => {};
  export let onNodeMove: (e: MouseEvent) => void = () => {};
  export let onNodeLeave: () => void = () => {};

  $: membershipMap = $membershipStatusMap;

  // Compute visible nodes — depends on nodeVersion to pick up position changes
  // Using void to register nodeVersion as a dependency without triggering unused-expression errors
  $: bounds = (void nodeVersion, getViewportBounds(panX, panY, zoom, width, height));
  $: visibleNodes = (void nodeVersion, nodes.filter((node) => isInViewport(node, bounds)));

  // Queue membership lookups only when nodes structurally change, not on every pan
  let membershipQueued = new Set<string>();
  $: {
    // Only react to node array identity changes, not viewport changes
    void nodes;
    for (const node of nodes) {
      if (node.type === 'recipe' && node.pubkey && !membershipQueued.has(node.pubkey)) {
        membershipQueued.add(node.pubkey);
        queueMembershipLookup(node.pubkey);
      }
    }
  }

  function nodeSize(node: MeshNode): number {
    if (node.type === 'tag') return 56;
    if (node.type === 'chef') return 48;
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
    if (node.type === 'tag') return `/tag/${node.name}`;
    return '#';
  }

  function nodeOpacity(node: MeshNode): number {
    if (!highlightedNodeId) {
      if (node.type === 'tag' || node.type === 'chef') return 1;
      return node.tier === 3 ? 0.65 : 1;
    }
    return highlightedNeighborIds.has(node.id) ? 1 : 0.12;
  }

  function nodeScreenX(n: MeshNode & SimulationNodeDatum): number {
    return (n.x || 0) * zoom + panX;
  }

  function nodeScreenY(n: MeshNode & SimulationNodeDatum): number {
    return (n.y || 0) * zoom + panY;
  }

  // LOD: determine if node should show image based on zoom + tier
  function shouldShowImage(node: MeshNode): boolean {
    if (node.type !== 'recipe') return false;
    if (zoom < 0.6) return false;
    if (zoom < 0.8) return node.tier <= 2;
    return true;
  }

  function getMembershipGlow(node: MeshNode): string {
    if (node.type !== 'recipe' || !node.pubkey) return '';
    const status = membershipMap[node.pubkey];
    if (!status?.active) return '';
    switch (status.tier) {
      case 'founders':
        return '0 0 0 2px rgba(255,215,0,0.85), 0 0 8px 3px rgba(255,215,0,0.4)';
      case 'pro_kitchen':
        return '0 0 0 2px rgba(139,92,246,0.8), 0 0 8px 3px rgba(139,92,246,0.4)';
      case 'cook_plus':
        return '0 0 0 2px rgba(249,115,22,0.8), 0 0 8px 3px rgba(249,115,22,0.4)';
      default:
        return '';
    }
  }

  function hasMembershipPulse(node: MeshNode): boolean {
    if (node.type !== 'recipe' || !node.pubkey) return false;
    const status = membershipMap[node.pubkey];
    if (!status?.active) return false;
    return status.tier === 'founders' || status.tier === 'pro_kitchen';
  }

  $: isConstellation = visualTheme === 'constellation';
</script>

<div class="absolute inset-0 overflow-hidden" style="pointer-events: none;">
  {#each visibleNodes as node (node.id)}
    {#if node.type === 'recipe'}
      {@const size = nodeSize(node)}
      {@const half = nodeHalf(node)}
      {@const memberGlow = getMembershipGlow(node)}
      <a
        href={nodeHref(node)}
        class="mesh-recipe-node"
        class:mesh-hero={node.tier === 1}
        class:mesh-notable={node.tier === 2}
        class:mesh-community={node.tier === 3}
        class:mesh-dragging={draggedNode === node}
        class:mesh-constellation={isConstellation}
        class:mesh-membership-pulse={hasMembershipPulse(node)}
        style="
          left: 0;
          top: 0;
          width: {size}px;
          height: {size}px;
          transform: translate({nodeScreenX(node) - half}px, {nodeScreenY(node) - half}px);
          opacity: {nodeOpacity(node)};
          pointer-events: auto;
          {memberGlow ? `box-shadow: ${memberGlow};` : ''}
        "
        on:mousedown={(e) => onNodeMouseDown(node, e)}
        on:click={onNodeClick}
        on:mouseenter={(e) => onNodeEnter(node, e)}
        on:mousemove={onNodeMove}
        on:mouseleave={onNodeLeave}
        draggable="false"
        aria-label="{node.title} recipe"
      >
        {#if shouldShowImage(node)}
          <img
            src={node.image}
            alt={node.title}
            class="rounded-full object-cover"
            style="width: 100%; height: 100%; pointer-events: none;"
            loading="lazy"
            draggable="false"
          />
        {:else}
          <div
            class="rounded-full"
            style="
              width: 100%;
              height: 100%;
              background: {isConstellation ? 'rgba(180, 200, 240, 0.3)' : 'rgba(249, 115, 22, 0.3)'};
            "
          />
        {/if}
        {#if node.isGated}
          <span class="mesh-gated-badge" aria-label="Lightning-gated recipe">&#9889;</span>
        {/if}
      </a>
    {:else if node.type === 'tag'}
      <a
        href={nodeHref(node)}
        class="mesh-tag-node"
        class:mesh-dragging={draggedNode === node}
        class:mesh-constellation={isConstellation}
        style="
          left: 0;
          top: 0;
          transform: translate({nodeScreenX(node) - 28}px, {nodeScreenY(node) - 28}px);
          opacity: {nodeOpacity(node)};
          pointer-events: auto;
        "
        on:mousedown={(e) => onNodeMouseDown(node, e)}
        on:click={onNodeClick}
        on:mouseenter={(e) => onNodeEnter(node, e)}
        on:mousemove={onNodeMove}
        on:mouseleave={onNodeLeave}
        draggable="false"
        aria-label="{node.name} tag"
      >
        <div class="mesh-tag-circle" class:dark={isDarkMode} class:constellation={isConstellation}>
          {#if node.emoji}<span class="mesh-tag-emoji">{node.emoji}</span>{/if}
        </div>
        <span class="mesh-tag-label" style="color: {isConstellation ? 'rgba(180, 200, 240, 0.7)' : 'var(--color-text-primary)'};">{node.name}</span>
      </a>
    {:else if node.type === 'chef'}
      <div
        class="mesh-chef-node"
        class:mesh-dragging={draggedNode === node}
        style="
          left: 0;
          top: 0;
          transform: translate({nodeScreenX(node) - 24}px, {nodeScreenY(node) - 24}px);
          opacity: {nodeOpacity(node)};
          pointer-events: auto;
        "
        on:mousedown={(e) => onNodeMouseDown(node, e)}
        on:mouseenter={(e) => onNodeEnter(node, e)}
        on:mousemove={onNodeMove}
        on:mouseleave={onNodeLeave}
        role="button"
        tabindex="0"
        aria-label="{node.displayName || 'Chef'}"
      >
        <Avatar pubkey={node.pubkey} size={48} showRing={true} />
      </div>
    {/if}
  {/each}
</div>

<style>
  /* ── Recipe nodes ─────────────────────────────────────────── */

  .mesh-recipe-node {
    position: absolute;
    display: block;
    border-radius: 9999px;
    cursor: pointer;
    transition: opacity 0.2s ease, filter 0.15s ease;
    text-decoration: none;
  }

  .mesh-recipe-node:hover {
    z-index: 10 !important;
    filter: brightness(1.1);
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

  .mesh-hero.mesh-constellation {
    border-color: rgba(220, 230, 255, 0.9);
    box-shadow:
      0 0 0 2px rgba(200, 220, 255, 0.7),
      0 0 12px 4px rgba(200, 220, 255, 0.4),
      0 0 24px 8px rgba(200, 220, 255, 0.2);
    animation: hero-pulse-constellation 4s ease-in-out infinite;
  }

  /* Notable (Tier 2) */
  .mesh-notable {
    z-index: 3;
    border: 2px solid rgba(249, 115, 22, 0.5);
    box-shadow: 0 0 8px 2px rgba(249, 115, 22, 0.15);
  }

  .mesh-notable.mesh-constellation {
    border-color: rgba(180, 200, 240, 0.5);
    box-shadow: 0 0 8px 2px rgba(180, 200, 240, 0.2);
  }

  /* Community (Tier 3) */
  .mesh-community {
    z-index: 1;
    border: 1px solid var(--color-input-border);
  }

  .mesh-community.mesh-constellation {
    border-color: rgba(140, 160, 200, 0.3);
  }

  /* Membership pulse for Pro/Founders recipe nodes */
  .mesh-membership-pulse {
    animation: membership-glow-pulse 3s ease-in-out infinite;
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

  @keyframes hero-pulse-constellation {
    0%, 100% {
      box-shadow:
        0 0 0 2px rgba(200, 220, 255, 0.7),
        0 0 12px 4px rgba(200, 220, 255, 0.4),
        0 0 24px 8px rgba(200, 220, 255, 0.2);
    }
    50% {
      box-shadow:
        0 0 0 3px rgba(200, 220, 255, 0.8),
        0 0 18px 6px rgba(200, 220, 255, 0.5),
        0 0 32px 12px rgba(200, 220, 255, 0.25);
    }
  }

  @keyframes membership-glow-pulse {
    0%, 100% { filter: brightness(1); }
    50% { filter: brightness(1.08); }
  }

  /* ── Lightning-gated badge ─────────────────────────────────── */

  .mesh-gated-badge {
    position: absolute;
    bottom: -2px;
    right: -2px;
    font-size: 12px;
    line-height: 1;
    filter: drop-shadow(0 0 3px rgba(251, 191, 36, 0.6));
    animation: gated-pulse 3s ease-in-out infinite;
  }

  @keyframes gated-pulse {
    0%, 100% { opacity: 0.8; }
    50% { opacity: 1; }
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

  .mesh-tag-node.mesh-constellation:hover .mesh-tag-circle {
    border-color: rgba(180, 200, 240, 0.5);
    background-color: rgba(180, 200, 240, 0.15);
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
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }

  .mesh-tag-circle.dark {
    background-color: rgba(249, 115, 22, 0.12);
    border-color: rgba(249, 115, 22, 0.25);
  }

  .mesh-tag-circle.constellation {
    background-color: rgba(180, 200, 240, 0.08);
    border-color: rgba(180, 200, 240, 0.25);
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

  /* ── Chef nodes ───────────────────────────────────────────── */

  .mesh-chef-node {
    position: absolute;
    z-index: 4;
    cursor: pointer;
    transition: opacity 0.2s ease, filter 0.15s ease;
  }

  .mesh-chef-node:hover {
    z-index: 10 !important;
    filter: brightness(1.1);
  }

  .mesh-chef-node.mesh-dragging {
    cursor: grabbing;
    z-index: 20 !important;
  }
</style>
