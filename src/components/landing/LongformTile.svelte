<script lang="ts">
  /** Public editorial card with separate content and creator links. No app hydration. */
  import type { LongformCard } from '$lib/landing/content';
  import { userHref } from '$lib/landing/content';
  import { avatarUrl } from '$lib/imageOptimizer';
  import LandingImage from './LandingImage.svelte';

  export let card: LongformCard;
  export let ratio = '4 / 3';
  export let sizes = '(min-width: 1024px) 25vw, 50vw';
  export let widths = [320, 480, 640];
  export let level: 'h3' | 'h4' = 'h3';
  export let showSummary = false;
  export let label = '';
</script>

<article class="tile">
  <a href={card.href} class="tile-image" aria-label={card.title}>
    <LandingImage url={card.image} alt="" {ratio} {sizes} {widths} />
  </a>
  <div class="tile-copy">
    <svelte:element this={level} class="tile-title"
      ><a href={card.href}>{card.title}</a></svelte:element
    >
    {#if showSummary && card.summary}<p class="tile-summary">{card.summary}</p>{/if}
    <div class="tile-meta">
      {#if label}<span class="tile-label">{label} · </span>{/if}
      <a class="tile-byline" href={userHref(card.author.pubkey)}>
        {#if card.author.picture}<img
            src={avatarUrl(card.author.picture, 56) || card.author.picture}
            alt=""
            width="24"
            height="24"
            loading="lazy"
          />{/if}By {card.author.name || 'A community cook'}
      </a>
    </div>
  </div>
</article>

<style>
  .tile {
    min-width: 0;
  }
  .tile-image {
    display: block;
  }
  .tile-image :global(img) {
    border-radius: 0;
  }
  .tile-copy {
    min-width: 0;
    padding-top: 16px;
  }
  .tile-title {
    font-family: var(--font-editorial, Georgia, serif);
    font-size: var(--explore-title, 24px);
    line-height: 1.12;
    font-weight: 500;
    letter-spacing: -0.025em;
    margin: 0;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }
  .tile-title a {
    display: inline-block;
    min-height: 44px;
    color: var(--color-text-primary);
    text-decoration: none;
  }
  .tile-summary {
    margin: 12px 0 0;
    color: var(--color-text-secondary);
    font-size: var(--explore-body, 16px);
    line-height: 1.55;
    max-width: 50ch;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .tile-meta {
    margin-top: 6px;
    font-size: var(--explore-meta, 13px);
    color: var(--color-caption);
  }
  .tile-byline {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: inherit;
    line-height: 1.4;
  }
  .tile-byline img {
    display: none;
  }
  .tile-title a:hover,
  .tile-title a:focus-visible {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
</style>
