<script lang="ts">
  import { groceryStore, type GroceryItem, type GroceryCategory } from '$lib/stores/groceryStore';
  import GroceryItemRow from './GroceryItemRow.svelte';

  export let listId: string;
  export let category: GroceryCategory;
  export let items: GroceryItem[];
  export let categoryLabel: string;
  export let categoryEmoji: string;

  // Drag state (within-category only)
  let draggedIndex: number | null = null;
  let dragOverIndex: number | null = null;

  function handleDragStart(e: DragEvent, index: number) {
    draggedIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
    }
  }

  function handleDragOver(e: DragEvent, index: number) {
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    dragOverIndex = index;
  }

  function handleDrop(e: DragEvent, index: number) {
    if (draggedIndex === null || draggedIndex === index) {
      resetDragState();
      return;
    }

    groceryStore.reorderItem(listId, category, draggedIndex, index);
    resetDragState();
  }

  function handleDragEnd() {
    resetDragState();
  }

  function handleDragLeave(index: number) {
    if (dragOverIndex === index) {
      dragOverIndex = null;
    }
  }

  function resetDragState() {
    draggedIndex = null;
    dragOverIndex = null;
  }
</script>

<div class="flex flex-col gap-2">
  <!-- Category header -->
  <h3
    class="text-sm font-semibold flex items-center gap-2"
    style="color: var(--color-text-secondary)"
  >
    <span>{categoryEmoji}</span>
    <span>{categoryLabel}</span>
    <span class="text-caption font-normal">({items.length})</span>
  </h3>

  <!-- Items -->
  <div class="flex flex-col gap-1" role="list">
    {#each items as item, index (item.id)}
      <GroceryItemRow
        {item}
        {listId}
        {index}
        isDragged={draggedIndex === index}
        isDragOver={dragOverIndex === index && draggedIndex !== index}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        onDragLeave={() => handleDragLeave(index)}
      />
    {/each}
  </div>
</div>
