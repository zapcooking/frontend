<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { GroceryList } from '$lib/stores/groceryStore';
  import { formatDistanceToNow } from 'date-fns';
  import ShoppingCartIcon from 'phosphor-svelte/lib/ShoppingCart';
  import CheckIcon from 'phosphor-svelte/lib/Check';

  export let list: GroceryList;
  export let selectable = false;
  export let selected = false;

  const dispatch = createEventDispatcher<{ toggle: void }>();

  // Calculate item counts
  $: totalItems = list.items.length;
  $: checkedItems = list.items.filter(item => item.checked).length;
  $: uncheckedItems = totalItems - checkedItems;

  // Format the last updated time
  $: lastUpdated = formatDistanceToNow(list.updatedAt * 1000, { addSuffix: true });

  // Progress percentage
  $: progress = totalItems > 0 ? (checkedItems / totalItems) * 100 : 0;

  $: selectedStyle = selected
    ? 'rgb(34 197 94)'
    : 'var(--color-input-border)';
</script>

{#if selectable}
  <button
    type="button"
    class="group w-full text-left p-4 rounded-2xl transition-all duration-200 cursor-pointer {selected
      ? 'ring-2 ring-green-500'
      : ''}"
    style="background-color: var(--color-bg-secondary); border: 1px solid {selectedStyle};"
    aria-pressed={selected}
    aria-label="{selected ? 'Deselect' : 'Select'} {list.title}"
    on:click={() => dispatch('toggle')}
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <span
            class="w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all {selected
              ? 'bg-green-500 border-green-500'
              : 'border-gray-400 dark:border-gray-400'}"
            aria-hidden="true"
          >
            {#if selected}
              <CheckIcon size={16} weight="bold" class="text-white" />
            {/if}
          </span>
          <div class="min-w-0 flex-1">
            <h3 class="font-semibold truncate" style="color: var(--color-text-primary)">
              {list.title}
            </h3>
            <p class="text-xs text-caption">
              Updated {lastUpdated}
            </p>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        {#if totalItems === 0}
          <span class="text-sm text-caption">No items yet</span>
        {:else}
          <div class="flex items-center gap-1.5">
            <CheckIcon size={16} weight="bold" class="text-green-500" />
            <span class="text-sm" style="color: var(--color-text-primary)">
              {checkedItems}/{totalItems} items
            </span>
          </div>

          {#if uncheckedItems > 0}
            <span class="text-sm text-caption">
              ({uncheckedItems} remaining)
            </span>
          {:else}
            <span class="text-sm text-green-500 font-medium">
              Complete!
            </span>
          {/if}
        {/if}
      </div>

      {#if totalItems > 0}
        <div class="h-1.5 rounded-full overflow-hidden" style="background-color: var(--color-input-bg);">
          <div
            class="h-full rounded-full transition-all duration-300 bg-gradient-to-r from-green-500 to-emerald-500"
            style="width: {progress}%"
          />
        </div>
      {/if}

      {#if list.recipeLinks.length > 0}
        <p class="text-xs text-caption">
          Linked to {list.recipeLinks.length} {list.recipeLinks.length === 1 ? 'recipe' : 'recipes'}
        </p>
      {/if}
    </div>
  </button>
{:else}
  <a
    href="/my-kitchen/grocery/{list.id}"
    class="group block p-4 rounded-2xl transition-all duration-200 hover:scale-[1.02] hover:shadow-lg"
    style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <div class="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center flex-shrink-0">
            <ShoppingCartIcon size={20} weight="fill" class="text-white" />
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="font-semibold truncate" style="color: var(--color-text-primary)">
              {list.title}
            </h3>
            <p class="text-xs text-caption">
              Updated {lastUpdated}
            </p>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        {#if totalItems === 0}
          <span class="text-sm text-caption">No items yet</span>
        {:else}
          <div class="flex items-center gap-1.5">
            <CheckIcon size={16} weight="bold" class="text-green-500" />
            <span class="text-sm" style="color: var(--color-text-primary)">
              {checkedItems}/{totalItems} items
            </span>
          </div>

          {#if uncheckedItems > 0}
            <span class="text-sm text-caption">
              ({uncheckedItems} remaining)
            </span>
          {:else}
            <span class="text-sm text-green-500 font-medium">
              Complete!
            </span>
          {/if}
        {/if}
      </div>

      {#if totalItems > 0}
        <div class="h-1.5 rounded-full overflow-hidden" style="background-color: var(--color-input-bg);">
          <div
            class="h-full rounded-full transition-all duration-300 bg-gradient-to-r from-green-500 to-emerald-500"
            style="width: {progress}%"
          />
        </div>
      {/if}

      {#if list.recipeLinks.length > 0}
        <p class="text-xs text-caption">
          Linked to {list.recipeLinks.length} {list.recipeLinks.length === 1 ? 'recipe' : 'recipes'}
        </p>
      {/if}
    </div>
  </a>
{/if}
