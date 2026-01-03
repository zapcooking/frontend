<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { userPublickey } from '$lib/nostr';
  import { cookbookStore, cookbookLists, cookbookLoading, getCookbookCoverImage, type CookbookList } from '$lib/stores/cookbookStore';
  import { ndk } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import PinIcon from 'phosphor-svelte/lib/PushPin';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import ShareIcon from 'phosphor-svelte/lib/Share';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import Modal from '../../components/Modal.svelte';
  import Button from '../../components/Button.svelte';
  import ImagesComboBox from '../../components/ImagesComboBox.svelte';
  import { writable, type Writable, get } from 'svelte/store';
  import { clickOutside } from '$lib/clickOutside';

  let createModalOpen = false;
  let editModalOpen = false;
  let deleteConfirmOpen = false;
  let changeCoverModalOpen = false;
  let selectedList: CookbookList | null = null;
  let hoveredListId: string | null = null;
  let selectedCoverRecipeATag: string | null = null; // Track selected recipe in modal
  
  // Cover images cache: listId -> imageUrl
  let coverImages: Map<string, string> = new Map();
  
  // Form state
  let newListTitle = '';
  let newListSummary = '';
  let newListImages: Writable<string[]> = writable([]);
  let isSubmitting = false;
  let errorMessage = '';

  async function loadCoverImages() {
    // Load cover images for all lists
    for (const list of $cookbookLists) {
      if (!coverImages.has(list.id)) {
        try {
          const coverImage = await getCookbookCoverImage(list, $ndk);
          if (coverImage) {
            coverImages.set(list.id, coverImage);
            coverImages = new Map(coverImages); // Trigger reactivity
          }
        } catch (error) {
          console.warn('Failed to load cover image for list:', list.id, error);
        }
      }
    }
  }

  onMount(async () => {
    if (!$userPublickey) {
      goto('/login');
      return;
    }
    
    // Load cookbook lists
    await cookbookStore.load();
    
    // Ensure default list exists
    await cookbookStore.ensureDefaultList();
    
    // Load cover images
    await loadCoverImages();
  });

  // Reload cover images when lists change
  $: if ($cookbookLists.length > 0) {
    loadCoverImages();
  }

  onDestroy(() => {
    cookbookStore.reset();
  });

  function openList(list: CookbookList) {
    goto(`/cookbook/${list.naddr}`);
  }

  function openCreateModal() {
    newListTitle = '';
    newListSummary = '';
    newListImages.set([]);
    errorMessage = '';
    createModalOpen = true;
  }

  function closeCreateModal() {
    createModalOpen = false;
    newListTitle = '';
    newListSummary = '';
    newListImages.set([]);
    errorMessage = '';
  }

  async function createList() {
    if (!newListTitle.trim()) {
      errorMessage = 'Please enter a title';
      return;
    }

    isSubmitting = true;
    errorMessage = '';

    try {
      const images = $newListImages;
      const naddr = await cookbookStore.createList(
        newListTitle.trim(),
        newListSummary.trim() || undefined,
        images[0] || undefined
      );

      if (naddr) {
        closeCreateModal();
        goto(`/cookbook/${naddr}`);
      } else {
        errorMessage = 'Failed to create list';
      }
    } catch (err) {
      errorMessage = `Error: ${err}`;
    } finally {
      isSubmitting = false;
    }
  }

  function openEditModal(list: CookbookList, e?: Event) {
    if (e) e.stopPropagation();
    selectedList = list;
    newListTitle = list.title;
    newListSummary = list.summary || '';
    newListImages.set(list.image ? [list.image] : []);
    errorMessage = '';
    hoveredListId = null;
    editModalOpen = true;
  }

  function closeEditModal() {
    editModalOpen = false;
    selectedList = null;
    newListTitle = '';
    newListSummary = '';
    newListImages.set([]);
    errorMessage = '';
  }

  async function updateList() {
    if (!selectedList || !newListTitle.trim()) {
      errorMessage = 'Please enter a title';
      return;
    }

    isSubmitting = true;
    errorMessage = '';

    try {
      const images = $newListImages;
      const success = await cookbookStore.updateList(selectedList.id, {
        title: newListTitle.trim(),
        summary: newListSummary.trim() || undefined,
        image: images[0] || undefined
      });

      if (success) {
        closeEditModal();
      } else {
        errorMessage = 'Failed to update list';
      }
    } catch (err) {
      errorMessage = `Error: ${err}`;
    } finally {
      isSubmitting = false;
    }
  }

  function openDeleteConfirm(list: CookbookList, e?: Event) {
    if (e) e.stopPropagation();
    selectedList = list;
    hoveredListId = null;
    deleteConfirmOpen = true;
  }

  function closeDeleteConfirm() {
    deleteConfirmOpen = false;
    selectedList = null;
  }

  async function deleteList() {
    if (!selectedList) return;

    isSubmitting = true;

    try {
      const success = await cookbookStore.deleteList(selectedList.id);
      if (success) {
        closeDeleteConfirm();
      }
    } catch (err) {
      console.error('Failed to delete list:', err);
    } finally {
      isSubmitting = false;
    }
  }

  async function shareList(list: CookbookList, e?: Event) {
    if (e) e.stopPropagation();
    const url = `${window.location.origin}/cookbook/${list.naddr}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: list.title,
          text: list.summary || `Check out this recipe collection on zap.cooking`,
          url
        });
      } catch (err) {
        // User cancelled or error
        await copyToClipboard(url);
      }
    } else {
      await copyToClipboard(url);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      // Could add a toast notification here
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  function openChangeCoverModal(list: CookbookList, e?: Event) {
    if (e) e.stopPropagation();
    selectedList = list;
    selectedCoverRecipeATag = list.coverRecipeId || null; // Initialize with current cover
    hoveredListId = null;
    changeCoverModalOpen = true;
  }

  function closeChangeCoverModal() {
    changeCoverModalOpen = false;
    selectedList = null;
    selectedCoverRecipeATag = null;
  }

  function selectCoverRecipe(recipeATag: string) {
    selectedCoverRecipeATag = recipeATag;
  }

  async function saveCoverRecipe() {
    if (!selectedList || !selectedCoverRecipeATag) {
      errorMessage = 'Please select a recipe to use as the cover image.';
      return;
    }

    isSubmitting = true;
    errorMessage = '';

    try {
      console.log('Setting cover recipe:', {
        listId: selectedList.id,
        recipeATag: selectedCoverRecipeATag,
        listRecipes: selectedList.recipes
      });

      // Add timeout wrapper to prevent infinite hanging
      const setCoverPromise = cookbookStore.setCoverRecipe(selectedList.id, selectedCoverRecipeATag);
      const timeoutPromise = new Promise<boolean>((_, reject) => 
        setTimeout(() => reject(new Error('Operation timed out after 15 seconds')), 15000)
      );
      
      let success: boolean;
      try {
        success = await Promise.race([setCoverPromise, timeoutPromise]);
      } catch (timeoutError) {
        console.error('Set cover recipe timed out:', timeoutError);
        errorMessage = 'Operation timed out. The cover may still update. Please refresh the page.';
        isSubmitting = false;
        return;
      }
      
      if (success) {
        console.log('Cover recipe updated successfully');
        
        // Clear cover image cache for this list
        coverImages.delete(selectedList.id);
        
        // Get updated list from store
        const updatedStoreState = get(cookbookStore);
        const updatedList = updatedStoreState.lists.find(l => l.id === selectedList.id);
        
        if (updatedList) {
          // Reload cover image immediately with cache-busting
          const newCoverImage = await getCookbookCoverImage(updatedList, $ndk, true);
          if (newCoverImage) {
            coverImages.set(selectedList.id, newCoverImage);
            coverImages = new Map(coverImages); // Trigger reactivity
          }
        } else {
          // Fallback: reload all cover images
          await loadCoverImages();
        }
        
        closeChangeCoverModal();
      } else {
        errorMessage = 'Failed to update cover image. Please try again.';
      }
    } catch (err: any) {
      console.error('Failed to set cover recipe:', err);
      // Provide user-friendly error message
      if (err?.message) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      } else {
        errorMessage = 'Failed to update cover image. Please check your connection and try again.';
      }
    } finally {
      isSubmitting = false;
    }
  }

  async function loadRecipeEvents(list: CookbookList): Promise<NDKEvent[]> {
    const events: NDKEvent[] = [];
    
    for (const aTag of list.recipes) {
      const parts = aTag.split(':');
      if (parts.length !== 3) continue;
      
      const [kind, pubkey, identifier] = parts;
      try {
        const recipeEvent = await $ndk.fetchEvent({
          kinds: [Number(kind)],
          '#d': [identifier],
          authors: [pubkey]
        });
        if (recipeEvent) {
          events.push(recipeEvent);
        }
      } catch (error) {
        console.warn('Failed to fetch recipe:', aTag, error);
      }
    }
    
    return events;
  }

  // Helper to get cover image for a list
  function getListCoverImage(list: CookbookList): string | undefined {
    return coverImages.get(list.id) || list.image;
  }

  // Separate saved collection from custom collections
  $: savedCollection = $cookbookLists.find(l => l.isDefault);
  $: customCollections = $cookbookLists.filter(l => !l.isDefault);
</script>

<svelte:head>
  <title>My Cookbook - zap.cooking</title>
  <meta name="description" content="Your saved recipes and collections on zap.cooking" />
</svelte:head>

<!-- Create List Modal -->
<Modal cleanup={closeCreateModal} open={createModalOpen}>
  <h1 slot="title">Create New Collection</h1>
  
  <form on:submit|preventDefault={createList} class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <label for="title" class="text-sm font-medium" style="color: var(--color-text-primary)">
        Title <span class="text-red-500">*</span>
      </label>
      <input
        id="title"
        type="text"
        bind:value={newListTitle}
        placeholder="e.g., Weeknight Dinners"
        class="input"
        disabled={isSubmitting}
      />
    </div>

    <div class="flex flex-col gap-2">
      <label for="summary" class="text-sm font-medium" style="color: var(--color-text-primary)">
        Description
      </label>
      <textarea
        id="summary"
        bind:value={newListSummary}
        placeholder="A brief description of this collection..."
        rows="3"
        class="input"
        disabled={isSubmitting}
      />
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium" style="color: var(--color-text-primary)">
        Cover Image
      </label>
      <ImagesComboBox uploadedImages={newListImages} limit={1} />
    </div>

    {#if errorMessage}
      <p class="text-red-500 text-sm">{errorMessage}</p>
    {/if}

    <div class="flex justify-end gap-2 pt-2">
      <Button on:click={closeCreateModal} primary={false} disabled={isSubmitting}>
        Cancel
      </Button>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating...' : 'Create Collection'}
      </Button>
    </div>
  </form>
</Modal>

<!-- Edit List Modal -->
<Modal cleanup={closeEditModal} open={editModalOpen}>
  <h1 slot="title">Edit Collection</h1>
  
  <form on:submit|preventDefault={updateList} class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <label for="edit-title" class="text-sm font-medium" style="color: var(--color-text-primary)">
        Title <span class="text-red-500">*</span>
      </label>
      <input
        id="edit-title"
        type="text"
        bind:value={newListTitle}
        placeholder="e.g., Weeknight Dinners"
        class="input"
        disabled={isSubmitting || selectedList?.isDefault}
      />
      {#if selectedList?.isDefault}
        <p class="text-xs text-caption">The default collection title cannot be changed.</p>
      {/if}
    </div>

    <div class="flex flex-col gap-2">
      <label for="edit-summary" class="text-sm font-medium" style="color: var(--color-text-primary)">
        Description
      </label>
      <textarea
        id="edit-summary"
        bind:value={newListSummary}
        placeholder="A brief description of this collection..."
        rows="3"
        class="input"
        disabled={isSubmitting}
      />
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium" style="color: var(--color-text-primary)">
        Cover Image
      </label>
      <ImagesComboBox uploadedImages={newListImages} limit={1} />
    </div>

    {#if errorMessage}
      <p class="text-red-500 text-sm">{errorMessage}</p>
    {/if}

    <div class="flex justify-end gap-2 pt-2">
      <Button on:click={closeEditModal} primary={false} disabled={isSubmitting}>
        Cancel
      </Button>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  </form>
</Modal>

<!-- Delete Confirmation Modal -->
<Modal cleanup={closeDeleteConfirm} open={deleteConfirmOpen}>
  <h1 slot="title">Delete Collection</h1>
  
  <div class="flex flex-col gap-4">
    <p style="color: var(--color-text-primary)">
      Are you sure you want to delete "<strong>{selectedList?.title}</strong>"? 
      This will remove the collection but won't delete the recipes themselves.
    </p>
    
    <div class="flex justify-end gap-2">
      <Button on:click={closeDeleteConfirm} primary={false} disabled={isSubmitting}>
        Cancel
      </Button>
      <button
        on:click={deleteList}
        disabled={isSubmitting}
        class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {isSubmitting ? 'Deleting...' : 'Delete Collection'}
      </button>
    </div>
  </div>
</Modal>

<!-- Change Cover Modal -->
<Modal cleanup={closeChangeCoverModal} open={changeCoverModalOpen}>
  <h1 slot="title">Choose Cover Image</h1>
  
  {#if selectedList}
    {#await loadRecipeEvents(selectedList) then recipeEvents}
      <div class="flex flex-col gap-4">
        <p class="text-sm text-caption">
          Select a recipe to use as your cookbook cover
        </p>
        
        {#if recipeEvents.length === 0}
          <p class="text-caption text-center py-8">
            No recipes in this collection yet. Add recipes to choose a cover image.
          </p>
        {:else}
          <div class="grid grid-cols-3 gap-3 max-h-96 overflow-y-auto p-1">
            {#each recipeEvents as recipeEvent}
              {@const recipeATag = `${recipeEvent.kind}:${recipeEvent.pubkey}:${recipeEvent.replaceableDTag()}`}
              {@const recipeImage = recipeEvent.tags.find(t => t[0] === 'image')?.[1]}
              {@const recipeTitle = recipeEvent.tags.find(t => t[0] === 'title')?.[1] || 'Untitled'}
              {@const isSelected = selectedCoverRecipeATag === recipeATag}
              
              <button
                type="button"
                on:click|stopPropagation={() => selectCoverRecipe(recipeATag)}
                disabled={isSubmitting}
                class="relative aspect-square rounded-lg overflow-hidden border-2 transition-all cursor-pointer {isSelected ? 'border-orange-500 ring-2 ring-orange-200' : 'border-transparent hover:border-orange-300'}"
                aria-label="Select {recipeTitle} as cover"
              >
                {#if recipeImage}
                  <img 
                    src={recipeImage} 
                    alt={recipeTitle}
                    class="w-full h-full object-cover pointer-events-none"
                  />
                {:else}
                  <div class="w-full h-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center pointer-events-none">
                    <span class="text-xs text-caption text-center px-2">{recipeTitle}</span>
                  </div>
                {/if}
                
                {#if isSelected}
                  <div class="absolute bottom-2 right-2 bg-orange-500 text-white text-xs px-2 py-1 rounded font-semibold">
                    ✓ Selected
                  </div>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
        
        {#if errorMessage}
          <p class="text-red-500 text-sm">{errorMessage}</p>
        {/if}
        
        <div class="flex justify-end gap-2 pt-2">
          <Button on:click={closeChangeCoverModal} primary={false} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button 
            on:click={saveCoverRecipe} 
            disabled={isSubmitting || !selectedCoverRecipeATag}
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    {:catch error}
      <p class="text-red-500 text-sm">Error loading recipes: {error}</p>
      <div class="flex justify-end gap-2 pt-2">
        <Button on:click={closeChangeCoverModal} primary={false}>
          Close
        </Button>
      </div>
    {/await}
  {/if}
</Modal>

<div class="flex flex-col gap-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div class="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
        <BookmarkIcon size={24} weight="fill" class="text-white" />
      </div>
      <div>
        <h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">My Cookbook</h1>
        <p class="text-sm text-caption">Your saved recipes & collections</p>
      </div>
    </div>
    
    <button
      on:click={openCreateModal}
      class="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-full font-medium transition-all text-sm"
      aria-label="Create new collection"
    >
      <PlusIcon size={18} weight="bold" />
      <span class="hidden sm:inline">New Collection</span>
    </button>
  </div>

  <!-- Loading State -->
  {#if $cookbookLoading}
    <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {#each Array(4) as _}
        <div class="h-40 rounded-2xl animate-pulse" style="background-color: var(--color-input-bg);"></div>
      {/each}
    </div>
  {:else if $cookbookLists.length === 0}
    <!-- Empty State -->
    <div class="flex flex-col items-center justify-center py-16 px-4">
      <div class="w-20 h-20 rounded-full bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30 flex items-center justify-center mb-4">
        <BookmarkIcon size={40} weight="regular" class="text-orange-500" />
      </div>
      <h2 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary)">
        Start Your Cookbook
      </h2>
      <p class="text-caption text-center max-w-md mb-6">
        Save recipes you love and organize them into collections. Your cookbook is private to you.
      </p>
      <div class="flex gap-3">
        <button
          on:click={openCreateModal}
          class="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-full font-medium transition-all"
        >
          <PlusIcon size={18} weight="bold" />
          Create Collection
        </button>
        <a
          href="/recent"
          class="flex items-center px-5 py-2.5 rounded-full font-medium transition-colors"
          style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
        >
          Browse Recipes
        </a>
      </div>
    </div>
  {:else}
    <!-- Collections Grid -->
    <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <!-- Saved Collection (Always First, Special Styling) -->
      {#if savedCollection}
        {@const list = savedCollection}
        <button
          on:click={() => openList(list)}
          on:mouseenter={() => hoveredListId = list.id}
          on:mouseleave={() => hoveredListId = null}
          class="group relative h-48 sm:h-56 rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-xl text-left collection-card saved-collection"
          style="box-shadow: {hoveredListId === list.id ? '0 8px 24px rgba(255, 107, 53, 0.3)' : '0 2px 8px rgba(0,0,0,0.1)'};"
          aria-label="Saved collection with {list.recipeCount} recipes"
        >
          <!-- Background -->
          <div 
            class="absolute inset-0"
            style={getListCoverImage(list)
              ? `background-image: url('${getListCoverImage(list)}'); background-size: cover; background-position: center;` 
              : 'background: linear-gradient(135deg, #FF6B35 0%, #F7931E 100%);'}
          >
            <div class="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors"></div>
          </div>

          <!-- Content -->
          <div class="relative h-full flex flex-col justify-between p-4">
            <div class="flex justify-between items-start">
              <div class="flex items-center gap-2">
                <PinIcon size={20} weight="fill" class="text-white drop-shadow-lg" />
                <span class="text-white/90 text-xs font-medium drop-shadow">Quick Saves</span>
              </div>
            </div>

            <div>
              <h3 class="text-white text-xl font-bold mb-1 drop-shadow-lg">{list.title}</h3>
              <p class="text-white/90 text-sm drop-shadow">
                <span class="text-lg font-semibold">{list.recipeCount}</span> {list.recipeCount === 1 ? 'recipe' : 'recipes'}
              </p>
            </div>
          </div>
        </button>
      {/if}

      <!-- Custom Collections -->
      {#each customCollections as list (list.id)}
        <button
          on:click={() => openList(list)}
          on:mouseenter={() => hoveredListId = list.id}
          on:mouseleave={() => hoveredListId = null}
          class="group relative h-40 rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-xl text-left collection-card"
          style="box-shadow: {hoveredListId === list.id ? '0 8px 24px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.1)'}; transform: {hoveredListId === list.id ? 'translateY(-4px)' : 'translateY(0)'};"
          aria-label="{list.title} collection with {list.recipeCount} recipes"
        >
          <!-- Background -->
          <div 
            class="absolute inset-0"
            style={getListCoverImage(list)
              ? `background-image: url('${getListCoverImage(list)}'); background-size: cover; background-position: center;` 
              : 'background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);'}
          >
            <div class="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors"></div>
          </div>

          <!-- Empty Collection Placeholder Grid -->
          {#if list.recipeCount === 0}
            <div class="absolute inset-0 flex items-center justify-center p-4">
              <div class="grid grid-cols-3 gap-2 w-full max-w-[200px] opacity-40">
                {#each Array(6) as _}
                  <div class="aspect-square rounded-lg border-2 border-dashed border-white/50 flex items-center justify-center">
                    <PlusIcon size={16} class="text-white/50" />
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Content -->
          <div class="relative h-full flex flex-col justify-between p-4">
            <div class="flex justify-between items-start">
              <span></span>
              
              <!-- Quick Actions Overlay (Desktop Hover) -->
              {#if hoveredListId === list.id && list.recipeCount > 0}
                <div 
                  class="flex gap-2"
                  on:click|stopPropagation
                >
                  <button
                    on:click={(e) => openChangeCoverModal(list, e)}
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-gray-800 transition-colors shadow-lg"
                    aria-label="Change cover image"
                    title="Change Cover"
                  >
                    <ImageIcon size={16} weight="bold" />
                  </button>
                  <button
                    on:click={(e) => openEditModal(list, e)}
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-gray-800 transition-colors shadow-lg"
                    aria-label="Edit collection"
                    title="Edit"
                  >
                    <PencilSimpleIcon size={16} weight="bold" />
                  </button>
                  <button
                    on:click={(e) => shareList(list, e)}
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-gray-800 transition-colors shadow-lg"
                    aria-label="Share collection"
                    title="Share"
                  >
                    <ShareIcon size={16} weight="bold" />
                  </button>
                  <button
                    on:click={(e) => openDeleteConfirm(list, e)}
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-red-500/90 hover:bg-red-600 text-white transition-colors shadow-lg"
                    aria-label="Delete collection"
                    title="Delete"
                  >
                    <TrashIcon size={16} weight="bold" />
                  </button>
                </div>
              {/if}
            </div>

            <div>
              <h3 class="text-white text-lg font-bold mb-1 drop-shadow-lg truncate">{list.title}</h3>
              <p class="text-white/90 text-sm drop-shadow">
                {list.recipeCount} {list.recipeCount === 1 ? 'recipe' : 'recipes'}
              </p>
            </div>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .collection-card {
    position: relative;
  }

  .saved-collection {
    /* Saved collection can be slightly larger on desktop */
  }

  @media (min-width: 1280px) {
    .saved-collection {
      grid-column: span 1;
    }
  }

  /* Smooth transitions */
  .collection-card {
    will-change: transform;
  }
</style>
