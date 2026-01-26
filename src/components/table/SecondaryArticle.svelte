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
  class="secondary-article group cursor-pointer overflow-hidden rounded-xl transition-all duration-200 hover:-translate-y-1 hover:shadow-lg flex flex-col h-full"
  style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
  on:click={handleClick}
  on:keydown={(e) => e.key === 'Enter' && handleClick()}
  role="link"
  tabindex="0"
>
  <!-- Image Section - 4:3 aspect ratio -->
  <div class="relative w-full overflow-hidden flex-shrink-0">
    <div class="aspect-[4/3] w-full">
      <img
        src={displayImageUrl}
        alt={article.title}
        class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 {imageLoaded
          ? 'opacity-100'
          : 'opacity-0'}"
        loading="lazy"
        on:error={handleImageError}
        on:load={handleImageLoad}
      />
      {#if !imageLoaded}
        <div class="absolute inset-0 animate-pulse bg-gray-200 dark:bg-gray-700"></div>
      {/if}
    </div>
  </div>

  <!-- Content Section -->
  <div class="p-5 flex flex-col flex-grow">
    <!-- Title -->
    <h3
      class="text-lg font-semibold mb-3 line-clamp-2 leading-snug group-hover:text-primary transition-colors flex-shrink-0"
      style="color: var(--color-text-primary);"
    >
      {article.title}
    </h3>

    <!-- Author Row -->
    <div class="flex items-center gap-2 mb-3 flex-shrink-0">
      <CustomAvatar pubkey={article.author.pubkey} size={28} />
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <AuthorName event={article.event} />
        <span class="text-xs text-caption shrink-0">
          · {formatTimestamp(article.publishedAt)}
        </span>
      </div>
    </div>

    <!-- Preview Text -->
    <p
      class="text-sm mb-4 line-clamp-2 leading-relaxed flex-grow"
      style="color: var(--color-text-secondary);"
    >
      {article.preview}
    </p>

    <!-- Footer -->
    <div
      class="flex items-center justify-between mt-auto pt-3 border-t flex-shrink-0"
      style="border-color: var(--color-input-border);"
    >
      <span class="text-xs text-caption font-medium">
        {article.readTimeMinutes} min read
      </span>

      <!-- Tags -->
      {#if article.tags.length > 0}
        <div class="flex gap-1.5">
          {#each article.tags.slice(0, 2) as tag}
            <span
              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
              style="background-color: rgba(255, 107, 53, 0.1); color: #ff6b35;"
            >
              #{tag}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .secondary-article {
    transition:
      transform 200ms ease-out,
      box-shadow 200ms ease-out;
  }

  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
