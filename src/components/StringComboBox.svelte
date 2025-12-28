<script lang="ts">
  import type { Writable } from 'svelte/store';
  import Button from './Button.svelte';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import PencilIcon from 'phosphor-svelte/lib/PencilSimple';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import DotsSixVertical from 'phosphor-svelte/lib/DotsSixVertical';
  import { slide } from 'svelte/transition';

  let inputNewThing: string = '';
  export let selected: Writable<string[]>;
  export let placeholder: string;
  export let showIndex: boolean = false; // kept for backwards compatibility but not used

  // Editing state
  let editingIndex: number | null = null;
  let editValue: string = '';

  // Drag state
  let draggedIndex: number | null = null;
  let dragOverIndex: number | null = null;

  function removeTag(index: number) {
    let nSelected = $selected;
    if (index < 0 || index >= nSelected.length) {
      return;
    }
    nSelected = [...nSelected.slice(0, index), ...nSelected.slice(index + 1)];
    selected.set(nSelected);
  }

  function addTag() {
    let nSelected = $selected;
    if (inputNewThing) {
      let tag = inputNewThing;
      inputNewThing = '';
      nSelected.push(tag);
      selected.set(nSelected);
    }
  }

  // Edit functions
  function startEdit(index: number) {
    editingIndex = index;
    editValue = $selected[index];
  }

  function saveEdit(index: number) {
    if (editingIndex === null) return;

    let nSelected = [...$selected];
    if (editValue.trim()) {
      nSelected[index] = editValue.trim();
      selected.set(nSelected);
    }
    editingIndex = null;
    editValue = '';
  }

  function cancelEdit() {
    editingIndex = null;
    editValue = '';
  }

  function handleEditKeydown(e: KeyboardEvent, index: number) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit(index);
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  }

  // Drag functions
  function handleDragStart(e: DragEvent, index: number) {
    draggedIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
    }
  }

  function handleDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    dragOverIndex = index;
  }

  function handleDrop(e: DragEvent, index: number) {
    e.preventDefault();

    if (draggedIndex === null || draggedIndex === index) {
      resetDragState();
      return;
    }

    let nSelected = [...$selected];
    const draggedItem = nSelected[draggedIndex];

    // Remove from old position
    nSelected.splice(draggedIndex, 1);

    // Insert at new position
    const insertIndex = draggedIndex < index ? index - 1 : index;
    nSelected.splice(insertIndex, 0, draggedItem);

    selected.set(nSelected);
    resetDragState();
  }

  function handleDragEnd() {
    resetDragState();
  }

  function resetDragState() {
    draggedIndex = null;
    dragOverIndex = null;
  }
</script>

<div class="mb-0">
  {#if $selected.length > 0}
    <ul class="flex flex-col gap-2 mb-2">
      {#each $selected as tag, index (tag + index)}
        <li
          draggable={editingIndex !== index}
          on:dragstart={(e) => handleDragStart(e, index)}
          on:dragover={(e) => handleDragOver(e, index)}
          on:drop={(e) => handleDrop(e, index)}
          on:dragend={handleDragEnd}
          on:dragleave={() => { if (dragOverIndex === index) dragOverIndex = null; }}
          class="flex items-center gap-2 input transition-all duration-150
            {dragOverIndex === index && draggedIndex !== index ? 'border-primary border-2' : ''}
            {draggedIndex === index ? 'opacity-50' : ''}
            {editingIndex === index ? 'ring-2 ring-primary border-primary' : ''}"
          transition:slide|global={{ duration: 300 }}
        >
          <!-- Grip handle -->
          <button
            type="button"
            class="cursor-grab active:cursor-grabbing text-caption hover:text-primary flex-shrink-0"
            title="Drag to reorder"
            aria-label="Drag to reorder"
          >
            <DotsSixVertical size={20} weight="bold" />
          </button>

          <!-- Content (editable or display) -->
          {#if editingIndex === index}
            <input
              bind:value={editValue}
              on:blur={() => saveEdit(index)}
              on:keydown={(e) => handleEditKeydown(e, index)}
              class="grow bg-transparent border-none outline-none p-0"
              style="color: var(--color-text-primary)"
              aria-label={`Edit ${tag}`}
            />
          {:else}
            <span
              class="grow cursor-text"
              on:dblclick={() => startEdit(index)}
              title="Double-click to edit"
            >
              {tag}
            </span>
          {/if}

          <!-- Action buttons -->
          <div class="flex gap-1 flex-shrink-0">
            <!-- Edit/Save button -->
            {#if editingIndex === index}
              <button
                type="button"
                class="text-green-600 hover:text-green-700 transition-colors p-1"
                on:click={() => saveEdit(index)}
                title="Save"
              >
                <CheckIcon size={16} weight="bold" />
              </button>
            {:else}
              <button
                type="button"
                class="text-caption hover:text-primary transition-colors p-1"
                on:click={() => startEdit(index)}
                title="Edit"
              >
                <PencilIcon size={16} />
              </button>
            {/if}

            <!-- Delete button -->
            <button
              type="button"
              class="text-danger hover:opacity-80 transition-opacity p-1"
              on:click={() => removeTag(index)}
              title="Delete"
            >
              <TrashIcon size={16} />
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<form on:submit|preventDefault={addTag} class="flex gap-2">
  <input bind:value={inputNewThing} class="input grow" {placeholder} />
  <Button on:click={addTag} primary={false}>Add</Button>
</form>
