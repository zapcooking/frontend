<script lang="ts">
  import { groceryStore, type GroceryItem } from '$lib/stores/groceryStore';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import TrashIcon from 'phosphor-svelte/lib/Trash';

  export let item: GroceryItem;
  export let listId: string;

  function toggleItem() {
    groceryStore.toggleItem(listId, item.id);
  }

  function removeItem() {
    groceryStore.removeItem(listId, item.id);
  }
</script>

<div 
  class="group flex items-center gap-3 p-3 rounded-xl transition-all {item.checked ? 'opacity-60' : ''}"
  style="background-color: var(--color-bg-secondary);"
>
  <!-- Checkbox -->
  <button
    on:click={toggleItem}
    class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all {item.checked 
      ? 'bg-green-500 border-green-500' 
      : 'border-gray-300 dark:border-gray-600 hover:border-green-400'}"
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
    {#if item.quantity}
      <span class="text-sm text-caption">
        {item.quantity}
      </span>
    {/if}
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
