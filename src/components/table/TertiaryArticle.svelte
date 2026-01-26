<script lang="ts">
  import { goto } from '$app/navigation';
  import CustomAvatar from '../CustomAvatar.svelte';
  import AuthorName from '../AuthorName.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import type { ArticleData } from '$lib/articleUtils';
  import { getPlaceholderImage } from '$lib/placeholderImages';

  export let article: ArticleData;

  let imageError = false;
  let imageLoaded = false;

  // Use placeholder image when no image or on error
  $: displayImageUrl = imageError
    ? getPlaceholderImage(article.id)
    : article.imageUrl || getPlaceholderImage(article.id);

  function handleImageError() {
    imageError = true;
  }

  function handleImageLoad() {
    imageLoaded = true;
  }

  function handleClick() {
    if (article.articleUrl) {
      goto(article.articleUrl);
    }
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return formatDistanceToNow(date, { addSuffix: true });
  }
</script>

<div
  class="tertiary-article group cursor-pointer overflow-hidden rounded-xl transition-all duration-200 hover:-translate-y-1 hover:shadow-md p-4 flex gap-4"
  style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
  on:click={handleClick}
  on:keydown={(e) => e.key === 'Enter' && handleClick()}
  role="link"
  tabindex="0"
>
  <!-- Thumbnail - 80px square -->
  <div class="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0">
    <img
      src={displayImageUrl}
      alt={article.title}
      class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110 {imageLoaded
        ? 'opacity-100'
        : 'opacity-0'}"
      loading="lazy"
      on:error={handleImageError}
      on:load={handleImageLoad}
    />
    {#if !imageLoaded}
      <div class="absolute inset-0 animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
    {/if}
  </div>

  <!-- Content -->
  <div class="flex flex-col flex-1 min-w-0 justify-center">
    <!-- Title -->
    <h4
      class="text-base font-semibold mb-1.5 line-clamp-2 leading-tight group-hover:text-primary transition-colors"
      style="color: var(--color-text-primary);"
    >
      {article.title}
    </h4>

    <!-- Author Row -->
    <div class="flex items-center gap-1.5 mb-1.5">
      <CustomAvatar pubkey={article.author.pubkey} size={20} />
      <div class="flex items-center gap-1.5 text-xs text-caption min-w-0">
        <span class="truncate">
          <AuthorName event={article.event} />
        </span>
        <span class="shrink-0">· {formatTimestamp(article.publishedAt)}</span>
      </div>
    </div>

    <!-- Preview (1 line) -->
    <p
      class="text-xs line-clamp-1 leading-relaxed mb-1.5"
      style="color: var(--color-text-secondary);"
    >
      {article.preview}
    </p>

    <!-- Tags & Read Time -->
    <div class="flex items-center gap-2 text-xs">
      <span class="text-caption">{article.readTimeMinutes} min read</span>
      {#if article.tags.length > 0}
        <span class="text-caption">·</span>
        {#each article.tags.slice(0, 2) as tag}
          <span
            class="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs"
            style="background-color: rgba(255, 107, 53, 0.1); color: #ff6b35;"
          >
            #{tag}
          </span>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .tertiary-article {
    transition:
      transform 200ms ease-out,
      box-shadow 200ms ease-out;
  }

  .line-clamp-1 {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
