<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { userPublickey } from '$lib/nostr';
  import { 
    groceryStore, 
    groceryLists, 
    groceryLoading, 
    groceryError,
    groceryInitialized
  } from '$lib/stores/groceryStore';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import ShoppingCartIcon from 'phosphor-svelte/lib/ShoppingCart';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import PanLoader from '../../../components/PanLoader.svelte';
  import GroceryListCard from '../../../components/grocery/GroceryListCard.svelte';
  import PullToRefresh from '../../../components/PullToRefresh.svelte';
  import Modal from '../../../components/Modal.svelte';
  import Button from '../../../components/Button.svelte';

  // Pull-to-refresh ref
  let pullToRefreshEl: PullToRefresh;

  let isCreating = false;
  let isEditing = false;
  let selectedIds = new Set<string>();
  let deleteConfirmOpen = false;
  let isDeleting = false;

  $: allSelected = $groceryLists.length > 0 && selectedIds.size === $groceryLists.length;
  $: selectedCount = selectedIds.size;
  $: selectedLists = $groceryLists.filter((list) => selectedIds.has(list.id));

  $: if (isEditing && !isDeleting && $groceryLists.length === 0) {
    isEditing = false;
    selectedIds = new Set();
    deleteConfirmOpen = false;
  }

  async function handleRefresh() {
    try {
      await groceryStore.load();
      if (isEditing) {
        const validIds = new Set($groceryLists.map((list) => list.id));
        selectedIds = new Set([...selectedIds].filter((id) => validIds.has(id)));
      }
    } finally {
      pullToRefreshEl?.complete();
    }
  }

  onMount(async () => {
    if (!$userPublickey) {
      goto('/login');
      return;
    }
    
    // Only load if not already initialized (to preserve locally created lists)
    if (!$groceryInitialized) {
      await groceryStore.load();
    }
  });

  onDestroy(() => {
    // Save any pending changes before leaving
    groceryStore.saveNow();
  });

  async function createNewList() {
    if (isCreating || isEditing) return;
    
    isCreating = true;
    try {
      const newList = await groceryStore.addList('Shopping List');
      // Navigate to the new list
      goto(`/my-kitchen/grocery/${newList.id}`);
    } catch (error) {
      console.error('Failed to create list:', error);
    } finally {
      isCreating = false;
    }
  }

  function enterEditMode() {
    isEditing = true;
    selectedIds = new Set();
  }

  function exitEditMode() {
    isEditing = false;
    selectedIds = new Set();
    deleteConfirmOpen = false;
  }

  function toggleSelect(listId: string) {
    const next = new Set(selectedIds);
    if (next.has(listId)) {
      next.delete(listId);
    } else {
      next.add(listId);
    }
    selectedIds = next;
  }

  function toggleSelectAll() {
    selectedIds = allSelected
      ? new Set()
      : new Set($groceryLists.map((list) => list.id));
  }

  async function deleteSelected() {
    if (selectedIds.size === 0 || isDeleting) return;

    isDeleting = true;
    try {
      const success = await groceryStore.deleteLists([...selectedIds]);
      if (success) {
        exitEditMode();
      }
    } catch (error) {
      console.error('Failed to delete grocery lists:', error);
    } finally {
      isDeleting = false;
      deleteConfirmOpen = false;
    }
  }
</script>

<svelte:head>
  <title>Grocery Lists - zap.cooking</title>
  <meta name="description" content="Your private grocery lists on zap.cooking" />
</svelte:head>

<PullToRefresh bind:this={pullToRefreshEl} on:refresh={handleRefresh}>
<div class="flex flex-col gap-6">
  <!-- Header -->
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex items-center gap-3">
      <div class="w-12 h-12 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center flex-shrink-0">
        <ShoppingCartIcon size={24} weight="fill" class="text-white" />
      </div>
      <div>
        <h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">Grocery Lists</h1>
        <p class="text-sm text-caption">Your private shopping lists</p>
      </div>
    </div>
    
    <div class="flex items-center gap-2">
      {#if $groceryLists.length > 0}
        {#if isEditing}
          <button
            type="button"
            on:click={exitEditMode}
            class="flex items-center gap-2 px-4 py-1.5 rounded-full font-medium transition-all text-sm"
            style="color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
          >
            Done
          </button>
        {:else}
          <button
            type="button"
            on:click={enterEditMode}
            class="flex items-center gap-2 px-4 py-1.5 rounded-full font-medium transition-all text-sm"
            style="color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
          >
            Edit
          </button>
        {/if}
      {/if}

      {#if !isEditing}
        <button
          on:click={createNewList}
          disabled={isCreating}
          class="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white rounded-full font-medium transition-all text-sm disabled:opacity-50"
          aria-label="Create new grocery list"
        >
          <PlusIcon size={18} weight="bold" />
          <span>{isCreating ? 'Creating...' : 'New List'}</span>
        </button>
      {/if}
    </div>
  </div>

  {#if isEditing}
    <div
      class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-3 rounded-2xl"
      style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border);"
    >
      <p class="text-sm font-medium" style="color: var(--color-text-primary)">
        {selectedCount === 0
          ? 'Select lists to delete'
          : `${selectedCount} ${selectedCount === 1 ? 'list' : 'lists'} selected`}
      </p>
      <div class="flex items-center gap-2">
        <button
          type="button"
          on:click={toggleSelectAll}
          class="px-3 py-1.5 rounded-full text-sm font-medium transition-all"
          style="color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
        >
          {allSelected ? 'Clear' : 'Select all'}
        </button>
        <button
          type="button"
          on:click={() => (deleteConfirmOpen = true)}
          disabled={selectedCount === 0}
          class="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full text-sm font-medium transition-colors disabled:opacity-40"
        >
          <TrashIcon size={16} />
          Delete
        </button>
      </div>
    </div>
  {/if}

  <!-- Error Banner -->
  {#if $groceryError}
    <div class="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30">
      <p class="text-sm" style="color: var(--color-text-primary)">{$groceryError}</p>
    </div>
  {/if}

  <!-- Loading State -->
  {#if $groceryLoading && !$groceryInitialized}
    <div class="flex justify-center items-center py-16">
      <PanLoader size="md" />
    </div>
  {:else if $groceryLists.length === 0}
    <!-- Empty State -->
    <div class="flex flex-col items-center justify-center py-16 px-4">
      <div class="w-20 h-20 rounded-full bg-gradient-to-br from-green-100 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30 flex items-center justify-center mb-4">
        <ShoppingCartIcon size={40} weight="regular" class="text-green-500" />
      </div>
      <h2 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary)">
        Your grocery list is empty
      </h2>
      <p class="text-caption text-center max-w-md mb-6">
        Add ingredients manually or build a meal plan and Zap will create your grocery list automatically.
      </p>
      <div class="flex flex-col sm:flex-row items-center gap-3">
        <a
          href="/my-kitchen/planner"
          class="flex items-center gap-2 px-5 py-2.5 rounded-full font-medium transition-all"
          style="color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
        >
          Plan Meals
        </a>
        <button
          on:click={createNewList}
          disabled={isCreating}
          class="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white rounded-full font-medium transition-all disabled:opacity-50"
        >
          <PlusIcon size={18} weight="bold" />
          {isCreating ? 'Creating...' : 'Add Item'}
        </button>
      </div>
    </div>
  {:else}
    <!-- Lists Grid -->
    <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {#each $groceryLists as list (list.id)}
        <GroceryListCard
          {list}
          selectable={isEditing}
          selected={selectedIds.has(list.id)}
          on:toggle={() => toggleSelect(list.id)}
        />
      {/each}
    </div>
  {/if}
</div>
</PullToRefresh>

<Modal cleanup={() => (deleteConfirmOpen = false)} open={deleteConfirmOpen}>
  <h1 slot="title">{selectedCount === $groceryLists.length ? 'Delete All Lists' : selectedCount === 1 ? 'Delete List' : 'Delete Lists'}</h1>

  <div class="flex flex-col gap-4">
    <p style="color: var(--color-text-primary)">
      {#if selectedCount === 1}
        Are you sure you want to delete "<strong>{selectedLists[0]?.title}</strong>"?
        This cannot be undone.
      {:else if selectedCount === $groceryLists.length}
        Are you sure you want to delete all {selectedCount} grocery lists?
        This cannot be undone.
      {:else}
        Are you sure you want to delete {selectedCount} grocery lists?
        This cannot be undone.
      {/if}
    </p>

    <div class="flex justify-end gap-2">
      <Button on:click={() => (deleteConfirmOpen = false)} primary={false} disabled={isDeleting}>
        Cancel
      </Button>
      <button
        on:click={deleteSelected}
        disabled={isDeleting}
        class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full font-semibold transition-colors disabled:opacity-50"
      >
        {#if isDeleting}
          Deleting...
        {:else if selectedCount === $groceryLists.length}
          Delete All
        {:else if selectedCount === 1}
          Delete List
        {:else}
          Delete {selectedCount} Lists
        {/if}
      </button>
    </div>
  </div>
</Modal>
