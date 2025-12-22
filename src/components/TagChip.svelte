<script lang="ts">
  import type { recipeTagSimple } from '$lib/consts';

  export let tag: recipeTagSimple;
  export let count: number | undefined = undefined;
  export let onClick: (() => void) | undefined = undefined;
</script>

<button
  on:click={onClick}
  type="button"
  class="inline-flex items-center gap-1.5 rounded-full px-3 py-2 bg-input transition duration-200 text-sm font-medium cursor-pointer h-9"
  style="color: var(--color-text-primary)"
>
  {#if tag.emoji}
    <span class="text-sm leading-none">{tag.emoji}</span>
  {/if}
  <span>{tag.title}</span>
  {#if count !== undefined}
    <span class="text-xs text-caption font-normal">· {count}</span>
  {/if}
</button>

