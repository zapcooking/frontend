<script lang="ts">
  /** The recipe box card's hero: the photo edge to edge, the title over it. */
  import { optimizeImageUrl, getOptimalFormat } from '$lib/imageOptimizer';
  import type { RecipeBoxData } from '$lib/freshFeed/recipeBoxCard';

  export let data: RecipeBoxData;
  /** Set when the image fails to load (the card then shows no hero). */
  export let failed = false;

  $: hero = data.image && !failed ? data.image : null;
  $: heroSrc = hero
    ? optimizeImageUrl(hero, { width: 800, quality: 82, format: getOptimalFormat() })
    : null;
</script>

{#if hero}
  <a href={data.href ?? undefined} class="box-hero" aria-label={data.title}>
    <img src={heroSrc} alt="" loading="lazy" decoding="async" on:error={() => (failed = true)} />
    <span class="box-hero-shade" aria-hidden="true"></span>
    <h3 class="box-hero-title">{data.title}</h3>
  </a>
{/if}

<style>
  /* Edge to edge: cancels the card's padding (FreshPostCard .fresh-post). */
  .box-hero {
    position: relative;
    display: block;
    margin: -1.125rem -1.25rem 0.875rem;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    border-radius: 1rem 1rem 0 0;
    background: var(--box-edge);
  }

  .box-hero img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.6s ease;
  }

  .box-hero:hover img {
    transform: scale(1.03);
  }

  .box-hero-shade {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to top,
      rgba(0, 0, 0, 0.72) 0%,
      rgba(0, 0, 0, 0.35) 32%,
      transparent 58%
    );
  }

  .box-hero-title {
    position: absolute;
    left: 1.25rem;
    right: 1.25rem;
    bottom: 1rem;
    margin: 0;
    color: #fff;
    font-size: 1.375rem;
    font-weight: 700;
    line-height: 1.2;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
