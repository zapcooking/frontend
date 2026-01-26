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
  class="hero-article group cursor-pointer overflow-hidden rounded-2xl transition-all duration-300 hover:shadow-2xl"
  style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
  on:click={handleClick}
  on:keydown={(e) => e.key === 'Enter' && handleClick()}
  role="link"
  tabindex="0"
>
  <div class="flex flex-col lg:flex-row">
    <!-- Image Section - 3:2 aspect ratio on desktop, 16:9 on mobile -->
    <div class="relative lg:w-3/5 overflow-hidden">
      <div class="aspect-[16/9] lg:aspect-[3/2] w-full h-full">
        <img
          src={displayImageUrl}
          alt={article.title}
          class="w-full h-full object-cover transition-all duration-500 group-hover:scale-105 {imageLoaded
            ? 'opacity-100'
            : 'opacity-0'}"
          loading="eager"
          on:error={handleImageError}
          on:load={handleImageLoad}
        />
        {#if !imageLoaded}
          <div class="absolute inset-0 animate-pulse bg-gray-200 dark:bg-gray-700"></div>
        {/if}

        <!-- Featured Badge -->
        <div class="absolute top-4 left-4">
          <span
            class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm"
            style="color: var(--color-primary);"
          >
            Featured
          </span>
        </div>
      </div>
    </div>

    <!-- Content Section -->
    <div class="lg:w-2/5 p-6 lg:p-8 flex flex-col justify-center">
      <!-- Title -->
      <h2
        class="text-2xl lg:text-3xl xl:text-4xl font-bold mb-4 leading-tight line-clamp-3 group-hover:text-primary transition-colors"
        style="color: var(--color-text-primary);"
      >
        {article.title}
      </h2>

      <!-- Author Row -->
      <div class="flex items-center gap-3 mb-4">
        <CustomAvatar pubkey={article.author.pubkey} size={44} />
        <div class="flex flex-col">
          <AuthorName event={article.event} />
          <span class="text-sm text-caption">
            {formatTimestamp(article.publishedAt)}
          </span>
        </div>
      </div>

      <!-- Preview Text -->
      <p
        class="text-base lg:text-lg mb-6 line-clamp-3 leading-relaxed"
        style="color: var(--color-text-secondary);"
      >
        {article.preview}
      </p>

      <!-- Tags -->
      {#if article.tags.length > 0}
        <div class="flex flex-wrap gap-2 mb-4">
          {#each article.tags.slice(0, 4) as tag}
            <span
              class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
              style="background-color: rgba(255, 107, 53, 0.1); color: #ff6b35;"
            >
              #{tag}
            </span>
          {/each}
        </div>
      {/if}

      <!-- Read Time -->
      <div class="flex items-center gap-2 text-caption">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span class="text-sm font-medium">{article.readTimeMinutes} min read</span>
      </div>
    </div>
  </div>
</div>

<style>
  .hero-article {
    transition:
      transform 300ms ease-out,
      box-shadow 300ms ease-out;
  }

  .hero-article:hover {
    transform: translateY(-4px);
  }

  .line-clamp-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
