<script lang="ts">
  import BookOpen from 'phosphor-svelte/lib/BookOpen';
  import type { PackCard } from '$lib/landing/content';
  import { userHref } from '$lib/landing/content';
  import { magazineName, magazineText } from '$lib/landing/display';
  import Arrow from './Arrow.svelte';
  import LandingImage from './LandingImage.svelte';

  export let packs: PackCard[] = [];
</script>

{#if packs.length}
  <section class="packs-section" aria-labelledby="packs-heading">
    <div class="section-top">
      <div>
        <p class="eyebrow">Collected by the community</p>
        <h2 id="packs-heading">Recipe packs</h2>
        <p class="section-description">Favorite recipes, gathered into packs to save and share.</p>
      </div>
      <a class="text-link" href="/packs">All recipe packs <Arrow /></a>
    </div>
    <ul class="pack-grid" role="list">
      {#each packs.slice(0, 3) as pack (pack.coordinate)}
        <li>
          <article>
            <a href={pack.href} class="pack-link">
              <div class="pack-cover">
                {#if pack.image}
                  <LandingImage
                    url={pack.image}
                    alt=""
                    ratio="16 / 9"
                    sizes="(min-width: 1280px) 24vw, (min-width: 1024px) 25vw, (min-width: 768px) 30vw, 100vw"
                  />
                {:else}
                  <div class="pack-placeholder" aria-hidden="true">
                    <BookOpen size={48} weight="light" />
                  </div>
                {/if}
                <span class="recipe-count"
                  >{pack.recipeCount} {pack.recipeCount === 1 ? 'recipe' : 'recipes'}</span
                >
              </div>
              <h3>{magazineText(pack.title) || 'Recipe pack'} <Arrow /></h3>
            </a>
            {#if magazineText(pack.description)}<p class="description">
                {magazineText(pack.description)}
              </p>{/if}
            <a class="byline" href={userHref(pack.author.pubkey)}
              >By {magazineName(pack.author.name)}</a
            >
          </article>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .packs-section {
    padding: 44px 0;
    border-top: 1px solid var(--color-input-border);
  }
  .section-top {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 22px;
  }
  .eyebrow {
    margin: 0 0 8px;
    color: var(--landing-accent-text);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  h2 {
    margin: 0;
    font-size: clamp(24px, 2.6vw, 30px);
    line-height: 1.13;
  }
  .section-description {
    margin: 10px 0 0;
    font-size: 14px;
    line-height: 1.6;
    color: var(--color-text-secondary);
  }
  .text-link {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    flex-shrink: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .pack-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 24px;
  }
  .pack-link {
    display: block;
  }
  .pack-cover {
    position: relative;
  }
  .pack-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    background: var(--color-bg-secondary);
    color: var(--landing-accent-text);
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
  h3 {
    margin: 14px 0 0;
    font-size: 20px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  h3 :global(svg) {
    margin-left: 4px;
  }
  .description {
    margin: 8px 0 0;
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
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  @media (max-width: 767px) {
    .packs-section {
      padding: 30px 0;
    }
    .section-top {
      align-items: start;
      gap: 12px;
    }
    h2 {
      font-size: 28px;
    }
    .text-link {
      max-width: 105px;
      font-size: 12px;
      text-align: right;
    }
    .pack-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
