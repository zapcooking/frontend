<script lang="ts">
  /** A recipe or article card: photo, title, byline. Plain links, no JS. */
  import type { LongformCard } from '$lib/landing/content';
  import LandingImage from './LandingImage.svelte';
  import { magazineName, magazineText } from '$lib/landing/display';
  import { avatarUrl } from '$lib/imageOptimizer';

  export let card: LongformCard;
  export let ratio = '4 / 3';
  export let sizes = '(min-width: 1024px) 25vw, 50vw';
  export let widths = [320, 480, 640];
  /** Heading level for the title. */
  export let level: 'h3' | 'h4' = 'h3';
  export let showSummary = false;
</script>

<a href={card.href} class="tile group flex flex-col gap-2 min-w-0">
  <LandingImage
    url={card.image}
    alt={magazineText(card.title) || 'From the kitchen'}
    {ratio}
    {sizes}
    {widths}
  />
  <svelte:element this={level} class="tile-title font-display text-lg leading-snug">
    {magazineText(card.title) || 'From the kitchen'}
  </svelte:element>
  {#if showSummary && card.summary}
    <p class="text-sm leading-relaxed text-secondary-landing">{magazineText(card.summary)}</p>
  {/if}
  <p class="text-sm text-caption-landing">
    {#if card.author.picture}<img
        src={avatarUrl(card.author.picture, 56) || card.author.picture}
        alt=""
        width="24"
        height="24"
        loading="lazy"
      />{/if} By {magazineName(card.author.name)}
  </p>
</a>

<style>
  .tile p:last-child {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 32px;
  }
  .tile p img {
    border-radius: 50%;
  }
  .tile {
    color: var(--color-text-primary);
    text-decoration: none;
  }
  .tile:hover .tile-title,
  .tile:focus-visible .tile-title {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
