<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import type { DirectionPhase } from '$lib/parser';

  export let phases: DirectionPhase[];
  export let recipeId: string = '';

  // Directions are no longer grouped into phases — render every step as a
  // single flat numbered list. Prop shape kept for call-site compatibility.
  $: steps = phases.flatMap((p) => p.steps);

  // Check state persisted per-recipe in localStorage, same pattern as
  // Ingredients. Keyed by step number (stable across the flattened list).
  const STORAGE_PREFIX = 'recipe_directions_checked:';
  let checked: Set<number> = new Set();

  $: storageKey = `${STORAGE_PREFIX}${recipeId}`;

  onMount(() => {
    if (!browser || !recipeId) return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const nums = JSON.parse(stored) as number[];
        checked = new Set(nums);
      }
    } catch {
      // ignore
    }
  });

  function toggle(n: number) {
    const next = new Set(checked);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    checked = next;
    if (browser && recipeId) {
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // ignore
      }
    }
  }

  function clearAll() {
    checked = new Set();
    if (browser && recipeId) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
  }
</script>

{#if steps.length > 0}
  <div class="directions-phases">
    <div class="flex items-baseline justify-between mb-4">
      <h2 class="text-2xl font-bold">Directions</h2>
      {#if checked.size > 0}
        <button
          type="button"
          class="text-sm text-caption hover:text-primary transition-colors px-2 py-1 rounded cursor-pointer print:hidden"
          on:click={clearAll}
          aria-label="Clear checked steps"
        >
          Clear
        </button>
      {/if}
    </div>
    <div
      id="directions"
      class="rounded-lg border border-input-border p-4"
      style="background-color: var(--color-bg-secondary);"
    >
      <ol class="flex flex-col gap-1 list-none">
        {#each steps as step (step.number)}
          <li>
            <button
              type="button"
              class="flex items-start gap-3 w-full text-left py-1.5 rounded group cursor-pointer hover:bg-accent-gray/50 transition-colors"
              on:click={() => toggle(step.number)}
              aria-pressed={checked.has(step.number)}
            >
              <span
                class="flex-shrink-0 w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center transition-colors"
                style={checked.has(step.number)
                  ? 'background: var(--color-primary); border-color: var(--color-primary); color: white;'
                  : 'border-color: var(--color-input-border);'}
                aria-hidden="true"
              >
                {#if checked.has(step.number)}
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M2 6l3 3 5-6"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                {/if}
              </span>
              <span
                class="font-semibold text-primary flex-shrink-0"
                class:struck={checked.has(step.number)}>{step.number}.</span
              >
              <span class="flex-1" class:struck={checked.has(step.number)}>{step.text}</span>
            </button>
          </li>
        {/each}
      </ol>
    </div>
  </div>
{/if}

<style>
  .directions-phases {
    margin-top: 1.5rem;
  }

  .struck {
    text-decoration: line-through;
    color: var(--color-caption);
  }

  @media print {
    .directions-phases button {
      cursor: default;
    }
  }
</style>
