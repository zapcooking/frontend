<script lang="ts">
  import { groceryStore, inferGroceryCategory } from '$lib/stores/groceryStore';
  import {
    GROCERY_CATEGORIES,
    GROCERY_CATEGORY_EMOJI,
    GROCERY_CATEGORY_LABELS,
    type GroceryAisle
  } from '$lib/grocery/categories';
  import PlusIcon from 'phosphor-svelte/lib/Plus';

  export let listId: string;

  let itemName = '';
  let itemQuantity = '';
  let itemCategory: GroceryAisle = 'other';
  let nameInput: HTMLInputElement;
  let categoryTouched = false;

  $: if (itemName && !categoryTouched) {
    itemCategory = inferGroceryCategory(itemName);
  }

  function addItem() {
    if (!itemName.trim()) return;

    groceryStore.addItem(
      listId,
      itemName.trim(),
      itemQuantity.trim(),
      itemCategory
    );

    itemName = '';
    itemQuantity = '';
    itemCategory = 'other';
    categoryTouched = false;
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

    <div class="w-full sm:w-52">
      <select
        bind:value={itemCategory}
        on:change={() => (categoryTouched = true)}
        class="input w-full cursor-pointer"
      >
        {#each GROCERY_CATEGORIES as cat}
          <option value={cat}>{GROCERY_CATEGORY_EMOJI[cat]} {GROCERY_CATEGORY_LABELS[cat]}</option>
        {/each}
      </select>
    </div>
  </div>

  <button
    type="submit"
    disabled={!itemName.trim()}
    class="flex items-center justify-center gap-2 px-4 py-2.5 border border-green-500/40 text-green-500 hover:bg-green-500/10 rounded-xl font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <PlusIcon size={18} weight="bold" />
    <span>Add Item</span>
  </button>
</form>
