<script lang="ts">
  import { goto } from '$app/navigation';
  import type { ArticleData } from '$lib/articleUtils';
  import ArticleCardBody from './ArticleCardBody.svelte';

  export let article: ArticleData;
  export let size: 'hero' | 'secondary' | 'tertiary';

  function handleClick() {
    if (article.articleUrl) {
      goto(article.articleUrl);
    }
  }

  const rootClasses = {
    hero: 'hero-article group cursor-pointer overflow-hidden rounded-2xl transition-all duration-300 hover:shadow-2xl',
    secondary:
      'secondary-article group cursor-pointer overflow-hidden rounded-xl transition-all duration-200 hover:-translate-y-1 hover:shadow-lg flex flex-col h-full',
    tertiary:
      'tertiary-article group cursor-pointer overflow-hidden rounded-xl transition-all duration-200 hover:-translate-y-1 hover:shadow-md p-4 flex gap-4'
  } as const;
</script>

<div
  class={rootClasses[size]}
  style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
  on:click={handleClick}
  on:keydown={(e) => e.key === 'Enter' && handleClick()}
  role="link"
  tabindex="0"
>
  {#if size === 'hero'}
    <div class="flex flex-col lg:flex-row">
      <ArticleCardBody {article} {size} />
    </div>
  {:else}
    <ArticleCardBody {article} {size} />
  {/if}
</div>

<style>
  :global(.hero-article) {
    transition:
      transform 300ms ease-out,
      box-shadow 300ms ease-out;
  }

  :global(.hero-article:hover) {
    transform: translateY(-4px);
  }

  :global(.secondary-article) {
    transition:
      transform 200ms ease-out,
      box-shadow 200ms ease-out;
  }

  :global(.tertiary-article) {
    transition:
      transform 200ms ease-out,
      box-shadow 200ms ease-out;
  }
</style>
