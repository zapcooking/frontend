<script lang="ts">
  import ArrowsOutSimpleIcon from 'phosphor-svelte/lib/ArrowsOutSimple';
  import { parseZapComment, shortenZapUrl } from '$lib/zapComment';
  import MediaLightbox from './MediaLightbox.svelte';

  export let comment: string;

  let activeComment = comment;
  let failedImages = new Set<string>();
  let lightboxOpen = false;
  let lightboxIndex = 0;

  $: parsed = parseZapComment(comment);
  $: visibleImages = parsed.imageUrls.filter((url) => !failedImages.has(url));
  $: failedImageUrls = parsed.imageUrls.filter((url) => failedImages.has(url));
  $: if (comment !== activeComment) {
    activeComment = comment;
    failedImages = new Set();
    lightboxOpen = false;
    lightboxIndex = 0;
  }

  function openImage(url: string) {
    lightboxIndex = Math.max(0, visibleImages.indexOf(url));
    lightboxOpen = true;
  }

  function markImageFailed(url: string) {
    failedImages = new Set([...failedImages, url]);
    if (lightboxIndex >= visibleImages.length - 1) {
      lightboxIndex = Math.max(0, visibleImages.length - 2);
    }
  }
</script>

<div class="zap-comment-content">
  {#if parsed.segments.length > 0}
    <p class="comment-text">
      {#each parsed.segments as segment}
        {#if segment.type === 'text'}
          {segment.value}
        {:else}
          <a
            class="zap-link"
            href={segment.href}
            title={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            on:click|stopPropagation>{segment.label}</a
          >
        {/if}
      {/each}
    </p>
  {/if}

  {#if failedImageUrls.length > 0}
    <p class="failed-image-links">
      {#each failedImageUrls as url}
        <a
          class="zap-link"
          href={url}
          title={url}
          target="_blank"
          rel="noopener noreferrer"
          on:click|stopPropagation>{shortenZapUrl(url)}</a
        >
      {/each}
    </p>
  {/if}

  {#if visibleImages.length > 0}
    <div
      class="image-list"
      class:with-copy={parsed.segments.length > 0 || failedImageUrls.length > 0}
      aria-label="Images attached to zap"
    >
      {#each visibleImages as url}
        <button
          type="button"
          class="image-button"
          title="Expand image"
          aria-label="Expand image attached to zap"
          on:click|stopPropagation={() => openImage(url)}
        >
          <img src={url} alt="" loading="lazy" on:error={() => markImageFailed(url)} />
          <span class="expand-icon" aria-hidden="true">
            <ArrowsOutSimpleIcon size={15} weight="bold" />
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

{#if lightboxOpen}
  <MediaLightbox
    images={visibleImages}
    index={lightboxIndex}
    onClose={() => (lightboxOpen = false)}
  />
{/if}

<style>
  .zap-comment-content {
    min-width: 0;
  }

  .comment-text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .failed-image-links {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0.25rem 0 0;
  }

  .zap-link {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    color: var(--color-primary);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
    text-overflow: ellipsis;
    vertical-align: bottom;
    white-space: nowrap;
  }

  .zap-link:hover,
  .zap-link:focus-visible {
    text-decoration-color: currentColor;
  }

  .image-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0;
  }

  .image-list.with-copy {
    margin-top: 0.375rem;
  }

  .image-button {
    position: relative;
    width: min(12rem, 100%);
    aspect-ratio: 4 / 3;
    height: auto;
    flex: 0 0 auto;
    overflow: hidden;
    padding: 0;
    border: 1px solid var(--color-input-border);
    border-radius: 6px;
    background: var(--color-input-bg);
    cursor: zoom-in;
  }

  .image-button img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 140ms ease;
  }

  .image-button:hover img,
  .image-button:focus-visible img {
    transform: scale(1.04);
  }

  .image-button:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .expand-icon {
    position: absolute;
    right: 0.25rem;
    bottom: 0.25rem;
    display: flex;
    width: 1.5rem;
    height: 1.5rem;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.68);
    color: #fff;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .image-button img {
      transition: none;
    }
  }
</style>
