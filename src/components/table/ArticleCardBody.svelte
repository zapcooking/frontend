<script lang="ts">
  import CustomAvatar from '../CustomAvatar.svelte';
  import AuthorName from '../AuthorName.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import type { ArticleData } from '$lib/articleUtils';
  import { getPlaceholderImage } from '$lib/placeholderImages';

  export let article: ArticleData;
  export let size: 'hero' | 'secondary' | 'tertiary';

  let imageError = false;
  let imageLoaded = false;

  $: displayImageUrl = imageError
    ? getPlaceholderImage(article.id)
    : article.imageUrl || getPlaceholderImage(article.id);

  function handleImageError() {
    imageError = true;
  }

  function handleImageLoad() {
    imageLoaded = true;
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return formatDistanceToNow(date, { addSuffix: true });
  }

  const classes = {
    imageContainer: {
      hero: 'relative lg:w-3/5 overflow-hidden',
      secondary: 'relative w-full overflow-hidden flex-shrink-0',
      tertiary: 'relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0'
    },
    aspectWrapper: {
      hero: 'aspect-[16/9] lg:aspect-[3/2] w-full h-full',
      secondary: 'aspect-[4/3] w-full',
      tertiary: null as string | null
    },
    img: {
      hero: 'w-full h-full object-cover transition-all duration-500 group-hover:scale-105',
      secondary:
        'w-full h-full object-cover transition-transform duration-300 group-hover:scale-105',
      tertiary:
        'w-full h-full object-cover transition-transform duration-300 group-hover:scale-110'
    },
    skeleton: {
      hero: 'absolute inset-0 animate-pulse bg-gray-200 dark:bg-gray-700',
      secondary: 'absolute inset-0 animate-pulse bg-gray-200 dark:bg-gray-700',
      tertiary: 'absolute inset-0 animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg'
    },
    contentWrapper: {
      hero: 'lg:w-2/5 p-6 lg:p-8 flex flex-col justify-center',
      secondary: 'p-5 flex flex-col flex-grow',
      tertiary: 'flex flex-col flex-1 min-w-0 justify-center'
    },
    heading: {
      hero: 'text-2xl lg:text-3xl xl:text-4xl font-bold mb-4 leading-tight line-clamp-3 group-hover:text-primary transition-colors',
      secondary:
        'text-lg font-semibold mb-3 line-clamp-2 leading-snug group-hover:text-primary transition-colors flex-shrink-0',
      tertiary:
        'text-base font-semibold mb-1.5 line-clamp-2 leading-tight group-hover:text-primary transition-colors'
    },
    authorRow: {
      hero: 'flex items-center gap-3 mb-4',
      secondary: 'flex items-center gap-2 mb-3 flex-shrink-0',
      tertiary: 'flex items-center gap-1.5 mb-1.5'
    },
    preview: {
      hero: 'text-base lg:text-lg mb-6 line-clamp-3 leading-relaxed',
      secondary: 'text-sm mb-4 line-clamp-2 leading-relaxed flex-grow',
      tertiary: 'text-xs line-clamp-1 leading-relaxed mb-1.5'
    },
    tagPill: {
      hero: 'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium',
      secondary: 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      tertiary: 'inline-flex items-center px-1.5 py-0.5 rounded-full text-xs'
    }
  } as const;

  $: headingTag = ({ hero: 'h2', secondary: 'h3', tertiary: 'h4' } as const)[size];
  $: avatarSize = ({ hero: 44, secondary: 28, tertiary: 20 } as const)[size];
  $: tagsToShow = size === 'hero' ? 4 : 2;
  $: imgLoading = (size === 'hero' ? 'eager' : 'lazy') as 'eager' | 'lazy';
</script>

<!-- Image Section -->
<div class={classes.imageContainer[size]}>
  {#if classes.aspectWrapper[size]}
    <div class={classes.aspectWrapper[size]}>
      <img
        src={displayImageUrl}
        alt={article.title}
        class="{classes.img[size]} {imageLoaded ? 'opacity-100' : 'opacity-0'}"
        loading={imgLoading}
        on:error={handleImageError}
        on:load={handleImageLoad}
      />
      {#if !imageLoaded}
        <div class={classes.skeleton[size]}></div>
      {/if}

      {#if size === 'hero'}
        <!-- Featured Badge -->
        <div class="absolute top-4 left-4">
          <span
            class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm"
            style="color: var(--color-primary);"
          >
            Featured
          </span>
        </div>
      {/if}
    </div>
  {:else}
    <img
      src={displayImageUrl}
      alt={article.title}
      class="{classes.img[size]} {imageLoaded ? 'opacity-100' : 'opacity-0'}"
      loading={imgLoading}
      on:error={handleImageError}
      on:load={handleImageLoad}
    />
    {#if !imageLoaded}
      <div class={classes.skeleton[size]}></div>
    {/if}
  {/if}
</div>

<!-- Content Section -->
<div class="{classes.contentWrapper[size]} article-card-body">
  <!-- Title -->
  <svelte:element
    this={headingTag}
    class={classes.heading[size]}
    style="color: var(--color-text-primary);"
  >
    {article.title}
  </svelte:element>

  <!-- Author Row -->
  <div class={classes.authorRow[size]}>
    <CustomAvatar pubkey={article.author.pubkey} size={avatarSize} />
    {#if size === 'hero'}
      <div class="flex flex-col">
        <AuthorName event={article.event} />
        <span class="text-sm text-caption">
          {formatTimestamp(article.publishedAt)}
        </span>
      </div>
    {:else if size === 'secondary'}
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <AuthorName event={article.event} />
        <span class="text-xs text-caption shrink-0">
          · {formatTimestamp(article.publishedAt)}
        </span>
      </div>
    {:else}
      <div class="flex items-center gap-1.5 text-xs text-caption min-w-0">
        <span class="truncate">
          <AuthorName event={article.event} />
        </span>
        <span class="shrink-0">· {formatTimestamp(article.publishedAt)}</span>
      </div>
    {/if}
  </div>

  <!-- Preview Text -->
  <p class={classes.preview[size]} style="color: var(--color-text-secondary);">
    {article.preview}
  </p>

  <!-- Tags + Read Time Footer -->
  {#if size === 'hero'}
    {#if article.tags.length > 0}
      <div class="flex flex-wrap gap-2 mb-4">
        {#each article.tags.slice(0, tagsToShow) as tag}
          <span
            class={classes.tagPill[size]}
            style="background-color: rgba(255, 107, 53, 0.1); color: #ff6b35;"
          >
            #{tag}
          </span>
        {/each}
      </div>
    {/if}

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
  {:else if size === 'secondary'}
    <div
      class="flex items-center justify-between mt-auto pt-3 border-t flex-shrink-0"
      style="border-color: var(--color-input-border);"
    >
      <span class="text-xs text-caption font-medium">
        {article.readTimeMinutes} min read
      </span>
      {#if article.tags.length > 0}
        <div class="flex gap-1.5">
          {#each article.tags.slice(0, tagsToShow) as tag}
            <span
              class={classes.tagPill[size]}
              style="background-color: rgba(255, 107, 53, 0.1); color: #ff6b35;"
            >
              #{tag}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="flex items-center gap-2 text-xs">
      <span class="text-caption">{article.readTimeMinutes} min read</span>
      {#if article.tags.length > 0}
        <span class="text-caption">·</span>
        {#each article.tags.slice(0, tagsToShow) as tag}
          <span
            class={classes.tagPill[size]}
            style="background-color: rgba(255, 107, 53, 0.1); color: #ff6b35;"
          >
            #{tag}
          </span>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .article-card-body :global(.line-clamp-1) {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .article-card-body :global(.line-clamp-2) {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .article-card-body :global(.line-clamp-3) {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
