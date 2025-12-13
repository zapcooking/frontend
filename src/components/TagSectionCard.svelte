<script lang="ts">
  import { slide } from 'svelte/transition';
  import type { recipeTagSimple } from '$lib/consts';
  import TagChip from './TagChip.svelte';
  import ChevronDown from 'phosphor-svelte/lib/CaretDown';
  import ChevronUp from 'phosphor-svelte/lib/CaretUp';

  export let emoji: string;
  export let title: string;
  export let helperText: string | undefined = undefined;
  export let tags: recipeTagSimple[];
  export let tagCounts: Map<string, number> | undefined = undefined;
  export let alwaysExpanded: boolean = false;
  export let previewCount: number = 8;
  export let onTagClick: (tag: recipeTagSimple) => void;

  let expanded = alwaysExpanded;
  let showAllToggle = false;

  $: {
    // Show toggle if there are more tags than preview count
    showAllToggle = tags.length > previewCount;
    // Auto-expand if alwaysExpanded
    if (alwaysExpanded) {
      expanded = true;
    }
  }

  function toggleExpanded() {
    expanded = !expanded;
  }

  function getTagCount(tag: recipeTagSimple): number | undefined {
    return tagCounts?.get(tag.title);
  }
</script>

<div class="rounded-xl border border-gray-200 bg-[#fafafa] shadow-sm p-5 md:p-6 transition-all duration-300">
  <!-- Header -->
  <div class="flex items-start justify-between gap-4 mb-4">
    <div class="flex-1">
      <h2 class="text-2xl font-bold flex items-center gap-2 mb-1.5">
        <span>{emoji}</span>
        <span>{title}</span>
      </h2>
      {#if helperText}
        <p class="text-sm text-gray-500 mt-0.5">{helperText}</p>
      {/if}
    </div>
    {#if showAllToggle && !alwaysExpanded}
      <button
        on:click={toggleExpanded}
        type="button"
        class="flex-shrink-0 text-sm text-primary hover:text-[#d64000] transition-colors font-medium"
        aria-label={expanded ? 'Show less' : 'Show more'}
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    {/if}
  </div>

  <!-- Tags -->
  <div class="flex flex-wrap gap-2">
    {#if expanded || alwaysExpanded}
      <!-- Show all tags when expanded -->
      {#each tags as tag (tag.title)}
        <TagChip {tag} count={getTagCount(tag)} onClick={() => onTagClick(tag)} />
      {/each}
    {:else}
      <!-- Show preview when collapsed -->
      {#each tags.slice(0, previewCount) as tag (tag.title)}
        <TagChip {tag} count={getTagCount(tag)} onClick={() => onTagClick(tag)} />
      {/each}
    {/if}
  </div>
</div>

<style>
  /* Smooth expand/collapse animation */
  div {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
</style>

