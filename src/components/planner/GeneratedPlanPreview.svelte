<script lang="ts">
  /**
   * Preview of a Cheffy-generated week before it is written to the planner.
   * Meals stay local until the user approves.
   */
  import { createEventDispatcher } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import type { MealPlanDayKey, MealSlotKey } from '$lib/mealplan/schema';
  import { DAY_KEYS } from '$lib/mealplan/schema';
  import type { GeneratedMeal } from '$lib/mealplan/generation';
  import { slotKey } from '$lib/mealplan/generation';
  import { pantryMatchSummary } from '$lib/pantry/matching';
  import { getImageOrPlaceholder, getPlaceholderImage } from '$lib/placeholderImages';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import EyeIcon from 'phosphor-svelte/lib/Eye';
  import XIcon from 'phosphor-svelte/lib/X';

  export let meals: GeneratedMeal[] = [];
  export let swappingKey: string | null = null;
  export let applying = false;
  export let regenerating = false;
  export let showPantry = false;

  const dispatch = createEventDispatcher<{
    apply: void;
    regenerate: void;
    swap: GeneratedMeal;
    remove: GeneratedMeal;
    view: GeneratedMeal;
  }>();

  const DAY_LABELS: Record<MealPlanDayKey, string> = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday'
  };
  const SLOT_LABELS: Record<MealSlotKey, string> = {
    breakfast: 'Breakfast',
    lunch: 'Lunch',
    dinner: 'Dinner',
    snack: 'Snack'
  };

  $: grouped = DAY_KEYS.map((day) => ({
    day,
    meals: meals.filter((m) => m.day === day)
  })).filter((g) => g.meals.length > 0);

  function recipeHref(a: string): string | null {
    const parts = a.split(':');
    if (parts.length !== 3) return null;
    try {
      return `/recipe/${nip19.naddrEncode({
        kind: Number(parts[0]),
        pubkey: parts[1],
        identifier: parts[2]
      })}`;
    } catch {
      return null;
    }
  }

  function openRecipe(meal: GeneratedMeal) {
    const href = recipeHref(meal.a);
    if (href) window.open(href, '_blank', 'noopener');
    dispatch('view', meal);
  }

  function handleThumbError(event: Event, seed: string) {
    const img = event.currentTarget as HTMLImageElement;
    const fallback = getPlaceholderImage(seed);
    if (img.src !== fallback) img.src = fallback;
  }
</script>

<div class="flex flex-col gap-4">
  {#if meals.length === 0}
    <p class="text-sm text-caption">Cheffy did not keep any meals in this preview.</p>
  {:else}
    <div class="flex flex-col gap-3">
      {#each grouped as group (group.day)}
        <section
          class="rounded-xl p-3 flex flex-col gap-2"
          style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
        >
          <h3 class="text-sm font-semibold" style="color: var(--color-text-primary);">
            {DAY_LABELS[group.day]}
          </h3>
          {#each group.meals as meal (slotKey(meal.day, meal.slot))}
            {@const busy = swappingKey === slotKey(meal.day, meal.slot)}
            <div
              class="flex flex-col gap-1.5 rounded-lg px-2.5 py-2"
              style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
            >
              <div class="flex items-start gap-2.5">
                <button
                  type="button"
                  class="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0"
                  style="background-color: var(--color-accent-gray);"
                  aria-label="View {meal.title}"
                  disabled={busy || applying || regenerating}
                  on:click={() => openRecipe(meal)}
                >
                  <img
                    src={getImageOrPlaceholder(meal.image, meal.a)}
                    alt=""
                    width="56"
                    height="56"
                    loading="lazy"
                    class="w-full h-full object-cover"
                    on:error={(e) => handleThumbError(e, meal.a)}
                  />
                </button>
                <div class="min-w-0 flex-1">
                  <p class="text-[11px] uppercase tracking-wide text-caption">
                    {SLOT_LABELS[meal.slot]}
                  </p>
                  <p class="text-sm font-medium truncate" style="color: var(--color-text-primary);">
                    {meal.title}
                  </p>
                  {#if meal.reason}
                    <p class="text-xs text-caption mt-0.5">{meal.reason}</p>
                  {/if}
                  {#if showPantry && meal.pantry && meal.pantry.totalCount > 0}
                    <p class="text-xs mt-0.5" style="color: var(--color-text-secondary);">
                      ✓ {pantryMatchSummary(meal.pantry)}
                      {#if meal.pantry.missingIngredients.length}
                        <span class="text-caption">
                          · Need: {meal.pantry.missingIngredients.slice(0, 4).join(', ')}{meal
                            .pantry.missingIngredients.length > 4
                            ? '…'
                            : ''}
                        </span>
                      {/if}
                    </p>
                  {/if}
                </div>
                <button
                  type="button"
                  class="p-1.5 rounded-full hover:bg-accent-gray text-caption"
                  aria-label="Remove {meal.title}"
                  disabled={busy || applying || regenerating}
                  on:click={() => dispatch('remove', meal)}
                >
                  <XIcon size={14} />
                </button>
              </div>
              <div class="flex gap-2 flex-wrap">
                <button
                  type="button"
                  class="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium hover:bg-accent-gray"
                  style="border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
                  disabled={busy || applying || regenerating}
                  on:click={() => openRecipe(meal)}
                >
                  <EyeIcon size={12} />
                  View
                </button>
                <button
                  type="button"
                  class="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium hover:bg-accent-gray disabled:opacity-50"
                  style="border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
                  disabled={busy || applying || regenerating}
                  on:click={() => dispatch('swap', meal)}
                >
                  <ArrowsClockwiseIcon size={12} class={busy ? 'animate-spin' : ''} />
                  {busy ? 'Swapping…' : 'Swap'}
                </button>
              </div>
            </div>
          {/each}
        </section>
      {/each}
    </div>
  {/if}

  <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
    <button
      type="button"
      class="px-4 py-2 rounded-full text-sm font-medium hover:bg-accent-gray disabled:opacity-50"
      style="border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
      disabled={applying || regenerating || !!swappingKey}
      on:click={() => dispatch('regenerate')}
    >
      {regenerating ? 'Regenerating…' : 'Regenerate plan'}
    </button>
    <button
      type="button"
      class="px-4 py-2 rounded-full text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all disabled:opacity-50"
      disabled={applying || regenerating || meals.length === 0 || !!swappingKey}
      on:click={() => dispatch('apply')}
    >
      {applying ? 'Adding…' : 'Add meals to my planner'}
    </button>
  </div>
</div>
