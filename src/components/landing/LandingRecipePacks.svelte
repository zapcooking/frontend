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
        <h2 id="packs-heading">Recipe packs</h2>
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
              </div>
            </a>
            <div class="pack-copy">
              <h3><a href={pack.href}>{pack.title}</a></h3>
              {#if pack.description}<p class="description">{pack.description}</p>{/if}
              <div class="pack-metadata">
                <a class="byline" href={userHref(pack.author.pubkey)}
                  >By {pack.author.name?.trim() || 'A cook'}</a
                >
                {#if Number.isInteger(pack.recipeCount) && pack.recipeCount > 0}
                  <span class="recipe-count"
                    >{pack.recipeCount} {pack.recipeCount === 1 ? 'recipe' : 'recipes'}</span
                  >
                {/if}
              </div>
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
    padding: 36px 0;
    border-top: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
  }
  .section-top {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 28px;
  }
  h2,
  h3 {
    font-family: var(--font-editorial, Georgia, serif);
    font-weight: 500;
    letter-spacing: -0.025em;
  }
  h2 {
    margin: 0;
    font-size: var(--explore-section, 32px);
    line-height: 1.12;
  }
  .section-description {
    max-width: 60ch;
    margin: 12px 0 0;
    color: var(--color-text-secondary);
    font-size: var(--explore-body, 16px);
    line-height: 1.5;
  }
  .text-link,
  .open-pack {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    font-size: var(--explore-meta, 13px);
    font-weight: 600;
  }
  .text-link {
    flex-shrink: 0;
  }
  .pack-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    align-items: start;
    gap: 24px 32px;
  }
  .pack-grid > li {
    min-width: 0;
  }
  .pack-grid > li:first-child {
    grid-row: 1 / span 3;
  }
  .pack-grid > li:not(:first-child) {
    grid-column: 2;
    padding-top: 20px;
    border-top: 1px solid var(--color-input-border);
  }
  .pack-grid > li:not(:first-child) article {
    display: grid;
    grid-template-columns: minmax(96px, 0.45fr) minmax(0, 1fr);
    align-items: start;
    gap: 16px;
  }
  .pack-image-link {
    display: block;
    min-width: 0;
  }
  .pack-cover {
    aspect-ratio: 4 / 3;
    overflow: hidden;
    background: var(--color-bg-secondary);
  }
  .image-cell,
  .image-cell :global(img) {
    width: 100%;
    height: 100%;
    min-height: 0;
    border-radius: 0;
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
    color: var(--color-caption);
  }
  .pack-copy {
    min-width: 0;
  }
  h3 {
    margin: 16px 0 0;
    font-size: var(--explore-title, 24px);
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  h3 a {
    display: inline-block;
    min-height: 44px;
  }
  .pack-grid > li:not(:first-child) h3 {
    margin-top: 0;
  }
  .description {
    margin: 8px 0 0;
    color: var(--color-text-secondary);
    font-size: var(--explore-body, 16px);
    line-height: 1.5;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .pack-metadata {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    color: var(--color-caption);
    font-size: var(--explore-meta, 13px);
    line-height: 1.4;
  }
  .byline {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: inherit;
  }
  .recipe-count::before {
    content: ' · ';
    white-space: pre;
  }
  .single {
    grid-template-columns: 1fr;
  }
  .single > li:first-child {
    grid-row: auto;
  }
  .single article {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    align-items: center;
    gap: 32px;
  }
  .single h3 {
    margin-top: 0;
    font-size: var(--explore-section, 32px);
    line-height: 1.12;
  }
  .single .description {
    line-clamp: 5;
    -webkit-line-clamp: 5;
  }
  .open-pack {
    margin-top: 12px;
    color: var(--color-primary);
  }
  @media (max-width: 900px) {
    .section-top {
      align-items: start;
      flex-direction: column;
      gap: 8px;
    }
    .pack-grid {
      grid-template-columns: 1fr;
    }
    .pack-grid > li:first-child {
      grid-row: auto;
    }
    .pack-grid > li:not(:first-child) {
      grid-column: 1;
    }
    .pack-grid > li:not(:first-child) article {
      grid-template-columns: minmax(112px, 0.35fr) minmax(0, 1fr);
      gap: 20px;
    }
    .pack-grid > li:first-child article {
      display: grid;
      grid-template-columns: 1.15fr 1fr;
      align-items: center;
      gap: 24px;
    }
    .pack-grid > li:first-child h3 {
      margin-top: 0;
    }
  }
  @media (max-width: 600px) {
    .packs-section {
      padding: 28px 0;
    }
    .pack-grid > li:first-child article {
      display: block;
    }
    .pack-grid > li:first-child h3 {
      margin-top: 16px;
    }
    .pack-grid > li:not(:first-child) article {
      grid-template-columns: 104px minmax(0, 1fr);
      gap: 16px;
    }
  }
</style>
