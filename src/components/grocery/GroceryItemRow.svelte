<script lang="ts">
  import { groceryStore, type GroceryItem } from '$lib/stores/groceryStore';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import DotsSixVerticalIcon from 'phosphor-svelte/lib/DotsSixVertical';

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

  function toggleItem() {
    groceryStore.toggleItem(listId, item.id);
  }

  function removeItem() {
    groceryStore.removeItem(listId, item.id);
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
  class="group flex items-center gap-3 p-3 rounded-xl transition-all
    {item.checked ? 'opacity-60' : ''}
    {isDragged ? 'opacity-50' : ''}
    {isDragOver ? 'ring-2 ring-primary' : ''}"
  style="background-color: var(--color-bg-secondary);"
>
  <!-- Drag handle -->
  <div
    class="cursor-grab active:cursor-grabbing text-caption hover:text-primary flex-shrink-0 touch-none mr-1"
    title="Drag to reorder"
    aria-label="Drag to reorder"
    role="img"
  >
    <DotsSixVerticalIcon size={20} weight="bold" />
  </div>

  <!-- Checkbox -->
  <button
    on:click={toggleItem}
    class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all {item.checked
      ? 'bg-green-500 border-green-500'
      : 'border-gray-400 dark:border-gray-400 hover:border-green-400'}"
    aria-label={item.checked ? 'Uncheck item' : 'Check item'}
  >
    {#if item.checked}
      <CheckIcon size={14} weight="bold" class="text-white" />
    {/if}
  </button>

  <!-- Item details -->
  <div class="flex-1 min-w-0">
    <span 
      class="block {item.checked ? 'line-through' : ''}"
      style="color: var(--color-text-primary)"
    >
      {item.name}
    </span>
    <span class="text-sm text-caption">
      {item.quantity || '1'}
    </span>
  </div>

  <!-- Delete button -->
  <button
    on:click={removeItem}
    class="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/10"
    style="color: var(--color-danger)"
    aria-label="Remove item"
  >
    <TrashIcon size={16} />
  </button>
</div>
