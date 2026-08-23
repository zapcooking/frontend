<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { userPublickey } from '$lib/nostr';
  import { 
    groceryStore, 
    getGroceryList, 
    getGroceryItemsByCategory,
    grocerySaving,
    groceryInitialized
  } from '$lib/stores/groceryStore';
  import { plannerStore } from '$lib/stores/plannerStore';
  import {
    GROCERY_CATEGORIES,
    GROCERY_CATEGORY_EMOJI,
    GROCERY_CATEGORY_LABELS
  } from '$lib/grocery/categories';
  import { isManualGroceryItem } from '$lib/grocery/requirements';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import XIcon from 'phosphor-svelte/lib/X';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotch';
  import PanLoader from '../../../../components/PanLoader.svelte';
  import Modal from '../../../../components/Modal.svelte';
  import Button from '../../../../components/Button.svelte';
  import SortableGroceryCategory from '../../../../components/grocery/SortableGroceryCategory.svelte';
  import AddItemForm from '../../../../components/grocery/AddItemForm.svelte';
  import CalendarBlankIcon from 'phosphor-svelte/lib/CalendarBlank';

  // Get list ID from URL params
  $: listId = $page.params.id as string;
  
  // Get reactive list data
  $: listStore = getGroceryList(listId);
  $: list = $listStore;
  
  // Get items grouped by category
  $: itemsByCategoryStore = getGroceryItemsByCategory(listId);
  $: itemsByCategory = $itemsByCategoryStore;

  const categoryOrder = GROCERY_CATEGORIES;

  // UI state
  let isEditingTitle = false;
  let editedTitle = '';
  let titleInput: HTMLInputElement;
  let deleteConfirmOpen = false;
  let isDeleting = false;
  let showNotes = false;
  let editedNotes = '';

  // Start editing title
  function startEditingTitle() {
    if (!list) return;
    editedTitle = list.title;
    isEditingTitle = true;
    // Focus input after render
    setTimeout(() => titleInput?.focus(), 0);
  }

  // Save title
  function saveTitle() {
    if (!list || !editedTitle.trim()) return;
    groceryStore.updateList(listId, { title: editedTitle.trim() });
    isEditingTitle = false;
  }

  // Cancel title editing
  function cancelEditTitle() {
    isEditingTitle = false;
    editedTitle = '';
  }

  // Handle title input keydown
  function handleTitleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      saveTitle();
    } else if (e.key === 'Escape') {
      cancelEditTitle();
    }
  }

  // Toggle notes section
  function toggleNotes() {
    if (!showNotes && list) {
      editedNotes = list.notes || '';
    }
    showNotes = !showNotes;
  }

  // Save notes
  function saveNotes() {
    groceryStore.updateList(listId, { notes: editedNotes || undefined });
  }

  // Delete the list
  async function deleteList() {
    if (!list) return;
    
    isDeleting = true;
    try {
      const success = await groceryStore.deleteList(listId);
      if (success) {
        goto('/my-kitchen/grocery');
      }
    } catch (error) {
      console.error('Failed to delete list:', error);
    } finally {
      isDeleting = false;
      deleteConfirmOpen = false;
    }
  }

  // Clear checked items
  function clearCheckedItems() {
    groceryStore.clearCheckedItems(listId);
  }

  function addPantryCoveredToList(index: number) {
    groceryStore.addPantryCoveredToList(listId, index);
  }

  $: totalItems = list?.items.length ?? 0;
  $: checkedItems = list?.items.filter(item => item.checked).length ?? 0;
  $: hasCheckedItems = checkedItems > 0;
  $: recipeItemCount = list?.items.filter((item) => !isManualGroceryItem(item)).length ?? 0;
  $: pantryCoveredCount = list?.pantryCovered?.length ?? 0;
  $: plannedIngredientCount = recipeItemCount + pantryCoveredCount;

  onMount(async () => {
    if (!$userPublickey) {
      goto('/login');
      return;
    }
    
    // Only load if not already initialized (to preserve locally created lists)
    if (!$groceryInitialized) {
      await groceryStore.load();
    }

    const currentList = get(groceryStore).lists.find((entry) => entry.id === listId);
    if (currentList?.sourceWeekId) {
      await plannerStore.ensureWeek(currentList.sourceWeekId);
      const week = get(plannerStore).weeks[currentList.sourceWeekId];
      if (week?.status === 'ok') {
        groceryStore.syncMealPlanSources(currentList.sourceWeekId, week.plan);
      }
    }
  });

  onDestroy(() => {
    // Save any pending changes
    groceryStore.saveNow();
  });
</script>

<svelte:head>
  <title>{list?.title || 'Grocery List'} - zap.cooking</title>
</svelte:head>

{#if !list}
  <div class="flex justify-center items-center py-16">
    <PanLoader size="md" />
  </div>
{:else}
  <div class="flex flex-col gap-4 max-w-2xl mx-auto">
    <!-- Header -->
    <div class="flex flex-col gap-4">
      <!-- Back link and actions -->
      <div class="flex items-center justify-between">
        <a 
          href="/my-kitchen/grocery" 
          class="flex items-center gap-2 text-sm font-medium transition-colors hover:opacity-80"
          style="color: var(--color-text-secondary)"
        >
          <ArrowLeftIcon size={18} />
          <span>All Lists</span>
        </a>

        <div class="flex items-center gap-2">
          <!-- Saving indicator -->
          {#if $grocerySaving}
            <div class="flex items-center gap-1.5 text-sm text-caption">
              <CircleNotchIcon size={16} class="animate-spin" />
              <span>Saving...</span>
            </div>
          {/if}

          <!-- Delete button -->
          <button
            on:click={() => deleteConfirmOpen = true}
            class="p-2 rounded-lg transition-colors hover:bg-red-500/10"
            style="color: var(--color-danger)"
            aria-label="Delete list"
          >
            <TrashIcon size={20} />
          </button>
        </div>
      </div>

      <!-- Title -->
      <div class="flex items-center gap-2">
        {#if isEditingTitle}
          <input
            bind:this={titleInput}
            bind:value={editedTitle}
            on:keydown={handleTitleKeydown}
            class="input text-2xl font-bold flex-1"
            placeholder="List title"
          />
          <button
            on:click={cancelEditTitle}
            class="p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            style="color: var(--color-text-secondary)"
            aria-label="Cancel"
          >
            <XIcon size={20} weight="bold" />
          </button>
          <button
            on:click={saveTitle}
            class="p-2 rounded-lg bg-green-500 hover:bg-green-600 text-white transition-colors"
            aria-label="Save title"
          >
            <CheckIcon size={20} weight="bold" />
          </button>
        {:else}
          <h1 
            class="text-2xl font-bold flex-1 cursor-pointer hover:opacity-80 transition-opacity"
            style="color: var(--color-text-primary)"
            on:click={startEditingTitle}
            role="button"
            tabindex="0"
            on:keydown={(e) => e.key === 'Enter' && startEditingTitle()}
          >
            {list.title}
          </h1>
          <button
            on:click={startEditingTitle}
            class="p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            style="color: var(--color-text-secondary)"
            aria-label="Edit title"
          >
            <PencilSimpleIcon size={18} />
          </button>
        {/if}
      </div>

      <!-- Stats bar -->
      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <p class="text-sm text-caption">
            {#if totalItems === 0}
              No items yet
            {:else}
              {checkedItems}/{totalItems} items checked
            {/if}
          </p>

          {#if hasCheckedItems}
            <button
              on:click={clearCheckedItems}
              class="text-sm font-medium transition-colors hover:opacity-80"
              style="color: var(--color-primary)"
              aria-label="Clear checked items"
            >
              Clear checked
            </button>
          {/if}
        </div>
        {#if plannedIngredientCount > 0}
          <p class="text-xs text-caption">
            {plannedIngredientCount} ingredient{plannedIngredientCount === 1 ? '' : 's'} needed
            {#if pantryCoveredCount > 0}
              · {pantryCoveredCount} already in My Kitchen
              · {recipeItemCount} added to Grocery List
            {/if}
          </p>
        {/if}
      </div>

      <!-- Progress bar -->
      {#if totalItems > 0}
        <div class="h-2 rounded-full overflow-hidden" style="background-color: var(--color-input-bg);">
          {#if checkedItems > 0}
            <div
              class="h-full rounded-full transition-all duration-300 bg-gradient-to-r from-green-500 to-emerald-500"
              style="width: {(checkedItems / totalItems) * 100}%"
            />
          {/if}
        </div>
      {/if}
    </div>

    <!-- Add Item Form -->
    <AddItemForm {listId} />

    <!-- Items by Category -->
    <div class="flex flex-col gap-4">
      {#each categoryOrder as category}
        {#if itemsByCategory.has(category)}
          {@const items = itemsByCategory.get(category) || []}
          <SortableGroceryCategory
            {listId}
            {category}
            {items}
            categoryLabel={GROCERY_CATEGORY_LABELS[category]}
            categoryEmoji={GROCERY_CATEGORY_EMOJI[category]}
          />
        {/if}
      {/each}

      {#if totalItems === 0}
        <div class="text-center py-10 px-4">
          <h2 class="text-lg font-semibold mb-2" style="color: var(--color-text-primary)">
            Your grocery list is empty
          </h2>
          <p class="text-caption max-w-md mx-auto mb-5">
            Add ingredients manually or build a meal plan and Zap will create your grocery list automatically.
          </p>
          <a
            href="/my-kitchen/planner"
            class="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all"
          >
            <CalendarBlankIcon size={16} />
            Plan Meals
          </a>
        </div>
      {/if}
    </div>

    {#if list.pantryCovered && list.pantryCovered.length > 0}
      <div
        class="flex flex-col gap-2 p-4 rounded-2xl"
        style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
      >
        <h2 class="text-sm font-semibold" style="color: var(--color-text-primary);">
          Already in My Kitchen
        </h2>
        <p class="text-xs text-caption">
          These matched your pantry, so they were left off the shopping list.
        </p>
        <ul class="flex flex-col gap-1.5">
          {#each list.pantryCovered as covered, index (`${covered.name}|${covered.quantity || ''}|${covered.recipeId || ''}|${index}`)}
            <li class="flex items-center gap-2 text-sm min-h-[40px]">
              <span class="min-w-0 flex-1" style="color: var(--color-text-secondary);">
                {covered.name}{#if covered.quantity}<span class="text-caption"> · {covered.quantity}</span>{/if}
              </span>
              <button
                type="button"
                class="flex items-center gap-1 flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border border-green-500/40 text-green-500 hover:bg-green-500/10 transition-colors"
                aria-label="I still need {covered.name}"
                on:click={() => addPantryCoveredToList(index)}
              >
                I still need this
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Notes Section -->
    <div class="flex flex-col gap-2 pt-4 border-t" style="border-color: var(--color-input-border);">
      <button
        on:click={toggleNotes}
        class="flex items-center justify-between w-full text-left"
      >
        <span class="text-sm font-semibold" style="color: var(--color-text-secondary)">
          📝 Notes
        </span>
        <span class="text-sm text-caption">
          {showNotes ? 'Hide' : 'Show'}
        </span>
      </button>

      {#if showNotes}
        <textarea
          bind:value={editedNotes}
          on:blur={saveNotes}
          class="input resize-none"
          rows="3"
          placeholder="Add notes about this list..."
        />
      {/if}
    </div>
  </div>
{/if}

<!-- Delete Confirmation Modal -->
<Modal cleanup={() => deleteConfirmOpen = false} open={deleteConfirmOpen}>
  <h1 slot="title">Delete List</h1>
  
  <div class="flex flex-col gap-4">
    <p style="color: var(--color-text-primary)">
      Are you sure you want to delete "<strong>{list?.title}</strong>"? 
      This cannot be undone.
    </p>
    
    <div class="flex justify-end gap-2">
      <Button on:click={() => deleteConfirmOpen = false} primary={false} disabled={isDeleting}>
        Cancel
      </Button>
      <button
        on:click={deleteList}
        disabled={isDeleting}
        class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full font-semibold transition-colors disabled:opacity-50"
      >
        {isDeleting ? 'Deleting...' : 'Delete List'}
      </button>
    </div>
  </div>
</Modal>
