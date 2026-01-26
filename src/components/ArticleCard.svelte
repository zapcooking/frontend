<script lang="ts">
  import { goto } from '$app/navigation';
  import CustomAvatar from './CustomAvatar.svelte';
  import AuthorName from './AuthorName.svelte';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { formatDistanceToNow } from 'date-fns';
  import { getPlaceholderImage } from '$lib/placeholderImages';

  export let event: NDKEvent;
  export let imageUrl: string | null = null;
  export let title: string;
  export let preview: string;
  export let readTime: number;
  export let tags: string[] = [];
  export let articleUrl: string;

  let imageError = false;
  let imageLoaded = false;

  // Use placeholder image when no image or on error
  $: displayImageUrl = imageError
    ? getPlaceholderImage(event?.id)
    : imageUrl || getPlaceholderImage(event?.id);

  function handleImageError() {
    imageError = true;
  }

  function handleImageLoad() {
    imageLoaded = true;
  }

  function handleCardClick() {
    if (articleUrl) {
      goto(articleUrl);
    }
  }

  function handleBookmarkClick(e: MouseEvent) {
    e.stopPropagation();
    // TODO: Implement bookmark functionality
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return formatDistanceToNow(date, { addSuffix: true });
  }
</script>

<div
  class="article-card group cursor-pointer overflow-hidden transition-all duration-200 ease-in-out hover:-translate-y-1 hover:shadow-lg w-full h-full flex flex-col"
  style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border); border-radius: 8px;"
  on:click={handleCardClick}
  role="button"
  tabindex="0"
  on:keydown={(e) => e.key === 'Enter' && handleCardClick()}
>
  <!-- Image Section -->
  <div
    class="relative w-full flex-shrink-0"
    style="height: 200px; aspect-ratio: 16/9; overflow: hidden; border-radius: 8px 8px 0 0;"
  >
    <img
      src={displayImageUrl}
      alt={title}
      class="w-full h-full object-cover transition-opacity duration-200 {imageLoaded
        ? 'opacity-100'
        : 'opacity-0'}"
      loading="lazy"
      on:error={handleImageError}
      on:load={handleImageLoad}
    />
    {#if !imageLoaded}
      <div class="absolute inset-0 animate-pulse bg-gray-200 dark:bg-gray-700"></div>
    {/if}

    <!-- Bookmark Icon -->
    <button
      class="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100"
      on:click={handleBookmarkClick}
      aria-label="Bookmark article"
    >
      <BookmarkIcon size={18} weight="regular" color="white" />
    </button>
  </div>

  <!-- Content Section -->
  <div class="p-5 flex flex-col flex-grow">
    <!-- Title -->
    <h2
      class="text-lg font-semibold mb-3 line-clamp-2 leading-tight flex-shrink-0"
      style="color: var(--color-text-primary);"
    >
      {title}
    </h2>

    <!-- Author Row -->
    <div class="flex items-center gap-2 mb-3 flex-shrink-0">
      <CustomAvatar pubkey={event.author?.hexpubkey || event.pubkey} size={32} />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <AuthorName {event} />
          <span class="text-xs text-caption">
            {formatTimestamp(event.created_at || 0)}
          </span>
        </div>
      </div>
    </div>

    <!-- Preview Text -->
    {#if preview}
      <p
        class="text-sm mb-3 line-clamp-3 leading-relaxed flex-grow"
        style="color: var(--color-text-secondary);"
      >
        {preview}
      </p>
    {:else}
      <div class="flex-grow"></div>
    {/if}

    <!-- Footer: Read Time and Tags -->
    <div
      class="flex items-center justify-between gap-2 mt-auto pt-3 border-t flex-shrink-0"
      style="border-color: var(--color-input-border);"
    >
      <span class="text-xs text-caption">
        {readTime} min read
      </span>

      <!-- Tags -->
      {#if tags.length > 0}
        <div class="flex flex-wrap gap-1.5 flex-1 justify-end">
          {#each tags.slice(0, 3) as tag}
            <span
              class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
              style="background-color: rgba(255, 107, 53, 0.1); color: #ff6b35;"
            >
              #{tag}
            </span>
          {/each}
          {#if tags.length > 3}
            <span class="text-xs text-caption">+{tags.length - 3}</span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .line-clamp-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .article-card {
    transition:
      transform 200ms ease-in-out,
      box-shadow 200ms ease-in-out;
    min-height: 100%;
  }

  .article-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  }
</style>
