<script lang="ts">
  import { pantryStore, pantryItems } from '$lib/stores/pantryStore';
  import { suggestPantryIngredients } from '$lib/pantry/catalog';
  import PlusIcon from 'phosphor-svelte/lib/Plus';

  export let disabled = false;

  let name = '';
  let quantity = '';
  let nameInput: HTMLInputElement;
  let highlight = 0;
  let open = false;

  $: suggestions = suggestPantryIngredients(name, $pantryItems);
  $: if (suggestions.length === 0) {
    highlight = 0;
    open = false;
  }

  export function focus() {
    nameInput?.focus();
  }

  function add(value = name) {
    if (disabled || !value.trim()) return;
    pantryStore.addItems(value, quantity.trim() || undefined);
    name = '';
    quantity = '';
    open = false;
    highlight = 0;
    nameInput?.focus();
  }

  function pick(suggestion: string) {
    add(suggestion);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (open && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlight = (highlight + 1) % suggestions.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlight = (highlight - 1 + suggestions.length) % suggestions.length;
        return;
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        pick(suggestions[highlight].name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        open = false;
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      add();
    }
  }
</script>

<form
  on:submit|preventDefault={() => add()}
  class="flex flex-col gap-3 p-4 rounded-2xl"
  style="background-color: var(--color-bg-secondary);"
>
  <div class="flex flex-col sm:flex-row gap-3">
    <div class="relative flex-1">
      <input
        bind:this={nameInput}
        bind:value={name}
        on:keydown={handleKeydown}
        on:input={() => {
          open = true;
          highlight = 0;
        }}
        on:focus={() => {
          if (suggestions.length) open = true;
        }}
        on:blur={() => {
          // Delay so suggestion mousedown can fire before the list unmounts.
          setTimeout(() => (open = false), 120);
        }}
        type="text"
        placeholder="Add ingredient… eggs, rice, chicken breast"
        class="input w-full"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        {disabled}
        aria-label="Ingredient name"
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        role="combobox"
      />
      {#if open && suggestions.length > 0}
        <ul
          class="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-xl py-1 shadow-lg"
          style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
          role="listbox"
        >
          {#each suggestions as suggestion, i}
            <li>
              <button
                type="button"
                class="w-full text-left px-3 py-2.5 text-sm transition-colors"
                style="color: var(--color-text-primary); {i === highlight
                  ? 'background-color: var(--color-input-bg);'
                  : ''}"
                role="option"
                aria-selected={i === highlight}
                on:mousedown|preventDefault={() => pick(suggestion.name)}
              >
                {suggestion.name}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <div class="w-full sm:w-28">
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
