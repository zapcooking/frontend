<script lang="ts">
  import { groceryStore, type GroceryItem } from '$lib/stores/groceryStore';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import DotsSixVerticalIcon from 'phosphor-svelte/lib/DotsSixVertical';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import CaretUpIcon from 'phosphor-svelte/lib/CaretUp';

  export let item: GroceryItem;
  export let listId: string;
  export let index: number;
  export let isDragged: boolean = false;
  export let isDragOver: boolean = false;
  export let onDragStart: (e: DragEvent, index: number) => void = () => {};
  export let onDragOver: (e: DragEvent, index: number) => void = () => {};
  export let onDrop: (e: DragEvent, index: number) => void = () => {};
  export let onDragEnd: () => void = () => {};
  export let onDragLeave: () => void = () => {};

  let sourcesOpen = false;

  $: recipeTitles = uniqueRecipeTitles(item);

  function uniqueRecipeTitles(current: GroceryItem): string[] {
    const titles = new Map<string, string>();
    for (const source of current.sources || []) {
      const label = source.recipeTitle || source.recipeId.split(':').slice(2).join(':');
      if (label && !titles.has(source.recipeId)) titles.set(source.recipeId, label);
    }
    if (titles.size === 0 && current.recipeId) {
      titles.set(current.recipeId, current.recipeId.split(':').slice(2).join(':'));
    }
    return [...titles.values()];
  }

  function toggleItem() {
    groceryStore.toggleItem(listId, item.id);
  }

  function removeItem() {
    groceryStore.removeItem(listId, item.id);
  }

  function toggleSources() {
    sourcesOpen = !sourcesOpen;
  }

  function returnToPantry() {
    groceryStore.returnPantryOverride(listId, item.id);
  }
</script>

<div
  role="listitem"
  draggable="true"
  on:dragstart={(e) => onDragStart(e, index)}
  on:dragover|preventDefault={(e) => onDragOver(e, index)}
  on:drop|preventDefault={(e) => onDrop(e, index)}
  on:dragend={onDragEnd}
  on:dragleave={onDragLeave}
  class="group flex items-start gap-2 sm:gap-3 p-3 rounded-xl transition-all
    {item.checked ? 'opacity-60' : ''}
    {isDragged ? 'opacity-50' : ''}
    {isDragOver ? 'ring-2 ring-primary' : ''}"
  style="background-color: var(--color-bg-secondary);"
>
  <div
    class="hidden sm:flex cursor-grab active:cursor-grabbing text-caption hover:text-primary flex-shrink-0 touch-none mt-1"
    title="Drag to reorder"
    aria-label="Drag to reorder"
    role="img"
  >
    <DotsSixVerticalIcon size={18} weight="bold" />
  </div>
  <button
    type="button"
    on:click={toggleItem}
    class="mt-0.5 w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all {item.checked
      ? 'bg-green-500 border-green-500'
      : 'border-gray-400 dark:border-gray-400 hover:border-green-400'}"
    aria-label={item.checked ? 'Uncheck item' : 'Check item'}
  >
    {#if item.checked}
      <CheckIcon size={16} weight="bold" class="text-white" />
    {/if}
  </button>

  <div class="flex-1 min-w-0">
    <button
      type="button"
      on:click={toggleItem}
      class="flex w-full text-left gap-2 items-baseline min-h-[28px]"
    >
      <span
        class="font-medium {item.checked ? 'line-through' : ''}"
        style="color: var(--color-text-primary)"
      >
        {item.name}{#if item.quantity}<span class="font-normal text-caption"> — {item.quantity}</span>{/if}
      </span>
    </button>

    {#if recipeTitles.length > 0}
      <button
        type="button"
        on:click={toggleSources}
        class="mt-1 flex items-center gap-1 text-xs text-caption hover:opacity-80"
        aria-expanded={sourcesOpen}
      >
        {#if sourcesOpen}
          <CaretUpIcon size={12} />
        {:else}
          <CaretDownIcon size={12} />
        {/if}
        Used in {recipeTitles.length}
        {recipeTitles.length === 1 ? 'recipe' : 'recipes'}
      </button>
      {#if sourcesOpen}
        <ul class="mt-1 pl-4 text-xs text-caption list-disc">
          {#each recipeTitles as title}
            <li>{title}</li>
          {/each}
        </ul>
      {/if}
    {/if}

    {#if item.pantryOverride}
      <button
        type="button"
        on:click={returnToPantry}
        class="mt-1.5 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border border-green-500/40 text-green-500 hover:bg-green-500/10 transition-colors"
        aria-label="I have {item.name}"
      >
        I have this
      </button>
    {/if}
  </div>

  <button
    type="button"
    on:click={removeItem}
    class="p-2 rounded-lg sm:opacity-0 sm:group-hover:opacity-100 transition-all hover:bg-red-500/10 flex-shrink-0"
    style="color: var(--color-danger)"
    aria-label="Remove item"
  >
    <TrashIcon size={18} />
  </button>
</div>
