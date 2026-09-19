<script lang="ts">
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';

  export let backHref = '/reads';
  export let backLabel = 'Back to Reads';
</script>

<div class="flex flex-col justify-center items-center page-loader gap-4 px-6 text-center">
  <h1 class="text-2xl font-bold" style="color: var(--color-text-primary);">Content unavailable</h1>
  <p class="text-caption max-w-md">
    This article is not available on Zap Cooking.
  </p>
  <a
    href={backHref}
    class="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-full hover:opacity-80"
  >
    <ArrowLeftIcon size={16} weight="bold" />
    {backLabel}
  </a>
</div>
