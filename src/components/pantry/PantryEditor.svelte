<script lang="ts">
  import { pantryStore } from '$lib/stores/pantryStore';
  import PlusIcon from 'phosphor-svelte/lib/Plus';

  export let disabled = false;

  let name = '';
  let quantity = '';
  let nameInput: HTMLInputElement;

  function add() {
    if (disabled || !name.trim()) return;
    pantryStore.addItems(name, quantity.trim() || undefined);
    name = '';
    quantity = '';
    nameInput?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      add();
    }
  }
</script>

<form
  on:submit|preventDefault={add}
  class="flex flex-col gap-3 p-4 rounded-2xl"
  style="background-color: var(--color-bg-secondary);"
>
  <div class="flex flex-col sm:flex-row gap-3">
    <div class="flex-1">
      <input
        bind:this={nameInput}
        bind:value={name}
        on:keydown={handleKeydown}
        type="text"
        placeholder="Add ingredient… eggs, rice, chicken breast"
        class="input w-full"
        autocomplete="off"
        {disabled}
        aria-label="Ingredient name"
      />
    </div>
    <div class="w-full sm:w-32">
      <input
        bind:value={quantity}
        on:keydown={handleKeydown}
        type="text"
        placeholder="Qty"
        class="input w-full"
        autocomplete="off"
        {disabled}
        aria-label="Optional quantity"
      />
    </div>
  </div>
  <p class="text-xs text-caption">
    Quantity is optional. Comma-separated names add several ingredients at once.
  </p>
  <button
    type="submit"
    disabled={disabled || !name.trim()}
    class="flex items-center justify-center gap-2 px-4 py-2 border border-orange-500/40 text-orange-500 hover:bg-orange-500/10 rounded-xl font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <PlusIcon size={18} weight="bold" />
    <span>Add ingredient</span>
  </button>
</form>
