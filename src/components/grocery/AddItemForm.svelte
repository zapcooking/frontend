<script lang="ts">
  import { groceryStore, inferCategory, type GroceryCategory } from '$lib/stores/groceryStore';
  import PlusIcon from 'phosphor-svelte/lib/Plus';

  export let listId: string;

  let itemName = '';
  let itemQuantity = '';
  let itemCategory: GroceryCategory = 'other';
  let nameInput: HTMLInputElement;

  const categories: { value: GroceryCategory; label: string; emoji: string }[] = [
    { value: 'produce', label: 'Produce', emoji: '🥬' },
    { value: 'protein', label: 'Protein', emoji: '🥩' },
    { value: 'dairy', label: 'Dairy', emoji: '🧀' },
    { value: 'pantry', label: 'Pantry', emoji: '🥫' },
    { value: 'frozen', label: 'Frozen', emoji: '🧊' },
    { value: 'other', label: 'Other', emoji: '📦' }
  ];

  // Auto-infer category when name changes, but only while using the default category
  $: if (itemName && itemCategory === 'other') {
    itemCategory = inferCategory(itemName);
  }

  function addItem() {
    if (!itemName.trim()) return;

    groceryStore.addItem(
      listId,
      itemName.trim(),
      itemQuantity.trim(),
      itemCategory
    );

    // Clear form
    itemName = '';
    itemQuantity = '';
    itemCategory = 'other';

    // Refocus input for quick entry
    nameInput?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addItem();
    }
  }
</script>

<form 
  on:submit|preventDefault={addItem}
  class="flex flex-col gap-3 p-4 rounded-2xl"
  style="background-color: var(--color-bg-secondary);"
>
  <div class="flex flex-col sm:flex-row gap-3">
    <!-- Item name -->
    <div class="flex-1">
      <input
        bind:this={nameInput}
        bind:value={itemName}
        on:keydown={handleKeydown}
        type="text"
        placeholder="Add an item..."
        class="input w-full"
        autocomplete="off"
      />
    </div>

    <!-- Quantity -->
    <div class="w-full sm:w-32">
      <input
        bind:value={itemQuantity}
        on:keydown={handleKeydown}
        type="text"
        placeholder="Qty"
        class="input w-full"
        autocomplete="off"
      />
    </div>

    <!-- Category dropdown -->
    <div class="w-full sm:w-40">
      <select
        bind:value={itemCategory}
        class="input w-full cursor-pointer"
      >
        {#each categories as cat}
          <option value={cat.value}>{cat.emoji} {cat.label}</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- Add button -->
  <button
    type="submit"
    disabled={!itemName.trim()}
    class="flex items-center justify-center gap-2 px-4 py-2 border border-green-500/40 text-green-500 hover:bg-green-500/10 rounded-xl font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <PlusIcon size={18} weight="bold" />
    <span>Add Item</span>
  </button>
</form>
