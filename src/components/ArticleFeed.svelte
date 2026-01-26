<script lang="ts">
  import ArticleCard from './ArticleCard.svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';

  export let articles: Array<{
    event: NDKEvent;
    imageUrl: string | null;
    title: string;
    preview: string;
    readTime: number;
    tags: string[];
    articleUrl: string;
  }> = [];
</script>

<div class="article-feed-horizontal">
  {#each articles as article (article.event.id)}
    <div class="article-card-wrapper">
      <ArticleCard
        event={article.event}
        imageUrl={article.imageUrl}
        title={article.title}
        preview={article.preview}
        readTime={article.readTime}
        tags={article.tags}
        articleUrl={article.articleUrl}
      />
    </div>
  {/each}
</div>

<style>
  .article-feed-horizontal {
    display: flex;
    align-items: stretch;
    gap: 24px;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 8px;
    -webkit-overflow-scrolling: touch;
    scroll-behavior: smooth;
    scrollbar-width: thin;
    scrollbar-color: var(--color-input-border) transparent;
  }

  .article-feed-horizontal::-webkit-scrollbar {
    height: 8px;
  }

  .article-feed-horizontal::-webkit-scrollbar-track {
    background: transparent;
  }

  .article-feed-horizontal::-webkit-scrollbar-thumb {
    background-color: var(--color-input-border);
    border-radius: 4px;
  }

  .article-feed-horizontal::-webkit-scrollbar-thumb:hover {
    background-color: var(--color-text-secondary);
  }

  .article-card-wrapper {
    flex: 0 0 auto;
    width: 320px;
    height: 520px;
    display: flex;
  }

  /* Slightly wider on larger screens */
  @media (min-width: 768px) {
    .article-card-wrapper {
      width: 360px;
      height: 540px;
    }
  }

  @media (min-width: 1200px) {
    .article-card-wrapper {
      width: 380px;
      height: 560px;
    }
  }
</style>