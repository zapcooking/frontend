<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRight';

  export let data: PageData;

  const siteOrigin = 'https://zap.cooking';
  $: targetPath = data.targetPath;
  $: record = data.record;
  $: shortUrl = record ? `${siteOrigin}/s/${record.shortCode}` : '';
</script>

<svelte:head>
  <title>Short link – zap.cooking</title>
</svelte:head>

<div class="mx-auto max-w-md px-4 py-12 text-center">
  {#if data.error}
    <p class="text-red-600 dark:text-red-400">{data.error}</p>
  {:else if record && targetPath}
    <h1 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary);">
      {record.type === 'recipe' ? 'Recipe' : 'Article'} link
    </h1>
    <p class="text-sm mb-4" style="color: var(--color-text-secondary);">
      This short link goes to a {record.type === 'recipe' ? 'recipe' : 'article'} on zap.cooking.
    </p>
    <a
      href={targetPath}
      class="inline-flex items-center gap-2 py-2.5 px-4 rounded-lg font-semibold bg-primary text-white hover:opacity-90 transition"
    >
      Continue to {record.type === 'recipe' ? 'recipe' : 'article'}
      <ArrowRightIcon size={18} weight="bold" />
    </a>
    <p class="mt-6 text-xs" style="color: var(--color-text-secondary);">
      Short URL: <code class="font-mono">{shortUrl}</code>
    </p>
  {/if}
</div>
