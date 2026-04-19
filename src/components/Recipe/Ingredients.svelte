<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { scaleIngredientLine } from '$lib/ingredientScaling';

  export let items: string[] = [];
  export let recipeId: string;

  // Presets a home cook actually reaches for — half, original, double, triple.
  const SCALE_PRESETS: Array<{ value: number; label: string }> = [
    { value: 0.5, label: '½×' },
    { value: 1, label: '1×' },
    { value: 2, label: '2×' },
    { value: 3, label: '3×' }
  ];

  // Check state & scale persisted per-recipe in localStorage.
  const CHECKED_KEY = 'recipe_ingredients_checked:';
  const SCALE_KEY = 'recipe_ingredients_scale:';

  let checked: Set<number> = new Set();
  let scale = 1;

  $: checkedStorageKey = `${CHECKED_KEY}${recipeId}`;
  $: scaleStorageKey = `${SCALE_KEY}${recipeId}`;
  $: scaledItems = items.map((item) => scaleIngredientLine(item, scale));

  onMount(() => {
    if (!browser || !recipeId) return;
    try {
      const storedChecked = localStorage.getItem(checkedStorageKey);
      if (storedChecked) {
        const indices = JSON.parse(storedChecked) as number[];
        checked = new Set(indices);
      }
      const storedScale = localStorage.getItem(scaleStorageKey);
      if (storedScale) {
        const n = parseFloat(storedScale);
        if (Number.isFinite(n) && n > 0) scale = n;
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
        localStorage.setItem(checkedStorageKey, JSON.stringify([...next]));
      } catch {
        // quota / disabled — state still works in-memory
      }
    }
  }

  function setScale(n: number) {
    scale = n;
    if (browser && recipeId) {
      try {
        if (n === 1) localStorage.removeItem(scaleStorageKey);
        else localStorage.setItem(scaleStorageKey, String(n));
      } catch {
        // ignore
      }
    }
  }

  function clearAll() {
    checked = new Set();
    if (browser && recipeId) {
      try {
        localStorage.removeItem(checkedStorageKey);
      } catch {
        // ignore
      }
    }
  }
</script>

{#if items.length > 0}
  <div id="ingredients-section" class="ingredients-section">
    <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">
      <h2 class="text-2xl font-bold">Ingredients</h2>
      <div class="flex items-center gap-2 print:hidden">
        <div
          class="flex items-center rounded-full border overflow-hidden"
          style="border-color: var(--color-input-border);"
          role="group"
          aria-label="Scale ingredients"
        >
          {#each SCALE_PRESETS as preset}
            <button
              type="button"
              class="px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
              class:is-active={scale === preset.value}
              style={scale === preset.value
                ? 'background: var(--color-primary); color: white;'
                : 'color: var(--color-text-primary);'}
              on:click={() => setScale(preset.value)}
              aria-pressed={scale === preset.value}
            >
              {preset.label}
            </button>
          {/each}
        </div>
        {#if checked.size > 0}
          <button
            type="button"
            class="text-sm text-caption hover:text-primary transition-colors px-2 py-1 rounded cursor-pointer"
            on:click={clearAll}
            aria-label="Clear checked ingredients"
          >
            Clear
          </button>
        {/if}
      </div>
    </div>
    {#if scale !== 1}
      <p class="text-xs text-caption mb-3">
        Scaled to {scale}× — directions and cook times are unchanged.
      </p>
    {/if}
    <ul class="flex flex-col gap-0.5 list-none">
      {#each scaledItems as item, i (i)}
        <li>
          <button
            type="button"
            class="flex items-start gap-3 w-full text-left py-1.5 rounded group cursor-pointer hover:bg-accent-gray/50 transition-colors"
            on:click={() => toggle(i)}
            aria-pressed={checked.has(i)}
          >
            <span
              class="flex-shrink-0 w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center transition-colors"
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
