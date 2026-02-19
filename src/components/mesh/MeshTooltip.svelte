<script lang="ts">
  import type { RecipeNode } from '$lib/mesh/meshTypes';
  import type { SimulationNodeDatum } from 'd3-force';

  export let tooltipNode: (RecipeNode & SimulationNodeDatum) | null = null;
  export let tooltipX: number = 0;
  export let tooltipY: number = 0;
  export let nodeDragDidMove: boolean = false;
</script>

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
    role="tooltip"
  >
    {#if tooltipNode.tier === 1}<span class="mr-1">&#128293;</span>{/if}
    {tooltipNode.title}
  </div>
{/if}

<style>
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
