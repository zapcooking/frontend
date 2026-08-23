<script lang="ts">
  import { pantryStore } from '$lib/stores/pantryStore';
  import { formatPantryQuantity, type PantryItem as PantryItemType } from '$lib/pantry/schema';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import XIcon from 'phosphor-svelte/lib/X';

  export let item: PantryItemType;
  export let disabled = false;

  let editing = false;
  let name = item.name;
  let quantity = formatPantryQuantity(item);
  let nameInput: HTMLInputElement;

  $: if (!editing) {
    name = item.name;
    quantity = formatPantryQuantity(item);
  }

  function startEdit() {
    if (disabled) return;
    name = item.name;
    quantity = formatPantryQuantity(item);
    editing = true;
    setTimeout(() => nameInput?.focus(), 0);
  }

  function cancel() {
    editing = false;
    name = item.name;
    quantity = formatPantryQuantity(item);
  }

  function save() {
    if (!name.trim()) return;
    pantryStore.updateItem(item.id, {
      name: name.trim(),
      quantityText: quantity.trim()
    });
    editing = false;
  }

  function remove() {
    pantryStore.removeItem(item.id);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      cancel();
    }
  }
</script>

<li
  class="flex items-center gap-2 px-3 py-2.5 rounded-xl"
  style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
>
  {#if editing}
    <input
      bind:this={nameInput}
      bind:value={name}
      on:keydown={handleKeydown}
      class="input flex-1 text-sm"
      aria-label="Edit ingredient name"
    />
    <input
      bind:value={quantity}
      on:keydown={handleKeydown}
      class="input w-24 text-sm"
      placeholder="Qty"
      aria-label="Edit quantity"
    />
    <button
      type="button"
      class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
      style="color: var(--color-text-secondary);"
      aria-label="Cancel"
      on:click={cancel}
    >
      <XIcon size={16} weight="bold" />
    </button>
    <button
      type="button"
      class="p-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white"
      aria-label="Save ingredient"
      on:click={save}
    >
      <CheckIcon size={16} weight="bold" />
    </button>
  {:else}
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium truncate" style="color: var(--color-text-primary);">
        {item.name}
      </p>
    </div>
    {#if formatPantryQuantity(item)}
      <span class="text-sm text-caption flex-shrink-0">{formatPantryQuantity(item)}</span>
    {/if}
    <button
      type="button"
      class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
      style="color: var(--color-text-secondary);"
      aria-label="Edit {item.name}"
      {disabled}
      on:click={startEdit}
    >
      <PencilSimpleIcon size={16} />
    </button>
    <button
      type="button"
      class="p-1.5 rounded-lg hover:bg-red-500/10"
      style="color: var(--color-danger);"
      aria-label="Remove {item.name}"
      {disabled}
      on:click={remove}
    >
      <TrashIcon size={16} />
    </button>
  {/if}
</li>
