<script lang="ts">
  /**
   * "From the recipe box": an older recipe shown as a recipe, not a post.
   * Hero photo with the title over it, detail chips, a three-ingredient
   * peek and the two things to do with it (view, save). The hero is
   * FreshRecipeBoxHero, above the post header; this is what goes below it.
   * Every part is optional ($lib/freshFeed/recipeBoxCard).
   */
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { RecipeBoxData } from '$lib/freshFeed/recipeBoxCard';
  import SaveButton from './SaveButton.svelte';
  import ClockIcon from 'phosphor-svelte/lib/Clock';
  import CookingPotIcon from 'phosphor-svelte/lib/CookingPot';
  import UsersIcon from 'phosphor-svelte/lib/Users';
  import TagIcon from 'phosphor-svelte/lib/Tag';

  export let data: RecipeBoxData;
  export let event: NDKEvent;
  /** The relay's top topic for this recipe (members), or null. */
  export let topic: string | null = null;
  /** The hero shows the title; without one it goes here. */
  export let hasHero = false;

  const CHIP_ICONS = { prep: ClockIcon, cook: CookingPotIcon, servings: UsersIcon };
</script>

{#if !hasHero}
  <h3 class="box-title">
    {#if data.href}<a href={data.href}>{data.title}</a>{:else}{data.title}{/if}
  </h3>
{/if}

{#if data.chips.length || topic}
  <ul class="box-chips">
    {#each data.chips as chip (chip.key)}
      <li class="box-chip">
        <svelte:component this={CHIP_ICONS[chip.key]} size={14} weight="bold" />
        {chip.label}
      </li>
    {/each}
    {#if topic}
      <li class="box-chip box-chip-topic">
        <TagIcon size={14} weight="bold" />
        {topic}
      </li>
    {/if}
  </ul>
{/if}

{#if data.ingredients.length}
  <div class="box-peek">
    <p class="box-peek-label">Ingredients</p>
    <ul>
      {#each data.ingredients as ingredient}
        <li>{ingredient}</li>
      {/each}
    </ul>
    {#if data.moreIngredients > 0}
      <p class="box-peek-more">+{data.moreIngredients} more</p>
    {/if}
  </div>
{/if}

<div class="box-actions">
  {#if data.href}
    <a href={data.href} class="box-view">View recipe</a>
  {/if}
  <SaveButton
    {event}
    size="md"
    variant="secondary"
    showText={true}
    block={true}
    text="Save to cookbook"
    savedText="Saved"
  />
</div>

<style>
  .box-title {
    margin: 0 0 0.75rem;
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1.25;
    color: var(--color-text-primary);
  }

  .box-title a:hover {
    color: var(--color-primary);
  }

  .box-chips {
    list-style: none;
    margin: 0 0 0.875rem;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .box-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.625rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--box-ink);
    background: var(--box-chip);
  }

  .box-chip-topic {
    color: var(--color-primary);
  }

  .box-peek {
    margin: 0 0 1rem;
    padding: 0.75rem 0.875rem;
    border-radius: 0.75rem;
    background: var(--box-chip);
    /* Index-card rule lines. */
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent 1.4rem,
      var(--box-rule) 1.4rem,
      var(--box-rule) calc(1.4rem + 1px)
    );
    background-position: 0 1.9rem;
  }

  .box-peek-label {
    margin: 0 0 0.25rem;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--box-ink);
  }

  .box-peek ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .box-peek li {
    font-size: 0.875rem;
    line-height: 1.4rem;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .box-peek li::before {
    content: '•';
    margin-right: 0.5rem;
    color: var(--box-ink);
  }

  .box-peek-more {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4rem;
    font-weight: 600;
    color: var(--box-ink);
  }

  /* Stacked full-width on phones (the pair doesn't fit a 390px card side
     by side); side by side from 480px. */
  .box-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  @media (min-width: 480px) {
    .box-actions {
      grid-template-columns: auto auto;
      justify-content: start;
    }
  }

  .box-view {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 2.5rem;
    padding: 0 1.125rem;
    border-radius: 999px;
    font-size: 0.875rem;
    font-weight: 600;
    color: #fff;
    background: var(--color-primary);
    transition: filter 0.2s;
  }

  .box-view:hover {
    filter: brightness(1.08);
  }
</style>
