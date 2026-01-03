/**
 * Cookbook Store - Unified management for recipe collections
 * 
 * Uses NIP-51 kind 30001 for all lists. The default "Saved" list uses
 * the identifier 'nostrcooking-bookmarks' for backward compatibility.
 */

import { writable, derived, get } from 'svelte/store';
import { ndk, userPublickey } from '$lib/nostr';
import { NDKEvent, type NDKFilter, type NDKSubscription } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { RECIPE_TAGS, RECIPE_TAG_PREFIX_NEW } from '$lib/consts';

// Default list identifier (backward compatible with existing bookmarks)
export const DEFAULT_LIST_ID = 'nostrcooking-bookmarks';
export const DEFAULT_LIST_TITLE = 'Saved';

export interface CookbookList {
  id: string;           // The 'd' tag value
  naddr: string;        // Encoded address for routing
  title: string;
  summary?: string;
  image?: string;        // Legacy cover image URL (for backward compatibility)
  coverRecipeId?: string; // NEW: Reference to recipe to use as cover (a-tag format)
  recipeCount: number;
  recipes: string[];    // Array of 'a' tag values (kind:pubkey:identifier)
  createdAt: number;
  isDefault: boolean;
  event: NDKEvent;      // Original NDK event for updates
}

export interface CookbookState {
  lists: CookbookList[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
}

// Create the store
function createCookbookStore() {
  const { subscribe, set, update } = writable<CookbookState>({
    lists: [],
    loading: false,
    initialized: false,
    error: null
  });

  let subscription: NDKSubscription | null = null;

  return {
    subscribe,
    update, // Expose update method for direct state updates
    set,    // Expose set method for direct state updates
    
    /**
     * Load all cookbook lists for the current user
     */
    async load(): Promise<void> {
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!pubkey || !ndkInstance) {
        update(s => ({ ...s, error: 'Not logged in', loading: false }));
        return;
      }

      update(s => ({ ...s, loading: true, error: null }));

      // Clean up existing subscription
      if (subscription) {
        subscription.stop();
        subscription = null;
      }

      const lists: CookbookList[] = [];
      const seenIds = new Set<string>();

      // Fetch all kind 30001 lists: recipe lists + bookmarks
      const filters: NDKFilter[] = [
        {
          authors: [pubkey],
          kinds: [30001],
          '#t': RECIPE_TAGS,
          limit: 256
        },
        {
          authors: [pubkey],
          kinds: [30001],
          '#d': [DEFAULT_LIST_ID],
          limit: 1
        }
      ];

      // Return a promise that resolves when loading completes
      return new Promise((resolve) => {
        subscription = ndkInstance.subscribe(filters, { closeOnEose: true });

        subscription.on('event', (event: NDKEvent) => {
          const dTag = event.tags.find(t => t[0] === 'd')?.[1];
          if (!dTag || seenIds.has(dTag)) return;
          seenIds.add(dTag);

          const list = eventToList(event, pubkey);
          if (list) {
            lists.push(list);
          }
        });

        subscription.on('eose', () => {
          // Final deduplication by id (in case of race conditions)
          const uniqueLists = lists.filter((list, index, self) => 
            index === self.findIndex(l => l.id === list.id)
          );

          // Sort: default list first, then by most recent
          uniqueLists.sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;
            return b.createdAt - a.createdAt;
          });

          set({
            lists: uniqueLists,
            loading: false,
            initialized: true,
            error: null
          });

          resolve();
        });
      });
    },

    /**
     * Create a new cookbook list
     */
    async createList(title: string, summary?: string, image?: string): Promise<string | null> {
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!pubkey || !ndkInstance) return null;

      const identifier = title.toLowerCase().replaceAll(' ', '-').replaceAll(/[^a-z0-9-]/g, '');
      
      const event = new NDKEvent(ndkInstance);
      event.kind = 30001;
      event.tags = [
        ['d', identifier],
        ['title', title],
        ['t', RECIPE_TAG_PREFIX_NEW]
      ];
      
      if (summary) {
        event.tags.push(['summary', summary]);
      }
      if (image) {
        event.tags.push(['image', image]);
      }

      // Add NIP-89 client tag
      const { addClientTagToEvent } = await import('$lib/nip89');
      addClientTagToEvent(event);

      await event.publish();

      const naddr = nip19.naddrEncode({
        identifier,
        kind: 30001,
        pubkey
      });

      // Add to local state
      update(s => ({
        ...s,
        lists: [{
          id: identifier,
          naddr,
          title,
          summary,
          image,
          recipeCount: 0,
          recipes: [],
          createdAt: Math.floor(Date.now() / 1000),
          isDefault: false,
          event
        }, ...s.lists]
      }));

      return naddr;
    },

    /**
     * Ensure the default "Saved" list exists
     */
    async ensureDefaultList(): Promise<CookbookList | null> {
      // Check if default already exists
      const state = get({ subscribe });
      const existingDefault = state.lists.find(l => l.isDefault);
      
      if (existingDefault) return existingDefault;

      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!pubkey || !ndkInstance) return null;

      const event = new NDKEvent(ndkInstance);
      event.kind = 30001;
      event.tags = [
        ['d', DEFAULT_LIST_ID],
        ['title', DEFAULT_LIST_TITLE]
      ];

      await event.publish();

      const naddr = nip19.naddrEncode({
        identifier: DEFAULT_LIST_ID,
        kind: 30001,
        pubkey
      });

      const newList: CookbookList = {
        id: DEFAULT_LIST_ID,
        naddr,
        title: DEFAULT_LIST_TITLE,
        image: undefined, // No default image - will use recipe images
        recipeCount: 0,
        recipes: [],
        createdAt: Math.floor(Date.now() / 1000),
        isDefault: true,
        event
      };

      // Check again before updating (race condition protection)
      update(s => {
        // If default was added while we were creating, don't add duplicate
        if (s.lists.some(l => l.id === DEFAULT_LIST_ID)) {
          return s;
        }
        return {
          ...s,
          lists: [newList, ...s.lists]
        };
      });

      // Return the list (either newly created or existing)
      const finalState = get({ subscribe });
      return finalState.lists.find(l => l.isDefault) || newList;
    },

    /**
     * Add a recipe to a list (quick save to default, or specific list)
     */
    async addRecipeToList(
      listId: string,
      recipeEvent: NDKEvent
    ): Promise<boolean> {
      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!list || !pubkey || !ndkInstance) return false;

      const aTag = `${recipeEvent.kind}:${recipeEvent.pubkey}:${recipeEvent.replaceableDTag()}`;
      
      // Check if already in list
      if (list.recipes.includes(aTag)) return true;

      // Create updated event
      const event = new NDKEvent(ndkInstance);
      event.kind = 30001;
      
      // Copy existing tags (d, title, summary, image, t, cover)
      const tagsToKeep = ['d', 'title', 'summary', 'image', 't', 'cover'];
      list.event.tags.forEach(tag => {
        if (tagsToKeep.includes(tag[0])) {
          event.tags.push([...tag]);
        }
      });
      
      // Auto-set cover to first recipe if none set
      const isFirstRecipe = list.recipes.length === 0;
      if (isFirstRecipe && !list.coverRecipeId) {
        event.tags.push(['cover', aTag]);
      } else if (list.coverRecipeId) {
        // Preserve existing cover selection
        event.tags.push(['cover', list.coverRecipeId]);
      }
      
      // Add existing recipes
      list.recipes.forEach(r => {
        event.tags.push(['a', r]);
      });
      
      // Add new recipe
      event.tags.push(['a', aTag]);

      // Add NIP-89 client tag
      const { addClientTagToEvent } = await import('$lib/nip89');
      addClientTagToEvent(event);

      await event.publish();

      // Update local state
      update(s => ({
        ...s,
        lists: s.lists.map(l => {
          if (l.id === listId) {
            const isFirstRecipe = l.recipes.length === 0;
            return {
              ...l,
              recipes: [...l.recipes, aTag],
              recipeCount: l.recipeCount + 1,
              coverRecipeId: isFirstRecipe && !l.coverRecipeId ? aTag : l.coverRecipeId,
              event
            };
          }
          return l;
        })
      }));

      return true;
    },

    /**
     * Remove a recipe from a list
     */
    async removeRecipeFromList(
      listId: string,
      recipeATag: string
    ): Promise<boolean> {
      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!list || !pubkey || !ndkInstance) return false;

      const event = new NDKEvent(ndkInstance);
      event.kind = 30001;
      
      // Copy non-recipe tags
      const tagsToKeep = ['d', 'title', 'summary', 'image', 't'];
      list.event.tags.forEach(tag => {
        if (tagsToKeep.includes(tag[0])) {
          event.tags.push([...tag]);
        }
      });
      
      // Handle cover recipe removal - if removed recipe was cover, use first remaining recipe
      const remainingRecipes = list.recipes.filter(r => r !== recipeATag);
      const wasCover = list.coverRecipeId === recipeATag;
      
      if (wasCover && remainingRecipes.length > 0) {
        // Set cover to first remaining recipe
        event.tags.push(['cover', remainingRecipes[0]]);
      } else if (list.coverRecipeId && !wasCover) {
        // Preserve existing cover if it's not being removed
        event.tags.push(['cover', list.coverRecipeId]);
      }
      
      // Add recipes except the one being removed
      remainingRecipes.forEach(r => {
        event.tags.push(['a', r]);
      });

      const { addClientTagToEvent } = await import('$lib/nip89');
      addClientTagToEvent(event);

      await event.publish();

      // Update local state
      update(s => ({
        ...s,
        lists: s.lists.map(l => {
          if (l.id === listId) {
            const remainingRecipes = l.recipes.filter(r => r !== recipeATag);
            const wasCover = l.coverRecipeId === recipeATag;
            return {
              ...l,
              recipes: remainingRecipes,
              recipeCount: Math.max(0, l.recipeCount - 1),
              coverRecipeId: wasCover && remainingRecipes.length > 0 
                ? remainingRecipes[0] 
                : wasCover 
                  ? undefined 
                  : l.coverRecipeId,
              event
            };
          }
          return l;
        })
      }));

      return true;
    },

    /**
     * Quick save to default list (one-tap bookmark)
     */
    async quickSave(recipeEvent: NDKEvent): Promise<boolean> {
      let defaultList: CookbookList | null | undefined = get({ subscribe }).lists.find(l => l.isDefault);
      
      if (!defaultList) {
        defaultList = await this.ensureDefaultList();
      }
      
      if (!defaultList) return false;
      
      return this.addRecipeToList(defaultList.id, recipeEvent);
    },

    /**
     * Check if a recipe is saved in any list
     */
    isRecipeSaved(recipeEvent: NDKEvent): boolean {
      const state = get({ subscribe });
      const aTag = `${recipeEvent.kind}:${recipeEvent.pubkey}:${recipeEvent.replaceableDTag()}`;
      
      return state.lists.some(list => list.recipes.includes(aTag));
    },

    /**
     * Get lists containing a specific recipe
     */
    getListsContainingRecipe(recipeEvent: NDKEvent): CookbookList[] {
      const state = get({ subscribe });
      const aTag = `${recipeEvent.kind}:${recipeEvent.pubkey}:${recipeEvent.replaceableDTag()}`;
      
      return state.lists.filter(list => list.recipes.includes(aTag));
    },

    /**
     * Set which recipe's image to use as cookbook cover
     */
    async setCoverRecipe(
      listId: string,
      recipeATag: string
    ): Promise<boolean> {
      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!list || !pubkey || !ndkInstance) {
        throw new Error('List not found or not logged in');
      }

      // Verify recipe is actually in the list
      if (!list.recipes.includes(recipeATag)) {
        throw new Error('Recipe not found in this collection');
      }

      try {
        // Ensure we have a signer
        if (!ndkInstance.signer) {
          throw new Error('Not authenticated. Please sign in again.');
        }

        const event = new NDKEvent(ndkInstance);
        event.kind = 30001;
        
        // Copy metadata tags (excluding old cover tag)
        const metaTags = ['d', 'title', 'summary', 'image', 't'];
        list.event.tags.forEach(tag => {
          if (metaTags.includes(tag[0])) {
            event.tags.push([...tag]);
          }
        });
        
        // Add cover tag pointing to recipe
        event.tags.push(['cover', recipeATag]);
        
        // Add all recipe references
        list.recipes.forEach(r => {
          event.tags.push(['a', r]);
        });

        const { addClientTagToEvent } = await import('$lib/nip89');
        addClientTagToEvent(event);

        // Ensure event is signed before publishing
        if (!event.sig) {
          await event.sign();
        }

        // Publish with timeout to prevent hanging
        const publishPromise = event.publish();
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Publish timeout after 10 seconds')), 10000)
        );
        
        let publishedRelays: Set<any>;
        try {
          publishedRelays = await Promise.race([publishPromise, timeoutPromise]);
        } catch (publishError: any) {
          console.error('Publish error:', publishError);
          // If it's a timeout, we still want to update local state optimistically
          if (publishError?.message?.includes('timeout')) {
            console.warn('Publish timed out, but updating local state optimistically');
            // Update local state optimistically even if publish timed out
            update(s => ({
              ...s,
              lists: s.lists.map(l => 
                l.id === listId 
                  ? { ...l, coverRecipeId: recipeATag, event }
                  : l
              )
            }));
            // Return true since we updated locally, even though publish may have failed
            return true;
          }
          throw publishError;
        }
        
        // Check if publish was successful (at least one relay confirmed)
        if (publishedRelays.size === 0) {
          console.warn('No relays confirmed publish, but updating local state optimistically');
          // Update local state optimistically even if no relays confirmed
          update(s => ({
            ...s,
            lists: s.lists.map(l => 
              l.id === listId 
                ? { ...l, coverRecipeId: recipeATag, event }
                : l
            )
          }));
          // Return true since we updated locally
          return true;
        }

        // Ensure the event object has the updated cover tag in its tags
        // Remove any old cover tags and add the new one
        event.tags = event.tags.filter(t => t[0] !== 'cover');
        event.tags.push(['cover', recipeATag]);

        // Update local state with the properly updated event
        update(s => ({
          ...s,
          lists: s.lists.map(l => {
            if (l.id === listId) {
              // Create a new event object with updated tags to ensure persistence
              const updatedEvent = new NDKEvent(ndkInstance);
              updatedEvent.kind = 30001;
              updatedEvent.tags = [...event.tags]; // Copy all tags including the new cover tag
              updatedEvent.created_at = event.created_at;
              updatedEvent.pubkey = event.pubkey;
              updatedEvent.sig = event.sig;
              updatedEvent.id = event.id;
              updatedEvent.author = event.author;
              
              return { 
                ...l, 
                coverRecipeId: recipeATag, 
                event: updatedEvent 
              };
            }
            return l;
          })
        }));

        return true;
      } catch (error: any) {
        console.error('Error setting cover recipe:', error);
        // Provide more specific error messages
        if (error?.message) {
          throw error;
        } else if (error?.toString) {
          throw new Error(error.toString());
        } else {
          throw new Error('Failed to update cover image. Please try again.');
        }
      }
    },

    /**
     * Update list metadata (title, summary, image)
     */
    async updateList(
      listId: string, 
      updates: { title?: string; summary?: string; image?: string }
    ): Promise<boolean> {
      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const ndkInstance = get(ndk);
      
      if (!list || !ndkInstance) return false;

      const event = new NDKEvent(ndkInstance);
      event.kind = 30001;
      event.tags = [['d', listId]];
      
      // Add updated or existing metadata
      event.tags.push(['title', updates.title || list.title]);
      
      if (updates.summary !== undefined) {
        if (updates.summary) event.tags.push(['summary', updates.summary]);
      } else if (list.summary) {
        event.tags.push(['summary', list.summary]);
      }
      
      if (updates.image !== undefined) {
        if (updates.image) event.tags.push(['image', updates.image]);
      } else if (list.image) {
        event.tags.push(['image', list.image]);
      }
      
      // Keep recipe tag for non-default lists
      if (!list.isDefault) {
        event.tags.push(['t', RECIPE_TAG_PREFIX_NEW]);
      }
      
      // Preserve cover recipe if set
      if (list.coverRecipeId) {
        event.tags.push(['cover', list.coverRecipeId]);
      }
      
      // Add all recipes
      list.recipes.forEach(r => {
        event.tags.push(['a', r]);
      });

      const { addClientTagToEvent } = await import('$lib/nip89');
      addClientTagToEvent(event);

      await event.publish();

      // Update local state
      update(s => ({
        ...s,
        lists: s.lists.map(l => 
          l.id === listId 
            ? { 
                ...l, 
                title: updates.title || l.title,
                summary: updates.summary !== undefined ? updates.summary : l.summary,
                image: updates.image !== undefined ? updates.image : l.image,
                event 
              }
            : l
        )
      }));

      return true;
    },

    /**
     * Delete a list (not the default one)
     */
    async deleteList(listId: string): Promise<boolean> {
      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const ndkInstance = get(ndk);
      
      if (!list || list.isDefault || !ndkInstance) return false;

      // Publish deletion event (NIP-09)
      const deleteEvent = new NDKEvent(ndkInstance);
      deleteEvent.kind = 5;
      deleteEvent.tags = [
        ['e', list.event.id],
        ['a', `30001:${list.event.pubkey}:${listId}`]
      ];

      await deleteEvent.publish();

      // Remove from local state
      update(s => ({
        ...s,
        lists: s.lists.filter(l => l.id !== listId)
      }));

      return true;
    },

    /**
     * Reset store state
     */
    reset() {
      if (subscription) {
        subscription.stop();
        subscription = null;
      }
      set({
        lists: [],
        loading: false,
        initialized: false,
        error: null
      });
    }
  };
}

/**
 * Convert an NDKEvent to a CookbookList
 */
function eventToList(event: NDKEvent, userPubkey: string): CookbookList | null {
  const dTag = event.tags.find(t => t[0] === 'd')?.[1];
  if (!dTag) return null;

  const title = event.tags.find(t => t[0] === 'title')?.[1] || dTag;
  const summary = event.tags.find(t => t[0] === 'summary')?.[1];
  const imageTag = event.tags.find(t => t[0] === 'image')?.[1];
  const coverRecipeId = event.tags.find(t => t[0] === 'cover')?.[1]; // NEW: cover recipe reference
  const recipes = event.tags.filter(t => t[0] === 'a').map(t => t[1]);
  const isDefault = dTag === DEFAULT_LIST_ID;
  
  // Use image tag if present, otherwise undefined (will use recipe images)
  const image = imageTag;

  const naddr = nip19.naddrEncode({
    identifier: dTag,
    kind: 30001,
    pubkey: userPubkey
  });

  return {
    id: dTag,
    naddr,
    title: isDefault ? DEFAULT_LIST_TITLE : title,
    summary,
    image,
    coverRecipeId, // NEW
    recipeCount: recipes.length,
    recipes,
    createdAt: event.created_at || 0,
    isDefault,
    event
  };
}

/**
 * Helper function to get the actual cover image URL from a cookbook list
 * Priority: coverRecipeId > first recipe > legacy image > default image
 */
export async function getCookbookCoverImage(
  list: CookbookList,
  ndkInstance: any,
  forceRefresh: boolean = false
): Promise<string | undefined> {
  // Priority 1: Explicit cover recipe selection
  if (list.coverRecipeId) {
    const parts = list.coverRecipeId.split(':');
    if (parts.length === 3) {
      const [kind, pubkey, identifier] = parts;
      try {
        // Force refresh by adding a cache-busting parameter or using a fresh fetch
        const recipeEvent = await ndkInstance.fetchEvent({
          kinds: [Number(kind)],
          '#d': [identifier],
          authors: [pubkey]
        }, { groupable: false }); // Disable caching if possible
        
        if (recipeEvent) {
          const image = recipeEvent.tags.find(t => t[0] === 'image')?.[1];
          if (image) {
            // Add cache-busting parameter if force refresh
            return forceRefresh ? `${image}?t=${Date.now()}` : image;
          }
        }
      } catch (error) {
        console.warn('Failed to fetch cover recipe:', error);
      }
    }
  }
  
  // Priority 2: First recipe's image
  if (list.recipes.length > 0) {
    const firstRecipeATag = list.recipes[0];
    const parts = firstRecipeATag.split(':');
    if (parts.length === 3) {
      const [kind, pubkey, identifier] = parts;
      try {
        const recipeEvent = await ndkInstance.fetchEvent({
          kinds: [Number(kind)],
          '#d': [identifier],
          authors: [pubkey]
        });
        if (recipeEvent) {
          const image = recipeEvent.tags.find(t => t[0] === 'image')?.[1];
          if (image) {
            return forceRefresh ? `${image}?t=${Date.now()}` : image;
          }
        }
      } catch (error) {
        console.warn('Failed to fetch first recipe:', error);
      }
    }
  }
  
  // Priority 3: Legacy cover image URL
  if (list.image) {
    return forceRefresh ? `${list.image}?t=${Date.now()}` : list.image;
  }
  
  // No default image - return undefined (will show gradient placeholder)
  return undefined;
}

// Export singleton store
export const cookbookStore = createCookbookStore();

// Derived stores for convenience
export const cookbookLists = derived(cookbookStore, $store => $store.lists);
export const cookbookLoading = derived(cookbookStore, $store => $store.loading);
export const defaultCookbookList = derived(cookbookStore, $store => 
  $store.lists.find(l => l.isDefault)
);

