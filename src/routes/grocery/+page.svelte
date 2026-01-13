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
  import PanLoader from '../../components/PanLoader.svelte';
  import GroceryListCard from '../../components/grocery/GroceryListCard.svelte';
  import PullToRefresh from '../../components/PullToRefresh.svelte';

  // Pull-to-refresh ref
  let pullToRefreshEl: PullToRefresh;

  let isCreating = false;

  async function handleRefresh() {
    try {
      await groceryStore.load();
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
    if (isCreating) return;
    
    isCreating = true;
    try {
      const newList = await groceryStore.addList('Shopping List');
      // Navigate to the new list
      goto(`/grocery/${newList.id}`);
    } catch (error) {
      console.error('Failed to create list:', error);
      groceryError.set(
        `Failed to create list: ${error instanceof Error && error.message ? error.message : 'Unknown error'}`
      );
    } finally {
      isCreating = false;
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
    
    <!-- New List Button -->
    <button
      on:click={createNewList}
      disabled={isCreating}
      class="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white rounded-full font-medium transition-all text-sm disabled:opacity-50"
      aria-label="Create new grocery list"
    >
      <PlusIcon size={18} weight="bold" />
      <span>{isCreating ? 'Creating...' : 'New List'}</span>
    </button>
  </div>

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
        No Grocery Lists Yet
      </h2>
      <p class="text-caption text-center max-w-md mb-6">
        Create a grocery list to keep track of items you need. Your lists are private and encrypted.
      </p>
      <button
        on:click={createNewList}
        disabled={isCreating}
        class="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white rounded-full font-medium transition-all disabled:opacity-50"
      >
        <PlusIcon size={18} weight="bold" />
        {isCreating ? 'Creating...' : 'Create Your First List'}
      </button>
    </div>
  {:else}
    <!-- Lists Grid -->
    <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {#each $groceryLists as list (list.id)}
        <GroceryListCard {list} />
      {/each}
    </div>
  {/if}
</div>
</PullToRefresh>
