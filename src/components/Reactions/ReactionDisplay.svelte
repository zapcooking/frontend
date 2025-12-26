<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ReactionGroup } from '$lib/types/reactions';

  export let groups: ReactionGroup[] = [];
  export let compact = false;

  const dispatch = createEventDispatcher<{
    reactionClick: { emoji: string; userReacted: boolean };
  }>();

  function handleClick(group: ReactionGroup) {
    dispatch('reactionClick', { emoji: group.emoji, userReacted: group.userReacted });
  }
</script>

{#if groups.length > 0}
  <div class="flex flex-wrap gap-1 {compact ? 'text-sm' : ''}">
    {#each groups as group}
      <button
        type="button"
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border transition-colors cursor-pointer {group.userReacted
          ? 'bg-primary text-white border-primary'
          : 'bg-input border-transparent hover:border-gray-300'}"
        style={!group.userReacted ? 'border-color: var(--color-input-border);' : ''}
        on:click={() => handleClick(group)}
        title={group.userReacted ? `Remove ${group.emoji} reaction` : `React with ${group.emoji}`}
      >
        <span class={compact ? 'text-base' : 'text-lg'}>{group.emoji}</span>
        <span class="font-medium {compact ? 'text-xs' : 'text-sm'}">{group.count}</span>
      </button>
    {/each}
  </div>
{/if}
