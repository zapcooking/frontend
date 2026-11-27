<script lang="ts">
  /**
   * The recipe being cooked on a live stream: title and photo, a credit to
   * the recipe's author (who may not be the host), and the same ingredient
   * checklist and step list as the recipe page, with the same per-recipe
   * check marks. Parsing is shared with the recipe page ($lib/recipe/sections).
   *
   * The host page passes `checkScope` (one per stream), so the host's checks
   * start fresh each stream and leave the recipe page's own checks alone,
   * and `size="host"` for larger text read from across the kitchen.
   */
  import { nip19 } from 'nostr-tools';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import CustomName from '../CustomName.svelte';
  import Ingredients from '../Recipe/Ingredients.svelte';
  import DirectionsPhases from '../Recipe/DirectionsPhases.svelte';
  import { recipeSections } from '$lib/recipe/sections';
  import { recipeCardOf } from '$lib/streams/recipeCard';

  export let recipe: NDKEvent | null;
  export let loading = false;
  /** Prefix for the check-mark storage key; null uses the recipe's own. */
  export let checkScope: string | null = null;
  export let size: 'default' | 'host' = 'default';

  $: card = recipeCardOf(recipe);
  $: sections = recipe ? recipeSections(recipe.content) : { ingredients: [], directions: [] };
  $: href = recipe ? recipeHref(recipe) : null;
  $: checkId = recipe ? (checkScope ? `${checkScope}:${recipe.id}` : recipe.id) : '';

  function recipeHref(e: NDKEvent): string | null {
    try {
      return `/recipe/${nip19.naddrEncode({ identifier: e.replaceableDTag(), pubkey: e.pubkey, kind: e.kind || 30023 })}`;
    } catch {
      return null;
    }
  }
</script>

<section
  class="recipe-panel flex flex-col gap-4 rounded-xl border p-4"
  class:host={size === 'host'}
  style="border-color: var(--color-input-border); background-color: var(--color-bg-primary);"
  aria-label="Recipe"
>
  {#if loading && !recipe}
    <div class="flex items-center gap-3" aria-busy="true">
      <div class="h-14 w-14 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800"></div>
      <div class="flex-1 space-y-2">
        <div class="h-4 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div>
        <div class="h-3 w-1/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div>
      </div>
    </div>
  {:else if recipe && card}
    <header class="flex items-center gap-3">
      {#if card.image}
        <img
          src={card.image}
          alt=""
          class="h-14 w-14 shrink-0 rounded-lg object-cover"
          loading="lazy"
        />
      {/if}
      <div class="min-w-0">
        <p
          class="text-xs font-semibold uppercase tracking-wide"
          style="color: var(--color-caption);"
        >
          Cooking
        </p>
        {#if href}
          <a
            {href}
            class="block truncate text-base font-semibold hover:underline"
            style="color: var(--color-text-primary);"
          >
            {card.title}
          </a>
        {:else}
          <p class="truncate text-base font-semibold" style="color: var(--color-text-primary);">
            {card.title}
          </p>
        {/if}
        <p class="truncate text-xs" style="color: var(--color-caption);">
          Recipe by <CustomName pubkey={recipe.pubkey} className="font-medium" />
        </p>
      </div>
    </header>

    {#if sections.ingredients.length > 0}
      {#key checkId}
        <Ingredients items={sections.ingredients} recipeId={checkId} />
      {/key}
    {/if}
    {#if sections.directions.length > 0}
      {#key checkId}
        <DirectionsPhases phases={sections.directions} recipeId={checkId} />
      {/key}
    {/if}
    {#if sections.ingredients.length === 0 && sections.directions.length === 0 && href}
      <a
        {href}
        class="text-sm font-semibold hover:underline"
        style="color: var(--color-text-primary);"
      >
        Open the recipe
      </a>
    {/if}
  {:else}
    <p class="text-sm" style="color: var(--color-caption);">
      The recipe for this stream could not be loaded.
    </p>
  {/if}
</section>

<style>
  /* Host: read at arm's length while cooking, tapped with wet fingers. */
  .recipe-panel.host {
    font-size: 1.125rem;
    line-height: 1.6;
  }
  .recipe-panel.host :global(li > button) {
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
  }
  .recipe-panel.host :global(li > button > span:first-child) {
    width: 1.5rem;
    height: 1.5rem;
    margin-top: 0.15rem;
  }
</style>
