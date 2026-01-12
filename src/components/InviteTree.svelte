<script lang="ts">
  import TreeNode from './TreeNode.svelte';
  import type { TreeNodeData } from '$lib/gardenData';

  export let treeData: TreeNodeData[] = [];
  export let loading: boolean = false;
</script>

<div class="invite-tree">
  {#if loading}
    <div class="flex items-center justify-center py-12">
      <div class="text-center">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
        <p class="text-sm" style="color: var(--color-text-secondary)">Loading invite tree...</p>
      </div>
    </div>
  {:else if treeData.length === 0}
    <div class="flex items-center justify-center py-12">
      <p class="text-sm" style="color: var(--color-text-secondary)">No tree data available</p>
    </div>
  {:else}
    <div class="tree-container">
      {#each treeData as rootNode}
        <TreeNode node={rootNode} depth={0} expanded={true} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .invite-tree {
    width: 100%;
  }

  .tree-container {
    padding: 1rem 0;
  }
</style>
