<script lang="ts">
  import BookOpen from 'phosphor-svelte/lib/BookOpen';
  import type { PackCard } from '$lib/landing/content';
  import { userHref } from '$lib/landing/content';
  import Arrow from './Arrow.svelte';
  import LandingImage from './LandingImage.svelte';

  export let packs: PackCard[] = [];
  $: visiblePacks = packs.slice(0, 4);
</script>

{#if visiblePacks.length}
  <section class="packs-section" aria-labelledby="packs-heading">
    <div class="section-top">
      <div>
        <p class="eyebrow">Recipe packs</p>
        <h2 id="packs-heading">Find your next cooking adventure.</h2>
        <p class="section-description">Favorite recipes, gathered into packs to save and share.</p>
      </div>
      <a class="text-link" href="/packs">Explore all recipe packs <Arrow /></a>
    </div>
    <ul
      class="pack-grid"
      class:single={visiblePacks.length === 1}
      class:four={visiblePacks.length === 4}
      style={`--pack-count: ${visiblePacks.length}`}
      role="list"
    >
      {#each visiblePacks as pack (pack.coordinate)}
        {@const images = pack.previewImages ?? (pack.image ? [pack.image] : [])}
        <li>
          <article>
            <a href={pack.href} class="pack-image-link" aria-label={`Open ${pack.title}`}>
              <div class="pack-cover" class:collage={images.length > 1}>
                {#if images.length}
                  {#each images as image, i}
                    <div class="image-cell" class:collage-lead={i === 0}>
                      <LandingImage
                        url={image}
                        alt=""
                        ratio="16 / 10"
                        rounded=""
                        sizes={visiblePacks.length === 1
                          ? '(min-width: 1024px) 40vw, 90vw'
                          : '(min-width: 1280px) 22vw, (min-width: 768px) 40vw, 90vw'}
                      />
                    </div>
                  {/each}
                {:else}
                  <div class="pack-placeholder" aria-hidden="true">
                    <BookOpen size={52} weight="light" />
                  </div>
                {/if}
                {#if Number.isInteger(pack.recipeCount) && pack.recipeCount > 0}
                  <span class="recipe-count"
                    >{pack.recipeCount} {pack.recipeCount === 1 ? 'recipe' : 'recipes'}</span
                  >
                {/if}
              </div>
            </a>
            <div class="pack-copy">
              <h3><a href={pack.href}>{pack.title} <Arrow /></a></h3>
              {#if pack.description}<p class="description">{pack.description}</p>{/if}
              <a class="byline" href={userHref(pack.author.pubkey)}
                >By {pack.author.name?.trim() || 'A cook'}</a
              >
              {#if visiblePacks.length === 1}
                <a class="open-pack" href={pack.href}>Open recipe pack <Arrow /></a>
              {/if}
            </div>
          </article>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .packs-section {
    margin: 32px 0;
    padding: clamp(22px, 3vw, 36px);
    border-radius: 22px;
    background: var(--color-explore-sage);
    color: var(--color-text-primary);
  }
  .section-top {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 28px;
  }
  .eyebrow {
    margin: 0 0 10px;
    color: var(--color-primary);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  h2,
  h3 {
    font-family: var(--font-editorial, Georgia, serif);
    font-weight: 500;
    letter-spacing: -0.025em;
  }
  h2 {
    max-width: 24ch;
    margin: 0;
    font-size: clamp(28px, 3vw, 38px);
    line-height: 1.1;
  }
  .section-description {
    margin: 12px 0 0;
    font-size: 14px;
    line-height: 1.6;
    color: var(--color-text-secondary);
  }
  .text-link,
  .open-pack {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    font-size: 13px;
    font-weight: 600;
  }
  .text-link {
    flex-shrink: 0;
  }
  .pack-grid {
    display: grid;
    grid-template-columns: repeat(var(--pack-count), minmax(0, 1fr));
    gap: 24px;
  }
  .pack-image-link {
    display: block;
    min-width: 0;
  }
  .pack-cover {
    position: relative;
    aspect-ratio: 16 / 10;
    border-radius: 14px;
    overflow: hidden;
    background: var(--color-bg-primary);
  }
  .image-cell,
  .image-cell :global(img) {
    width: 100%;
    height: 100%;
    min-height: 0;
    object-fit: cover;
  }
  .collage {
    display: grid;
    grid-template-columns: 1.25fr 1fr;
    gap: 3px;
  }
  .collage-lead {
    grid-row: span 2;
  }
  .collage .image-cell:last-of-type:nth-of-type(2) {
    grid-row: span 2;
  }
  .pack-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--color-primary);
  }
  .recipe-count {
    position: absolute;
    left: 12px;
    bottom: 12px;
    padding: 5px 10px;
    border-radius: 999px;
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    font-size: 12px;
    font-weight: 600;
  }
  .pack-copy {
    min-width: 0;
  }
  h3 {
    margin: 12px 0 0;
    font-size: 24px;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  h3 a {
    display: inline-block;
    min-height: 44px;
  }
  h3 :global(svg) {
    margin-left: 3px;
  }
  .description {
    margin: 6px 0 0;
    color: var(--color-text-secondary);
    font-size: 14px;
    line-height: 1.6;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .byline {
    display: flex;
    align-items: center;
    min-height: 44px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .single article {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    align-items: center;
    gap: clamp(24px, 4vw, 48px);
  }
  .single h3 {
    margin-top: 0;
    font-size: clamp(26px, 3vw, 36px);
  }
  .single .description {
    line-clamp: 5;
    -webkit-line-clamp: 5;
  }
  .open-pack {
    margin-top: 12px;
    color: var(--color-primary);
  }
  @media (max-width: 1023px) {
    .section-top {
      align-items: start;
      flex-direction: column;
      gap: 10px;
    }
    .pack-grid.four {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 600px) {
    .packs-section {
      margin: 24px 0;
      padding: 22px 18px;
    }
    .pack-grid:not(.single),
    .single article {
      grid-template-columns: 1fr;
    }
    .single article {
      gap: 20px;
    }
    .pack-grid {
      gap: 28px;
    }
  }
</style>
