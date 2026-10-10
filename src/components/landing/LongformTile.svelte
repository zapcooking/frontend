<script lang="ts">
  /** A recipe or article card: photo, title, byline. Plain links, no JS. */
  import type { LongformCard } from '$lib/landing/content';
  import LandingImage from './LandingImage.svelte';
  import { shortName } from '$lib/landing/display';

  export let card: LongformCard;
  export let ratio = '4 / 3';
  export let sizes = '(min-width: 1024px) 25vw, 50vw';
  export let widths = [320, 480, 640];
  /** Heading level for the title. */
  export let level: 'h3' | 'h4' = 'h3';
  export let showSummary = false;
</script>

<a href={card.href} class="tile group flex flex-col gap-2 min-w-0">
  <LandingImage url={card.image} alt={card.title} {ratio} {sizes} {widths} />
  <svelte:element this={level} class="tile-title font-display text-lg leading-snug">
    {card.title}
  </svelte:element>
  {#if showSummary && card.summary}
    <p class="text-sm leading-relaxed text-secondary-landing">{card.summary}</p>
  {/if}
  <p class="text-sm text-caption-landing">
    by {card.author.name || shortName(card.author.pubkey)}
  </p>
</a>

<style>
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
