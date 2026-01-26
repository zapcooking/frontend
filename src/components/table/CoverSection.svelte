<script lang="ts">
  import HeroArticle from './HeroArticle.svelte';
  import SecondaryArticle from './SecondaryArticle.svelte';
  import TertiaryArticle from './TertiaryArticle.svelte';
  import type { CuratedCover } from '$lib/articleUtils';

  export let cover: CuratedCover | null = null;
  export let loading: boolean = false;
</script>

<section class="cover-section">
  {#if loading}
    <!-- Loading Skeleton -->
    <div class="flex flex-col gap-8">
      <!-- Hero Skeleton -->
      <div class="rounded-2xl overflow-hidden animate-pulse" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);">
        <div class="flex flex-col lg:flex-row">
          <div class="lg:w-3/5">
            <div class="aspect-[16/9] lg:aspect-[3/2] w-full bg-gray-200 dark:bg-gray-700"></div>
          </div>
          <div class="lg:w-2/5 p-6 lg:p-8">
            <div class="h-10 w-3/4 rounded bg-gray-200 dark:bg-gray-700 mb-4"></div>
            <div class="flex items-center gap-3 mb-4">
              <div class="w-11 h-11 rounded-full bg-gray-200 dark:bg-gray-700"></div>
              <div class="flex flex-col gap-1">
                <div class="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700"></div>
                <div class="h-3 w-16 rounded bg-gray-200 dark:bg-gray-700"></div>
              </div>
            </div>
            <div class="h-4 w-full rounded bg-gray-200 dark:bg-gray-700 mb-2"></div>
            <div class="h-4 w-5/6 rounded bg-gray-200 dark:bg-gray-700 mb-2"></div>
            <div class="h-4 w-4/6 rounded bg-gray-200 dark:bg-gray-700"></div>
          </div>
        </div>
      </div>

      <!-- Secondary Skeleton -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {#each Array(3) as _}
          <div class="rounded-xl overflow-hidden animate-pulse" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);">
            <div class="aspect-[4/3] w-full bg-gray-200 dark:bg-gray-700"></div>
            <div class="p-5">
              <div class="h-6 w-3/4 rounded bg-gray-200 dark:bg-gray-700 mb-3"></div>
              <div class="flex items-center gap-2 mb-3">
                <div class="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700"></div>
                <div class="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700"></div>
              </div>
              <div class="h-4 w-full rounded bg-gray-200 dark:bg-gray-700 mb-2"></div>
              <div class="h-4 w-4/5 rounded bg-gray-200 dark:bg-gray-700"></div>
            </div>
          </div>
        {/each}
      </div>

      <!-- Tertiary Skeleton -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        {#each Array(2) as _}
          <div class="rounded-xl p-4 flex gap-4 animate-pulse" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);">
            <div class="w-20 h-20 rounded-lg bg-gray-200 dark:bg-gray-700 flex-shrink-0"></div>
            <div class="flex-1">
              <div class="h-5 w-3/4 rounded bg-gray-200 dark:bg-gray-700 mb-2"></div>
              <div class="flex items-center gap-2 mb-2">
                <div class="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700"></div>
                <div class="h-3 w-20 rounded bg-gray-200 dark:bg-gray-700"></div>
              </div>
              <div class="h-3 w-full rounded bg-gray-200 dark:bg-gray-700"></div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else if cover}
    <div class="flex flex-col gap-8">
      <!-- Hero Article -->
      {#if cover.hero}
        <HeroArticle article={cover.hero} />
      {/if}

      <!-- Secondary Articles (3 columns) -->
      {#if cover.secondary && cover.secondary.length > 0}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {#each cover.secondary as article (article.id)}
            <SecondaryArticle {article} />
          {/each}
        </div>
      {/if}

      <!-- Tertiary Articles (2 columns) -->
      {#if cover.tertiary && cover.tertiary.length > 0}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          {#each cover.tertiary as article (article.id)}
            <TertiaryArticle {article} />
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <!-- Empty State -->
    <div class="text-center py-16">
      <div class="text-6xl mb-4">📰</div>
      <h3 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary);">No Featured Articles Yet</h3>
      <p class="text-caption">Check back soon for curated food stories and articles.</p>
    </div>
  {/if}
</section>

<style>
  .cover-section {
    margin-bottom: 3rem;
  }
</style>
