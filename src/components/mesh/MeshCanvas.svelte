<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { MeshEdge, MeshVisualTheme, SimMeshNode } from '$lib/mesh/meshTypes';
  import { getEdgeColors } from '$lib/mesh/meshTheme';
  import { getViewportBounds, isEdgeVisible } from '$lib/mesh/meshViewport';

  export let edges: MeshEdge[] = [];
  export let width: number;
  export let height: number;
  export let panX: number;
  export let panY: number;
  export let zoom: number;
  export let highlightedNodeId: string | null = null;
  export let isDarkMode: boolean = false;
  export let visualTheme: MeshVisualTheme = 'default';
  export let showTopEdges: boolean = false;

  let canvasEl: HTMLCanvasElement;
  let rafId: number | null = null;

  function isEdgeHighlighted(edge: MeshEdge): boolean {
    if (!highlightedNodeId) return false;
    const src = (edge.source as SimMeshNode).id ?? (edge.source as string);
    const tgt = (edge.target as SimMeshNode).id ?? (edge.target as string);
    return src === highlightedNodeId || tgt === highlightedNodeId;
  }

  export function scheduleDrawEdges() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      drawEdges();
    });
  }

  export function drawEdges() {
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

    const hasHighlight = highlightedNodeId !== null;

    // Skip all edge drawing when nothing to show
    if (!hasHighlight && !showTopEdges) {
      return;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    const colors = getEdgeColors(visualTheme, isDarkMode);
    const bounds = getViewportBounds(panX, panY, zoom, width, height);
    const useConstellation = visualTheme === 'constellation';
    const invZoom = 1 / zoom;

    // Single pass over all edges — sort by type inline
    for (const edge of edges) {
      if (!isEdgeVisible(edge, bounds)) continue;

      const source = edge.source as SimMeshNode;
      const target = edge.target as SimMeshNode;
      if (source.x == null || source.y == null || target.x == null || target.y == null) continue;

      const edgeType = edge.edgeType;

      if (edgeType === 'recipe-tag') {
        ctx.shadowBlur = 0;
        ctx.lineWidth = 0.4 * invZoom;

        if (hasHighlight) {
          const lit = isEdgeHighlighted(edge);
          ctx.strokeStyle = lit ? colors.recipeTagHighlight : colors.recipeTagDim;
        } else {
          ctx.strokeStyle = colors.recipeTagBase;
        }

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      } else if (edgeType === 'recipe-recipe') {
        const lit = !hasHighlight || isEdgeHighlighted(edge);
        const w = edge.weight;
        const lineWidth = (0.5 + w * 0.7) * invZoom;

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
          ctx.shadowColor = colors.recipeRecipeGlow;
        } else {
          ctx.shadowBlur = 0;
        }

        if (lit) {
          const alpha = useConstellation
            ? Math.min(0.12 + w * 0.06, 0.5)
            : isDarkMode
              ? Math.min(0.15 + w * 0.05, 0.5)
              : Math.min(0.1 + w * 0.04, 0.4);
          const finalAlpha = hasHighlight ? Math.min(alpha * 2.5, 0.9) : alpha;

          if (useConstellation) {
            ctx.strokeStyle = `rgba(180, 200, 240, ${finalAlpha})`;
          } else if (isDarkMode) {
            ctx.strokeStyle = `rgba(251, 191, 36, ${finalAlpha})`;
          } else {
            ctx.strokeStyle = `rgba(234, 88, 12, ${finalAlpha})`;
          }
        } else {
          if (useConstellation) {
            ctx.strokeStyle = 'rgba(180, 200, 240, 0.02)';
          } else {
            ctx.strokeStyle = isDarkMode
              ? 'rgba(251, 191, 36, 0.03)'
              : 'rgba(234, 88, 12, 0.02)';
          }
        }
        ctx.lineWidth = lit ? lineWidth : lineWidth * 0.5;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.quadraticCurveTo(cpx, cpy, target.x, target.y);
        ctx.stroke();
      } else if (edgeType === 'recipe-chef') {
        ctx.shadowBlur = 0;

        if (hasHighlight) {
          const lit = isEdgeHighlighted(edge);
          ctx.strokeStyle = lit
            ? (useConstellation ? 'rgba(180, 200, 240, 0.3)' : 'rgba(139, 92, 246, 0.35)')
            : 'rgba(139, 92, 246, 0.02)';
        } else {
          ctx.strokeStyle = useConstellation ? 'rgba(180, 200, 240, 0.06)' : 'rgba(139, 92, 246, 0.08)';
        }

        ctx.lineWidth = 0.6 * invZoom;
        const dashLen = 4 * invZoom;
        ctx.setLineDash([dashLen, dashLen]);
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore();
  }

  // Reactive redraw when inputs change
  // Each dependency is explicitly listed so Svelte tracks them properly
  $: edges, panX, panY, zoom, highlightedNodeId, isDarkMode, visualTheme, showTopEdges,
     canvasEl && width > 0 && height > 0 && scheduleDrawEdges();

  onDestroy(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
  });
</script>

<canvas
  bind:this={canvasEl}
  class="absolute inset-0 w-full h-full"
  style="pointer-events: none;"
/>
