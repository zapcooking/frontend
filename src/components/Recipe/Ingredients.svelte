<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  export let items: string[] = [];
  export let recipeId: string;

  // Check state persisted per-recipe in localStorage keyed by event id.
  // Keyed by index; edits that change ingredient ordering invalidate
  // existing checks — acceptable for this cooking-UX use case.
  const STORAGE_PREFIX = 'recipe_ingredients_checked:';
  let checked: Set<number> = new Set();

  $: storageKey = `${STORAGE_PREFIX}${recipeId}`;

  onMount(() => {
    if (!browser || !recipeId) return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const indices = JSON.parse(stored) as number[];
        checked = new Set(indices);
      }
    } catch {
      // ignore corrupt entries
    }
  });

  function toggle(index: number) {
    const next = new Set(checked);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    checked = next;
    if (browser && recipeId) {
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // quota exceeded / disabled — state still works in-memory
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

{#if items.length > 0}
  <div id="ingredients-section" class="ingredients-section">
    <div class="flex items-baseline justify-between mb-4">
      <h2 class="text-2xl font-bold">Ingredients</h2>
      {#if checked.size > 0}
        <button
          type="button"
          class="text-sm text-caption hover:text-primary transition-colors px-2 py-1 rounded cursor-pointer print:hidden"
          on:click={clearAll}
          aria-label="Clear checked ingredients"
        >
          Clear
        </button>
      {/if}
    </div>
    <ul class="flex flex-col gap-0.5 list-none">
      {#each items as item, i (i)}
        <li>
          <button
            type="button"
            class="flex items-start gap-3 w-full text-left py-1.5 rounded group cursor-pointer hover:bg-accent-gray/50 transition-colors"
            on:click={() => toggle(i)}
            aria-pressed={checked.has(i)}
          >
            <span
              class="flex-shrink-0 w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center transition-colors"
              class:is-checked={checked.has(i)}
              style={checked.has(i)
                ? 'background: var(--color-primary); border-color: var(--color-primary); color: white;'
                : 'border-color: var(--color-input-border);'}
              aria-hidden="true"
            >
              {#if checked.has(i)}
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
            <span class="flex-1" class:struck={checked.has(i)}>{item}</span>
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .ingredients-section {
    margin-top: 1.5rem;
  }

  .struck {
    text-decoration: line-through;
    color: var(--color-caption);
  }

  @media print {
    .ingredients-section button {
      cursor: default;
    }
  }
</style>
