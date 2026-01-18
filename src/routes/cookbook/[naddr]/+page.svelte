<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKUserProfile } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { onMount } from 'svelte';
  import Feed from '../../../components/Feed.svelte';
  import Button from '../../../components/Button.svelte';
  import Modal from '../../../components/Modal.svelte';
  import ImagesComboBox from '../../../components/ImagesComboBox.svelte';
  import ListComboBox from '../../../components/ListComboBox.svelte';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimple';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import ShareIcon from 'phosphor-svelte/lib/Share';
  import BookmarkIcon from 'phosphor-svelte/lib/BookmarkSimple';
  import PinIcon from 'phosphor-svelte/lib/PushPin';
  import CloudSlashIcon from 'phosphor-svelte/lib/CloudSlash';
  import { DEFAULT_LIST_ID, DEFAULT_LIST_TITLE, cookbookStore, getCookbookCoverImage, type CookbookList } from '$lib/stores/cookbookStore';
  import PanLoader from '../../../components/PanLoader.svelte';
  import { writable, type Writable, get } from 'svelte/store';
  import { RECIPE_TAG_PREFIX_NEW } from '$lib/consts';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import { isOnline } from '$lib/connectionMonitor';
  import { offlineStorage, type CachedRecipe } from '$lib/offlineStorage';
  import { NDKEvent } from '@nostr-dev-kit/ndk';

  let loaded = false;
  let event: NDKEvent | null = null;
  let events: NDKEvent[] = [];
  let isOwner = false;
  let offlineMode = false; // True when we have cached cookbook but can't load recipes
  let cachedRecipeCount = 0; // Number of recipes in the cached cookbook
  
  // Edit modal state
  let editModalOpen = false;
  let editTitle = '';
  let editSummary = '';
  let editImages: Writable<string[]> = writable([]);
  let isSubmitting = false;
  let errorMessage = '';
  
  // Manage recipes modal state
  let manageModalOpen = false;
  type RecipeItem = { title?: string; naddr: string };
  let recipeItems: Writable<RecipeItem[]> = writable([]);

  // Delete confirmation
  let deleteConfirmOpen = false;
  
  // Change cover modal
  let changeCoverModalOpen = false;
  let coverImage: string | undefined = undefined;
  let selectedCoverRecipeATag: string | null = null; // Track selected recipe in modal

  $: {
    if ($page.params.naddr) {
      loadData();
    }
  }

  async function loadData() {
    loaded = false;
    events = [];
    event = null;
    coverImage = undefined;
    offlineMode = false;
    cachedRecipeCount = 0;

    try {
      if ($page.params.naddr?.startsWith('naddr1')) {
        const decoded = nip19.decode($page.params.naddr).data as nip19.AddressPointer;
        
        // Ensure cookbook store is loaded (so list will be available for updates)
        const storeState = get(cookbookStore);
        if (!storeState.initialized && $userPublickey) {
          await cookbookStore.load();
        }
        
        // Check if the list is in the local store
        const updatedStoreState = get(cookbookStore);
        const localList = updatedStoreState.lists.find(l => l.id === decoded.identifier);
        
        if (localList && localList.event) {
          // Use the event from the store (which should have the latest cover tag)
          event = localList.event;
          isOwner = $userPublickey === event.author.pubkey;
          // Prefer the actual number of cached recipes (if available) over the stored count
          if (Array.isArray((localList as any).recipes)) {
            cachedRecipeCount = (localList as any).recipes.length;
          } else {
            cachedRecipeCount = localList.recipeCount ?? 0;
          }
          
          // Verify the event has the cover tag from the store (sync them if needed)
          const coverTagInEvent = event.tags.find(t => t[0] === 'cover')?.[1];
          if (localList.coverRecipeId && coverTagInEvent !== localList.coverRecipeId) {
            // Event tags are out of sync with store, update them
            event.tags = event.tags.filter(t => t[0] !== 'cover');
            event.tags.push(['cover', localList.coverRecipeId]);
          }
          
          // Load cover image (may use cached version)
          try {
            coverImage = await getCookbookCoverImage(localList, $ndk);
          } catch (e) {
            console.warn('Failed to load cover image:', e);
          }
          
          // Load recipes in the list
          const recipeTags = event.tags.filter(t => t[0] === 'a');
          const recipeATags = recipeTags.map(t => t[1]);
          
          // Check if we're offline - try to load from cache
          if (!$isOnline) {
            console.log('[Cookbook] Offline - loading recipes from cache');
            console.log('[Cookbook] Looking for a-tags:', recipeATags);
            const cachedRecipes = await offlineStorage.getRecipes(recipeATags);
            console.log('[Cookbook] Found cached recipes:', cachedRecipes.length);
            
            if (cachedRecipes.length > 0) {
              // Convert cached recipes back to NDKEvent-like objects for the Feed component
              events = cachedRecipes.map(cached => {
                const fakeEvent = new NDKEvent($ndk);
                fakeEvent.kind = cached.eventKind;
                fakeEvent.pubkey = cached.authorPubkey;
                fakeEvent.created_at = cached.createdAt;
                fakeEvent.content = cached.content;
                fakeEvent.tags = cached.eventTags;
                // Generate a stable ID from the a-tag for keyed each blocks
                fakeEvent.id = cached.id; // Use a-tag as ID (e.g., "30023:pubkey:slug")
                return fakeEvent;
              });
              console.log(`[Cookbook] Loaded ${events.length} recipes from cache`);
              
              // If we have some but not all, still show what we have
              if (cachedRecipes.length < cachedRecipeCount) {
                console.log(`[Cookbook] Missing ${cachedRecipeCount - cachedRecipes.length} recipes in cache`);
              }
            } else {
              // No cached recipes available
              console.log('[Cookbook] No cached recipes found, showing offline message');
              offlineMode = true;
            }
            loaded = true;
            return;
          }
          
          // Online - fetch from Nostr and cache
          for (const tag of recipeTags) {
            const parts = tag[1].split(':');
            if (parts.length !== 3) continue;
            
            const [kind, pubkey, identifier] = parts;
            
            try {
              const recipeEvent = await $ndk.fetchEvent({
                kinds: [Number(kind)],
                '#d': [identifier],
                authors: [pubkey]
              });
              
              if (recipeEvent) {
                events = [...events, recipeEvent];
                // Cache the recipe for offline use
                const dTag = recipeEvent.tags?.find((t: string[]) => t[0] === 'd')?.[1] || '';
                const aTag = `${recipeEvent.kind}:${recipeEvent.pubkey}:${dTag}`;
                console.log('[Cookbook] Caching recipe:', aTag);
                await offlineStorage.saveRecipeFromEvent(recipeEvent);
              }
            } catch (fetchError) {
              console.warn('Failed to fetch recipe:', identifier, fetchError);
            }
          }
          
          // If we couldn't load any recipes but expected some, try cache as fallback
          if (events.length === 0 && cachedRecipeCount > 0) {
            const cachedRecipes = await offlineStorage.getRecipes(recipeATags);
            if (cachedRecipes.length > 0) {
              events = cachedRecipes.map(cached => {
                const fakeEvent = new NDKEvent($ndk);
                fakeEvent.kind = cached.eventKind;
                fakeEvent.pubkey = cached.authorPubkey;
                fakeEvent.created_at = cached.createdAt;
                fakeEvent.content = cached.content;
                fakeEvent.tags = cached.eventTags;
                fakeEvent.id = cached.id; // Use a-tag as ID for keyed each blocks
                return fakeEvent;
              });
            } else {
              offlineMode = true;
            }
          }
        } else {
          // Not in local store - need to fetch from relays
          // Check if we're offline first
          if (!$isOnline) {
            offlineMode = true;
            loaded = true;
            return;
          }
          
          // Fetch from relays
          const e = await $ndk.fetchEvent({
            '#d': [decoded.identifier],
            authors: [decoded.pubkey],
            kinds: [30001]
          });
          
          if (e) {
            event = e;
            isOwner = $userPublickey === e.author.pubkey;
            
            // If this is the owner's list and not in store, add it to store for updates
            if (isOwner && $userPublickey) {
              // Create list object and add to store temporarily
              const tempList: CookbookList = {
                id: decoded.identifier,
                naddr: $page.params.naddr,
                title: e.tags.find(t => t[0] === 'title')?.[1] || '',
                image: e.tags.find(t => t[0] === 'image')?.[1],
                coverRecipeId: e.tags.find(t => t[0] === 'cover')?.[1],
                recipeCount: e.tags.filter(t => t[0] === 'a').length,
                recipes: e.tags.filter(t => t[0] === 'a').map(t => t[1]),
                createdAt: e.created_at || 0,
                isDefault: decoded.identifier === DEFAULT_LIST_ID,
                event: e
              };
              
              // Add to store so setCoverRecipe can find it
              cookbookStore.update(s => {
                if (!s.lists.find(l => l.id === tempList.id)) {
                  return {
                    ...s,
                    lists: [...s.lists, tempList]
                  };
                }
                return s;
              });
            }
            
            // Create temporary list object to get cover image
            const tempList = {
              id: decoded.identifier,
              naddr: $page.params.naddr,
              title: e.tags.find(t => t[0] === 'title')?.[1] || '',
              image: e.tags.find(t => t[0] === 'image')?.[1],
              coverRecipeId: e.tags.find(t => t[0] === 'cover')?.[1],
              recipeCount: 0,
              recipes: e.tags.filter(t => t[0] === 'a').map(t => t[1]),
              createdAt: e.created_at || 0,
              isDefault: decoded.identifier === DEFAULT_LIST_ID,
              event: e
            };
            
            // Load cover image
            coverImage = await getCookbookCoverImage(tempList, $ndk);
            
            // Load recipes in the list
            const recipeTags = e.tags.filter(t => t[0] === 'a');
            
            for (const tag of recipeTags) {
              const parts = tag[1].split(':');
              if (parts.length !== 3) continue;
              
              const [kind, pubkey, identifier] = parts;
              
              try {
                const recipeEvent = await $ndk.fetchEvent({
                  kinds: [Number(kind)],
                  '#d': [identifier],
                  authors: [pubkey]
                });
                
                if (recipeEvent) {
                  events = [...events, recipeEvent];
                  // Cache the recipe for offline use
                  await offlineStorage.saveRecipeFromEvent(recipeEvent);
                }
              } catch (fetchError) {
                console.warn('Failed to fetch recipe:', identifier, fetchError);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading list:', error);
    }

    loaded = true;
  }

  function getListTitle(): string {
    if (!event) return 'Collection';
    const dTag = event.tags.find(t => t[0] === 'd')?.[1];
    if (dTag === DEFAULT_LIST_ID) return DEFAULT_LIST_TITLE;
    return event.tags.find(t => t[0] === 'title')?.[1] || 'Collection';
  }

  function getListSummary(): string | undefined {
    return event?.tags.find(t => t[0] === 'summary')?.[1];
  }

  function getListImage(): string | undefined {
    // Use coverImage if loaded, otherwise fall back to legacy image tag
    return coverImage || event?.tags.find(t => t[0] === 'image')?.[1];
  }
  
  function openChangeCoverModal() {
    if (!event) return;
    const coverRecipeId = event.tags.find(t => t[0] === 'cover')?.[1];
    selectedCoverRecipeATag = coverRecipeId || null; // Initialize with current cover
    changeCoverModalOpen = true;
  }
  
  function closeChangeCoverModal() {
    changeCoverModalOpen = false;
    selectedCoverRecipeATag = null;
  }
  
  function selectCoverRecipe(recipeEvent: NDKEvent) {
    const recipeATag = `${recipeEvent.kind}:${recipeEvent.pubkey}:${recipeEvent.replaceableDTag()}`;
    selectedCoverRecipeATag = recipeATag;
  }
  
  async function saveCoverRecipe() {
    if (!event || !selectedCoverRecipeATag) {
      errorMessage = 'Please select a recipe to use as the cover image.';
      return;
    }
    
    isSubmitting = true;
    errorMessage = '';
    
    try {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1];
      if (!dTag) {
        throw new Error('Invalid collection');
      }
      
      // Create a new event with updated cover tag (same approach as saveEdits)
      const { NDKEvent } = await import('@nostr-dev-kit/ndk');
      const newEvent = new NDKEvent($ndk);
      newEvent.kind = 30001;
      
      // Copy all metadata tags
      newEvent.tags.push(['d', dTag]);
      newEvent.tags.push(['title', event.tags.find(t => t[0] === 'title')?.[1] || '']);
      
      const summary = event.tags.find(t => t[0] === 'summary')?.[1];
      if (summary) {
        newEvent.tags.push(['summary', summary]);
      }
      
      const image = event.tags.find(t => t[0] === 'image')?.[1];
      if (image) {
        newEvent.tags.push(['image', image]);
      }
      
      // Keep recipe tag for non-default lists
      if (!isDefaultList()) {
        newEvent.tags.push(['t', RECIPE_TAG_PREFIX_NEW]);
      }
      
      // Add the new cover tag
      newEvent.tags.push(['cover', selectedCoverRecipeATag]);
      
      // Copy all recipe tags
      event.tags.filter(t => t[0] === 'a').forEach(t => {
        newEvent.tags.push(['a', t[1]]);
      });

      const { addClientTagToEvent } = await import('$lib/nip89');
      addClientTagToEvent(newEvent);

      // Publish with timeout
      const publishPromise = newEvent.publish();
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Publish timeout after 10 seconds')), 10000)
      );
      
      try {
        await Promise.race([publishPromise, timeoutPromise]);
        console.log('Cover recipe updated successfully');
      } catch (publishError: any) {
        if (publishError?.message?.includes('timeout')) {
          console.warn('Publish timed out, but updating local state');
        } else {
          throw publishError;
        }
      }
      
      // Update local event (same as saveEdits does)
      event = newEvent;
      
      // Update the store with the new event
      const listId = dTag;
      cookbookStore.update(s => ({
        ...s,
        lists: s.lists.map(l => 
          l.id === listId 
            ? { 
                ...l, 
                coverRecipeId: selectedCoverRecipeATag,
                event: newEvent
              }
            : l
        )
      }));
      
      // Clear cover image cache and reload
      coverImage = undefined;
      const updatedList = get(cookbookStore).lists.find(l => l.id === listId);
      if (updatedList) {
        coverImage = await getCookbookCoverImage(updatedList, $ndk, true);
      }
      
      closeChangeCoverModal();
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

  function isDefaultList(): boolean {
    if (!event) return false;
    return event.tags.find(t => t[0] === 'd')?.[1] === DEFAULT_LIST_ID;
  }

  // Edit functionality
  function openEditModal() {
    editTitle = getListTitle();
    editSummary = getListSummary() || '';
    const img = getListImage();
    editImages.set(img ? [img] : []);
    errorMessage = '';
    editModalOpen = true;
  }

  function closeEditModal() {
    editModalOpen = false;
    errorMessage = '';
  }

  async function saveEdits() {
    if (!event || !editTitle.trim()) {
      errorMessage = 'Please enter a title';
      return;
    }

    isSubmitting = true;
    errorMessage = '';

    try {
      const { NDKEvent } = await import('@nostr-dev-kit/ndk');
      const newEvent = new NDKEvent($ndk);
      newEvent.kind = 30001;
      
      const dTag = event.tags.find(t => t[0] === 'd')?.[1];
      newEvent.tags.push(['d', dTag || '']);
      newEvent.tags.push(['title', isDefaultList() ? DEFAULT_LIST_TITLE : editTitle.trim()]);
      
      if (editSummary.trim()) {
        newEvent.tags.push(['summary', editSummary.trim()]);
      }
      
      const images = $editImages;
      if (images[0]) {
        newEvent.tags.push(['image', images[0]]);
      }
      
      // Keep recipe tag for non-default lists
      if (!isDefaultList()) {
        newEvent.tags.push(['t', RECIPE_TAG_PREFIX_NEW]);
      }
      
      // Copy all recipe tags
      event.tags.filter(t => t[0] === 'a').forEach(t => {
        newEvent.tags.push(['a', t[1]]);
      });

      const { addClientTagToEvent } = await import('$lib/nip89');
      addClientTagToEvent(newEvent);

      await newEvent.publish();
      event = newEvent;
      closeEditModal();
    } catch (err) {
      errorMessage = `Error: ${err}`;
    } finally {
      isSubmitting = false;
    }
  }

  // Manage recipes functionality
  function openManageModal() {
    const items: RecipeItem[] = [];
    
    event?.tags.filter(t => t[0] === 'a').forEach(t => {
      const parts = t[1].split(':');
      if (parts.length === 3) {
        const [kind, pubkey, identifier] = parts;
        const naddr = nip19.naddrEncode({
          kind: Number(kind),
          identifier,
          pubkey
        });
        const existingEvent = events.find(e => e.replaceableDTag() === identifier && e.pubkey === pubkey);
        items.push({
          naddr,
          title: existingEvent?.tags.find(t => t[0] === 'title')?.[1]
        });
      }
    });
    
    recipeItems.set(items);
    manageModalOpen = true;
  }

  function closeManageModal() {
    manageModalOpen = false;
  }

  async function saveRecipeOrder() {
    if (!event) return;

    isSubmitting = true;

    try {
      const { NDKEvent } = await import('@nostr-dev-kit/ndk');
      const newEvent = new NDKEvent($ndk);
      newEvent.kind = 30001;
      
      // Copy metadata tags
      const metaTags = ['d', 'title', 'summary', 'image', 't'];
      event.tags.forEach(t => {
        if (metaTags.includes(t[0])) {
          newEvent.tags.push([...t]);
        }
      });
      
      // Add recipes in new order
      $recipeItems.forEach(item => {
        const decoded = nip19.decode(item.naddr).data as nip19.AddressPointer;
        const aTag = `${decoded.kind}:${decoded.pubkey}:${decoded.identifier}`;
        newEvent.tags.push(['a', aTag]);
      });

      const { addClientTagToEvent } = await import('$lib/nip89');
      addClientTagToEvent(newEvent);

      await newEvent.publish();
      event = newEvent;
      
      // Reload to reflect changes
      await loadData();
      closeManageModal();
    } catch (err) {
      console.error('Failed to save recipe order:', err);
    } finally {
      isSubmitting = false;
    }
  }

  // Delete functionality
  function openDeleteConfirm() {
    deleteConfirmOpen = true;
  }

  function closeDeleteConfirm() {
    deleteConfirmOpen = false;
  }

  async function deleteList() {
    if (!event || isDefaultList()) return;

    isSubmitting = true;

    try {
      const { NDKEvent } = await import('@nostr-dev-kit/ndk');
      const deleteEvent = new NDKEvent($ndk);
      deleteEvent.kind = 5;
      deleteEvent.tags = [
        ['e', event.id],
        ['a', `30001:${event.pubkey}:${event.tags.find(t => t[0] === 'd')?.[1]}`]
      ];

      await deleteEvent.publish();
      goto('/cookbook');
    } catch (err) {
      console.error('Failed to delete list:', err);
    } finally {
      isSubmitting = false;
    }
  }

  async function shareList() {
    const url = `${window.location.origin}/cookbook/${$page.params.naddr}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: getListTitle(),
          text: getListSummary() || `Check out this recipe collection on zap.cooking`,
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

  $: listTitle = getListTitle();
  $: listSummary = getListSummary();
  $: listImage = getListImage();

  $: og_meta = {
    title: `${listTitle} - zap.cooking`,
    description: listSummary || `A recipe collection on zap.cooking`,
    image: listImage || 'https://zap.cooking/social-share.png'
  };
</script>

<svelte:head>
  <title>{og_meta.title}</title>
  
  {#if loaded}
    <meta name="description" content={og_meta.description} />
    <meta property="og:url" content={`https://zap.cooking/cookbook/${$page.params.naddr}`} />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={og_meta.title} />
    <meta property="og:description" content={og_meta.description} />
    <meta property="og:image" content={og_meta.image} />

    <meta name="twitter:card" content="summary_large_image" />
    <meta property="twitter:domain" content="zap.cooking" />
    <meta property="twitter:url" content={`https://zap.cooking/cookbook/${$page.params.naddr}`} />
    <meta name="twitter:title" content={og_meta.title} />
    <meta name="twitter:description" content={og_meta.description} />
    <meta name="twitter:image" content={og_meta.image} />
  {/if}
</svelte:head>

<!-- Edit Modal -->
<Modal cleanup={closeEditModal} open={editModalOpen}>
  <h1 slot="title">Edit Collection</h1>
  
  <form on:submit|preventDefault={saveEdits} class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <label for="edit-title" class="text-sm font-medium" style="color: var(--color-text-primary)">
        Title
      </label>
      <input
        id="edit-title"
        type="text"
        bind:value={editTitle}
        class="input"
        disabled={isSubmitting || isDefaultList()}
      />
      {#if isDefaultList()}
        <p class="text-xs text-caption">The default collection title cannot be changed.</p>
      {/if}
    </div>

    <div class="flex flex-col gap-2">
      <label for="edit-summary" class="text-sm font-medium" style="color: var(--color-text-primary)">
        Description
      </label>
      <textarea
        id="edit-summary"
        bind:value={editSummary}
        rows="3"
        class="input"
        disabled={isSubmitting}
      />
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium" style="color: var(--color-text-primary)">
        Cover Image
      </label>
      <ImagesComboBox uploadedImages={editImages} limit={1} />
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

<!-- Manage Recipes Modal -->
<Modal cleanup={closeManageModal} open={manageModalOpen}>
  <h1 slot="title">Manage Recipes</h1>
  
  <div class="flex flex-col gap-4">
    <p class="text-sm text-caption">
      Reorder or remove recipes from this collection.
    </p>
    
    <ListComboBox showIndex={true} placeholder="naddr1..." selected={recipeItems} />
    
    <div class="flex justify-end gap-2 pt-2">
      <Button on:click={closeManageModal} primary={false} disabled={isSubmitting}>
        Cancel
      </Button>
      <Button on:click={saveRecipeOrder} disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  </div>
</Modal>

<!-- Delete Confirmation Modal -->
<Modal cleanup={closeDeleteConfirm} open={deleteConfirmOpen}>
  <h1 slot="title">Delete Collection</h1>
  
  <div class="flex flex-col gap-4">
    <p style="color: var(--color-text-primary)">
      Are you sure you want to delete "<strong>{listTitle}</strong>"? 
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
  
  <div class="flex flex-col gap-4">
    <p class="text-sm text-caption">
      Select a recipe to use as your cookbook cover
    </p>
    
    {#if events.length === 0}
      <p class="text-caption text-center py-8">
        No recipes in this collection yet. Add recipes to choose a cover image.
      </p>
    {:else}
      <div class="grid grid-cols-3 gap-3 max-h-96 overflow-y-auto p-1">
        {#each events as recipeEvent}
          {@const recipeATag = `${recipeEvent.kind}:${recipeEvent.pubkey}:${recipeEvent.replaceableDTag()}`}
          {@const recipeImage = recipeEvent.tags.find(t => t[0] === 'image')?.[1]}
          {@const recipeTitle = recipeEvent.tags.find(t => t[0] === 'title')?.[1] || 'Untitled'}
          {@const isSelected = selectedCoverRecipeATag === recipeATag}
          
          <button
            type="button"
            on:click|stopPropagation={() => selectCoverRecipe(recipeEvent)}
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
</Modal>

{#if !loaded}
  <div class="flex justify-center items-center page-loader">
    <PanLoader />
  </div>
{:else if event}
  <div class="flex flex-col gap-6">
    <!-- Header with cover image -->
    {#if listImage}
      <div class="relative h-48 sm:h-64 -mx-4 sm:-mx-6 lg:-mx-8 -mt-4 sm:-mt-6 rounded-b-3xl overflow-hidden">
        <img 
          src={listImage + (coverImage ? '?t=' + Date.now() : '')} 
          alt={listTitle}
          class="w-full h-full object-cover"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"></div>
        
        <!-- Back button overlay -->
        <a 
          href="/cookbook" 
          class="absolute top-4 left-4 w-10 h-10 flex items-center justify-center rounded-full bg-black/30 hover:bg-black/50 text-white transition-colors"
        >
          <ArrowLeftIcon size={20} weight="bold" />
        </a>
        
        <!-- Title overlay -->
        <div class="absolute bottom-4 left-4 right-4">
          <div class="flex items-end justify-between gap-4">
            <div>
              <div class="flex items-center gap-2 mb-1">
                {#if isDefaultList()}
                  <div class="flex items-center gap-1.5 px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded-full">
                    <PinIcon size={14} weight="fill" class="text-white" />
                    <span class="text-xs text-white font-medium">Quick Saves</span>
                  </div>
                {/if}
              </div>
              <h1 class="text-2xl sm:text-3xl font-bold text-white">{listTitle}</h1>
              <p class="text-white/80 text-sm mt-1">
                {offlineMode ? cachedRecipeCount : events.length} {(offlineMode ? cachedRecipeCount : events.length) === 1 ? 'recipe' : 'recipes'}
              </p>
            </div>
          </div>
        </div>
      </div>
    {:else}
      <!-- Simple header without image -->
      <div class="flex items-center gap-4">
        <a 
          href="/cookbook" 
          class="w-10 h-10 flex items-center justify-center rounded-full transition-colors hover:bg-accent-gray"
          style="background-color: var(--color-input-bg);"
        >
          <ArrowLeftIcon size={20} />
        </a>
        <div class="flex-1">
          <div class="flex items-center gap-2">
            {#if isDefaultList()}
              <div class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30">
                <PinIcon size={14} weight="fill" class="text-orange-600 dark:text-orange-400" />
                <span class="text-xs font-medium text-orange-700 dark:text-orange-300">Quick Saves</span>
              </div>
            {/if}
            <h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">{listTitle}</h1>
          </div>
          <p class="text-caption text-sm">
            {offlineMode ? cachedRecipeCount : events.length} {(offlineMode ? cachedRecipeCount : events.length) === 1 ? 'recipe' : 'recipes'}
          </p>
        </div>
      </div>
    {/if}

    <!-- Summary -->
    {#if listSummary}
      <p class="text-caption leading-relaxed {listImage ? '' : '-mt-2'}">{listSummary}</p>
    {/if}

    <!-- Action buttons (hidden when offline since they require network) -->
    {#if isOwner && !offlineMode}
      <div class="flex flex-wrap gap-2 {listImage ? '-mt-2' : ''}">
        {#if events.length > 0}
          <button
            on:click={openChangeCoverModal}
            class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors"
            style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
          >
            <ImageIcon size={16} />
            Change Cover
          </button>
        {/if}
        <button
          on:click={openEditModal}
          class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors"
          style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
        >
          <PencilSimpleIcon size={16} />
          Edit Details
        </button>
        <button
          on:click={openManageModal}
          class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors"
          style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
        >
          <BookmarkIcon size={16} />
          Manage Recipes
        </button>
        <button
          on:click={shareList}
          class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors"
          style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
        >
          <ShareIcon size={16} />
          Share
        </button>
        {#if !isDefaultList()}
          <button
            on:click={openDeleteConfirm}
            class="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
            style="border: 1px solid currentColor;"
          >
            <TrashIcon size={16} />
            Delete
          </button>
        {/if}
      </div>
    {/if}

    <!-- Recipes Feed -->
    {#if offlineMode}
      <!-- Offline Mode - Show cached cookbook info but can't load recipes -->
      <div class="flex flex-col items-center justify-center py-12 px-4">
        <div class="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
          <CloudSlashIcon size={32} class="text-amber-600 dark:text-amber-400" />
        </div>
        <h3 class="text-lg font-medium mb-2" style="color: var(--color-text-primary)">
          You're offline
        </h3>
        <p class="text-caption text-center max-w-sm mb-4">
          This cookbook has {cachedRecipeCount} {cachedRecipeCount === 1 ? 'recipe' : 'recipes'} saved, 
          but recipe details require an internet connection to view.
        </p>
        <p class="text-caption text-center text-sm">
          Connect to the internet to see your recipes.
        </p>
      </div>
    {:else if events.length > 0}
      <Feed {events} {loaded} />
    {:else}
      <div class="flex flex-col items-center justify-center py-12 px-4">
        <div class="w-16 h-16 rounded-full bg-gradient-to-br from-orange-100 to-amber-100 dark:from-orange-900/30 dark:to-amber-900/30 flex items-center justify-center mb-4">
          <BookmarkIcon size={32} weight="regular" class="text-orange-500" />
        </div>
        <h3 class="text-lg font-medium mb-2" style="color: var(--color-text-primary)">
          No recipes yet
        </h3>
        <p class="text-caption text-center max-w-sm mb-4">
          {#if isOwner}
            Start adding recipes to this collection by tapping the save button on any recipe.
          {:else}
            This collection doesn't have any recipes yet.
          {/if}
        </p>
        <a
          href="/recent"
          class="flex items-center px-4 py-2 rounded-full font-medium text-sm transition-colors"
          style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
        >
          Browse Recipes
        </a>
      </div>
    {/if}
  </div>
{:else}
  <div class="flex flex-col items-center justify-center py-16 px-4">
    {#if offlineMode && !$isOnline}
      <div class="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
        <CloudSlashIcon size={32} class="text-amber-600 dark:text-amber-400" />
      </div>
      <h2 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary)">
        Collection Not Cached
      </h2>
      <p class="text-caption text-center max-w-md mb-4">
        This collection isn't available offline. Connect to the internet to view it.
      </p>
    {:else}
      <h2 class="text-xl font-semibold mb-2" style="color: var(--color-text-primary)">
        Collection Not Found
      </h2>
      <p class="text-caption text-center max-w-md mb-4">
        This collection may have been deleted or the link is invalid.
      </p>
    {/if}
    <a
      href="/cookbook"
      class="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-full font-medium transition-all"
    >
      <ArrowLeftIcon size={18} />
      Back to Cookbook
    </a>
  </div>
{/if}

