<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import type { TreeNodeData } from '$lib/gardenData';

  export let node: TreeNodeData;
  export let depth: number = 0;
  export let expanded: boolean = true;

  const MAX_DEPTH = 10; // Prevent infinite recursion

  function toggleExpanded() {
    if (node.children.length > 0) {
      expanded = !expanded;
    }
  }

  function handleNodeClick() {
    const npub = nip19.npubEncode(node.pubkey);
    goto(`/user/${npub}`);
  }
</script>

<div class="tree-node" style="margin-left: {depth * 1.5}rem;">
  <div 
    class="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-accent-gray transition-colors cursor-pointer" 
    role="button"
    tabindex="0"
    on:click={handleNodeClick}
    on:keydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleNodeClick();
      }
    }}
  >
    {#if node.children.length > 0}
      <button
        type="button"
        class="flex-shrink-0 w-5 h-5 flex items-center justify-center text-caption hover:text-text-primary transition-colors"
        on:click|stopPropagation={toggleExpanded}
        aria-label={expanded ? 'Collapse' : 'Expand'}
      >
        {#if expanded}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        {:else}
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        {/if}
      </button>
    {:else}
      <div class="w-5 h-5"></div>
    {/if}
    
    <div class="flex-shrink-0">
      <CustomAvatar pubkey={node.pubkey} size={40} />
    </div>
    
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2">
        <span class="font-medium text-sm truncate" style="color: var(--color-text-primary)">
          <CustomName pubkey={node.pubkey} />
        </span>
        {#if node.isRoot}
          <span class="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
            root
          </span>
        {/if}
      </div>
    </div>
  </div>

  {#if expanded && node.children.length > 0 && depth < MAX_DEPTH}
    <div class="tree-children">
      {#each node.children as child}
        <svelte:self node={child} depth={depth + 1} expanded={true} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .tree-node {
    position: relative;
  }

  .tree-children {
    position: relative;
    margin-left: 1rem;
    padding-left: 1rem;
    border-left: 1px solid var(--color-input-border);
  }

  .tree-children::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--color-input-border);
  }
</style>
