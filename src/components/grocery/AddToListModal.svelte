<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { blur, scale } from 'svelte/transition';
  import { onMount } from 'svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import CloseIcon from 'phosphor-svelte/lib/XCircle';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import SpinnerIcon from 'phosphor-svelte/lib/CircleNotch';
  import ShoppingCartIcon from 'phosphor-svelte/lib/ShoppingCart';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import CaretUpIcon from 'phosphor-svelte/lib/CaretUp';
  import { groceryStore, groceryLists, groceryInitialized } from '$lib/stores/groceryStore';
  import { pantryStore, pantryItems, pantryInitialized } from '$lib/stores/pantryStore';
  import { classifyGroceryRows } from '$lib/pantry/matching';
  import { parseIngredientsFromRecipe, type ParsedIngredient } from '$lib/utils/ingredientParser';
  import { userPublickey } from '$lib/nostr';

  export let open = false;
  export let recipeEvent: NDKEvent | null = null;

  const dispatch = createEventDispatcher<{
    close: void;
    added: { listId: string; count: number };
  }>();

  // State
  let isLoading = false;
  let isCreatingList = false;
  let newListName = '';
  let showNewListInput = false;
  let selectedListId: string | null = null;
  let showPreview = true;
  let parsedIngredients: ParsedIngredient[] = [];
  let addingToList = false;
  let successMessage = '';
  let includeFromPantry: Set<string> = new Set();

  // Portal target
  let portalTarget: HTMLElement;

  onMount(() => {
    portalTarget = document.body;
  });

  // Parse ingredients when recipe event changes
  $: if (recipeEvent && open) {
    parsedIngredients = parseIngredientsFromRecipe(recipeEvent.content);
    selectedListId = null;
    showNewListInput = false;
    successMessage = '';
    includeFromPantry = new Set();
  }

  $: if (open && $userPublickey && !$groceryInitialized) {
    groceryStore.load();
  }

  $: if (open && $userPublickey && !$pantryInitialized) {
    pantryStore.load();
  }

  $: recipeTitle = recipeEvent?.tags.find((t) => t[0] === 'title')?.[1] || 
                   recipeEvent?.tags.find((t) => t[0] === 'd')?.[1] ||
                   'Recipe';

  $: recipeAddress = recipeEvent ? buildRecipeAddress(recipeEvent) : null;

  $: classified = classifyGroceryRows(
    parsedIngredients.map((ingredient) => ({
      ingredient,
      recipeId: recipeAddress || ''
    })),
    $pantryItems
  );

  $: toBuyCount =
    classified.toBuy.length +
    classified.inPantry.filter((row) => includeFromPantry.has(pantryRowKey(row.ingredient))).length;

  $: pantryReady = !$userPublickey || $pantryInitialized;

  function pantryRowKey(ingredient: ParsedIngredient): string {
    return `${ingredient.name}|${ingredient.quantity}`;
  }

  function toggleIncludeFromPantry(ingredient: ParsedIngredient) {
    const key = pantryRowKey(ingredient);
    const next = new Set(includeFromPantry);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    includeFromPantry = next;
  }

  function buildRecipeAddress(event: NDKEvent): string {
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1] || '';
    return `30023:${event.pubkey}:${dTag}`;
  }

  function close() {
    open = false;
    dispatch('close');
  }

  async function createNewList() {
    if (!newListName.trim() || isCreatingList) return;
    
    isCreatingList = true;
    try {
      const newList = await groceryStore.addList(newListName.trim());
      selectedListId = newList.id;
      newListName = '';
      showNewListInput = false;
    } catch (error) {
      console.error('Failed to create list:', error);
    } finally {
      isCreatingList = false;
    }
  }

  function handleKeydownNewList(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      createNewList();
    } else if (e.key === 'Escape') {
      showNewListInput = false;
      newListName = '';
    }
  }

  async function addToSelectedList() {
    if (!selectedListId || !recipeAddress || addingToList) return;
    if (parsedIngredients.length === 0) return;

    addingToList = true;
    try {
      groceryStore.addRecipeLink(selectedListId, recipeAddress);

      let addedCount = 0;
      for (const row of classified.toBuy) {
        groceryStore.addItem(
          selectedListId,
          row.ingredient.name,
          row.ingredient.quantity,
          row.ingredient.category,
          recipeAddress
        );
        addedCount++;
      }
      const covered = [];
      for (const row of classified.inPantry) {
        if (includeFromPantry.has(pantryRowKey(row.ingredient))) {
          groceryStore.addItem(
            selectedListId,
            row.ingredient.name,
            row.ingredient.quantity,
            row.ingredient.category,
            recipeAddress
          );
          addedCount++;
        } else {
          covered.push({
            name: row.ingredient.name,
            quantity: row.ingredient.quantity,
            recipeId: recipeAddress
          });
        }
      }
      if (covered.length > 0) {
        groceryStore.appendPantryCovered(selectedListId, covered);
      }

      successMessage =
        addedCount === 0
          ? 'Recipe added. Everything was already in your pantry.'
          : `Added ${addedCount} ingredient${addedCount === 1 ? '' : 's'} to your list!`;
      dispatch('added', { listId: selectedListId, count: addedCount });

      setTimeout(() => {
        close();
      }, 1500);
    } catch (error) {
      console.error('Failed to add ingredients:', error);
    } finally {
      addingToList = false;
    }
  }

  function selectList(listId: string) {
    selectedListId = listId;
  }

  // Category display names and colors
  const categoryDisplay: Record<string, { name: string; color: string }> = {
    produce: { name: 'Produce', color: 'text-green-600' },
    protein: { name: 'Protein', color: 'text-red-600' },
    dairy: { name: 'Dairy', color: 'text-blue-600' },
    pantry: { name: 'Pantry', color: 'text-amber-600' },
    frozen: { name: 'Frozen', color: 'text-cyan-600' },
    other: { name: 'Other', color: 'text-gray-600' }
  };
</script>

{#if open && portalTarget}
  <div use:portal={portalTarget}>
    <div
      on:click|self={close}
      on:keydown={(e) => e.key === 'Escape' && close()}
      role="presentation"
      transition:blur={{ duration: 250 }}
      class="fixed top-0 left-0 z-50 w-full h-full backdrop-brightness-50 backdrop-blur"
    >
      <dialog
        transition:scale={{ duration: 250 }}
        aria-labelledby="modal-title"
        aria-modal="true"
        class="absolute m-0 top-1/2 left-1/2 px-4 md:px-6 pt-5 pb-6 rounded-3xl w-[calc(100%-1rem)] md:w-[calc(100vw-4em)] max-w-lg max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2"
        style="background-color: var(--color-bg-secondary);"
        open
      >
        <div class="flex flex-col gap-5">
          <!-- Header -->
          <div class="flex justify-between items-start">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center flex-shrink-0">
                <ShoppingCartIcon size={20} weight="fill" class="text-white" />
              </div>
              <div>
                <h2 id="modal-title" class="text-lg font-semibold" style="color: var(--color-text-primary)">
                  Add to Grocery List
                </h2>
                <p class="text-xs text-caption">
                  From: {recipeTitle}
                </p>
              </div>
            </div>
            <button 
              class="cursor-pointer p-1 hover:bg-input rounded-full transition-colors" 
              style="color: var(--color-text-primary)" 
              on:click={close}
            >
              <CloseIcon size={24} />
            </button>
          </div>

          <!-- Success Message -->
          {#if successMessage}
            <div class="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/30">
              <CheckIcon size={20} class="text-green-500" weight="bold" />
              <p class="text-sm font-medium text-green-600 dark:text-green-400">{successMessage}</p>
            </div>
          {:else}
            <!-- Ingredients Preview -->
            <div class="flex flex-col gap-2">
              <button 
                class="flex items-center justify-between w-full text-sm font-medium"
                style="color: var(--color-text-secondary)"
                on:click={() => showPreview = !showPreview}
              >
                <span>
                  {#if classified.inPantry.length > 0}
                    {toBuyCount} to buy · {classified.inPantry.length} in pantry
                  {:else}
                    {parsedIngredients.length} ingredients found
                  {/if}
                </span>
                {#if showPreview}
                  <CaretUpIcon size={16} />
                {:else}
                  <CaretDownIcon size={16} />
                {/if}
              </button>
              
              {#if showPreview && parsedIngredients.length > 0}
                <div 
                  class="max-h-48 overflow-y-auto rounded-xl p-3 space-y-3"
                  style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
                >
                  {#if classified.toBuy.length > 0}
                    <div class="space-y-1">
                      {#if classified.inPantry.length > 0}
                        <p class="text-xs font-semibold" style="color: var(--color-text-secondary)">Need to buy</p>
                      {/if}
                      {#each classified.toBuy as row}
                        <div class="flex items-center gap-2 text-sm">
                          <span class={`text-xs px-1.5 py-0.5 rounded ${categoryDisplay[row.ingredient.category]?.color || 'text-gray-600'}`}>
                            {categoryDisplay[row.ingredient.category]?.name || 'Other'}
                          </span>
                          <span style="color: var(--color-text-primary)">
                            {#if row.ingredient.quantity}
                              <span class="text-caption">{row.ingredient.quantity}</span>
                            {/if}
                            {row.ingredient.name}
                          </span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                  {#if classified.inPantry.length > 0}
                    <div class="space-y-1">
                      <p class="text-xs font-semibold" style="color: var(--color-text-secondary)">Already in pantry</p>
                      <p class="text-[11px] text-caption">Left off the list. Add any you still need.</p>
                      {#each classified.inPantry as row}
                        {@const included = includeFromPantry.has(pantryRowKey(row.ingredient))}
                        <div class="flex items-center gap-2 text-sm">
                          <span class="min-w-0 flex-1 {included ? '' : 'text-caption'}" style={included ? 'color: var(--color-text-primary)' : ''}>
                            {#if row.ingredient.quantity}
                              <span class="text-caption">{row.ingredient.quantity}</span>
                            {/if}
                            {row.ingredient.name}
                          </span>
                          <button
                            type="button"
                            class="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium border border-green-500/40 text-green-500 hover:bg-green-500/10"
                            on:click={() => toggleIncludeFromPantry(row.ingredient)}
                          >
                            {included ? 'Added' : 'Add'}
                          </button>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
              
              {#if parsedIngredients.length === 0}
                <p class="text-sm text-caption">No ingredients could be parsed from this recipe.</p>
              {/if}
            </div>

            <!-- List Selection -->
            <div class="flex flex-col gap-3">
              <p class="text-sm font-medium" style="color: var(--color-text-primary)">
                Choose a list:
              </p>
              
              {#if !$groceryInitialized}
                <div class="flex items-center justify-center py-4">
                  <SpinnerIcon size={24} class="animate-spin text-caption" />
                </div>
              {:else}
                <div class="flex flex-col gap-2 max-h-48 overflow-y-auto">
                  <!-- Existing lists -->
                  {#each $groceryLists as list (list.id)}
                    <button
                      class="flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all {selectedListId === list.id ? 'ring-2 ring-green-500' : 'hover:bg-input'}"
                      style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
                      on:click={() => selectList(list.id)}
                    >
                      <div class="flex-1 min-w-0">
                        <p class="font-medium truncate" style="color: var(--color-text-primary)">{list.title}</p>
                        <p class="text-xs text-caption">{list.items.length} items</p>
                      </div>
                      {#if selectedListId === list.id}
                        <CheckIcon size={20} class="text-green-500 flex-shrink-0" weight="bold" />
                      {/if}
                    </button>
                  {/each}
                  
                  <!-- Create new list -->
                  {#if showNewListInput}
                    <div 
                      class="flex items-center gap-2 px-4 py-3 rounded-xl"
                      style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
                    >
                      <!-- svelte-ignore a11y-autofocus -->
                      <input
                        type="text"
                        bind:value={newListName}
                        on:keydown={handleKeydownNewList}
                        placeholder="List name..."
                        class="flex-1 bg-transparent text-sm outline-none"
                        style="color: var(--color-text-primary)"
                        autofocus
                      />
                      <button
                        on:click={createNewList}
                        disabled={!newListName.trim() || isCreatingList}
                        class="px-3 py-1 text-sm font-medium text-white bg-green-500 hover:bg-green-600 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {#if isCreatingList}
                          <SpinnerIcon size={16} class="animate-spin" />
                        {:else}
                          Create
                        {/if}
                      </button>
                    </div>
                  {:else}
                    <button
                      class="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 transition-colors"
                      style="border: 1px dashed var(--color-input-border);"
                      on:click={() => showNewListInput = true}
                    >
                      <PlusIcon size={18} />
                      Create New List
                    </button>
                  {/if}
                </div>
              {/if}
            </div>

            <!-- Action Buttons -->
            <div class="flex gap-3 pt-2">
              <button
                on:click={close}
                class="flex-1 px-4 py-2.5 rounded-full text-sm font-medium transition-colors hover:bg-input"
                style="color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
              >
                Cancel
              </button>
              <button
                on:click={addToSelectedList}
                disabled={!selectedListId || parsedIngredients.length === 0 || addingToList || !pantryReady}
                class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium text-white bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {#if addingToList}
                  <SpinnerIcon size={18} class="animate-spin" />
                  Adding...
                {:else}
                  <PlusIcon size={18} />
                  {#if toBuyCount === 0 && classified.inPantry.length > 0}
                    Add recipe
                  {:else}
                    Add {toBuyCount} {toBuyCount === 1 ? 'Item' : 'Items'}
                  {/if}
                {/if}
              </button>
            </div>
          {/if}
        </div>
      </dialog>
    </div>
  </div>
{/if}

<script context="module" lang="ts">
  // Portal action to move element to target
  export function portal(node: HTMLElement, target: HTMLElement) {
    target.appendChild(node);

    return {
      destroy() {
        if (node.parentNode === target) {
          target.removeChild(node);
        }
      }
    };
  }
</script>
