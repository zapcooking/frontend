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
  <a href={card.href} class="tile-content">
    <LandingImage url={card.image} alt="" {ratio} {sizes} {widths} />
    {#if label}<span class="tile-label">{label}</span>{/if}
    <svelte:element this={level} class="tile-title">{card.title}</svelte:element>
  </a>
  {#if showSummary && card.summary}<p class="tile-summary">{card.summary}</p>{/if}
  <a class="tile-byline" href={userHref(card.author.pubkey)}>
    {#if card.author.picture}<img
        src={avatarUrl(card.author.picture, 56) || card.author.picture}
        alt=""
        width="24"
        height="24"
        loading="lazy"
      />{/if}By {card.author.name || 'A community cook'}
  </a>
</article>

<style>
  .tile {
    min-width: 0;
  }
  .tile-content {
    display: block;
    color: var(--color-text-primary);
    text-decoration: none;
  }
  .tile-title {
    font-family: var(--font-editorial, Georgia, serif);
    font-size: 21px;
    line-height: 1.2;
    font-weight: 500;
    letter-spacing: -0.025em;
    margin: 12px 0 0;
    overflow-wrap: anywhere;
  }
  .tile-label {
    display: block;
    margin-top: 12px;
    color: var(--color-primary);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .tile-label + .tile-title {
    margin-top: 6px;
  }
  .tile-summary {
    margin: 10px 0 0;
    color: var(--color-text-secondary);
    font-size: 14px;
    line-height: 1.65;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .tile-byline {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 44px;
    font-size: 12px;
    color: var(--color-caption);
  }
  .tile-byline img {
    border-radius: 50%;
  }
  .tile-content:hover .tile-title,
  .tile-content:focus-visible .tile-title {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
