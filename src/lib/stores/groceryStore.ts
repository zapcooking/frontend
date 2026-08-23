/**
 * Grocery Store - Svelte store for managing grocery lists
 * 
 * Provides reactive access to encrypted grocery lists stored on Nostr.
 * Uses NIP-78 (kind 30078) for storage and NIP-44 for encryption.
 * 
 * Features:
 * - Load lists on initialization
 * - Reactive access to all lists
 * - CRUD operations for lists and items
 * - Debounced saves to prevent excessive publishing
 * - Auto-clear on logout
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { userPublickey } from '$lib/nostr';
import {
  fetchGroceryLists,
  saveGroceryList,
  deleteGroceryLists,
  createEmptyList,
  createGroceryItem,
  type GroceryList,
  type GroceryItem,
  type GroceryCategory,
  type PantryCoveredItem
} from '$lib/services/groceryService';
import { canonicalizeGroceryCategory, GROCERY_CATEGORIES, type GroceryAisle } from '$lib/grocery/categories';
import { groceryConsolidationKey } from '$lib/grocery/consolidation';
import {
  applySnapshotToList,
  dropStaleSourcesFromList,
  mergeRequirementsIntoList,
  movePantryCoveredToList,
  removeGroceryItemFromList,
  returnOverrideToPantry,
  type GrocerySnapshot,
  type GroceryRequirement,
  type SnapshotList
} from '$lib/grocery/requirements';
import { registerMealPlanGrocerySync } from '$lib/grocery/hooks';
import { weekDisplayRange } from '$lib/mealplan/week';
import type { MealPlan } from '$lib/mealplan/schema';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface GroceryStoreState {
  lists: GroceryList[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
  saving: boolean;
  lastSaved: number | null;
}

function toSnapshot(list: GroceryList): SnapshotList {
  return {
    ...list,
    pantryCovered: list.pantryCovered?.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      normalizedName: item.normalizedName || groceryConsolidationKey(item.name),
      category: canonicalizeGroceryCategory(item.category, item.name),
      unit: item.unit,
      sources: item.sources || (item.recipeId
        ? [{
            recipeId: item.recipeId,
            occurrenceId: `recipe:${item.recipeId}`,
            quantity: item.quantity,
            originalName: item.name
          }]
        : [])
    }))
  };
}

function fromSnapshot(snapshot: SnapshotList, previous: GroceryList): GroceryList {
  return {
    ...previous,
    ...snapshot,
    items: snapshot.items as GroceryItem[],
    recipeLinks: snapshot.recipeLinks,
    pantryCovered: snapshot.pantryCovered,
    pantryOverrides: snapshot.pantryOverrides,
    sourceWeekId: snapshot.sourceWeekId,
    stats: snapshot.stats,
    unresolvedRecipes: snapshot.unresolvedRecipes,
    updatedAt: snapshot.updatedAt
  };
}

// ═══════════════════════════════════════════════════════════════
// STORE CREATION
// ═══════════════════════════════════════════════════════════════

function createGroceryStore() {
  const { subscribe, set, update } = writable<GroceryStoreState>({
    lists: [],
    loading: false,
    initialized: false,
    error: null,
    saving: false,
    lastSaved: null
  });

  // Debounce timers for saves (keyed by list ID)
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  
  // Pending saves queue (for lists being saved)
  const pendingSaves = new Set<string>();

  // Debounce delay in milliseconds
  const SAVE_DEBOUNCE_MS = 2000;

  // Track if we're subscribed to pubkey changes
  let pubkeyUnsubscribe: (() => void) | null = null;

  /**
   * Schedule a debounced save for a list
   */
  function scheduleSave(listId: string): void {
    // Clear existing timer for this list
    const existingTimer = saveTimers.get(listId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new save
    const timer = setTimeout(async () => {
      saveTimers.delete(listId);
      await performSave(listId);
    }, SAVE_DEBOUNCE_MS);

    saveTimers.set(listId, timer);
  }

  /**
   * Actually perform the save to Nostr
   */
  async function performSave(listId: string): Promise<void> {
    // Don't save if already saving this list
    if (pendingSaves.has(listId)) {
      return;
    }

    pendingSaves.add(listId);
    update(s => ({ ...s, saving: true }));

    try {
      // Get latest version of the list from store
      const currentState = get({ subscribe });
      const currentList = currentState.lists.find(l => l.id === listId);
      
      if (currentList) {
        await saveGroceryList(currentList);
        update(s => ({ 
          ...s, 
          lastSaved: Date.now(),
          error: null
        }));
        console.log('[GroceryStore] List saved:', listId);
      }
    } catch (error) {
      console.error('[GroceryStore] Failed to save list:', error);
      update(s => ({ 
        ...s, 
        error: error instanceof Error ? error.message : 'Failed to save list'
      }));
    } finally {
      pendingSaves.delete(listId);
      
      // Only set saving to false if no more pending saves
      if (pendingSaves.size === 0) {
        update(s => ({ ...s, saving: false }));
      }
    }
  }

  /**
   * Flush all pending saves immediately
   */
  async function flushPendingSaves(): Promise<void> {
    const currentState = get({ subscribe });
    
    // Clear all timers and save immediately
    for (const [listId, timer] of saveTimers) {
      clearTimeout(timer);
      saveTimers.delete(listId);
      
      const list = currentState.lists.find(l => l.id === listId);
      if (list) {
        await performSave(listId);
      }
    }
  }

  /**
   * Clear all save timers
   */
  function clearAllTimers(): void {
    for (const timer of saveTimers.values()) {
      clearTimeout(timer);
    }
    saveTimers.clear();
  }

  return {
    subscribe,

    /**
     * Load all grocery lists from Nostr
     */
    async load(): Promise<void> {
      if (!browser) return;

      const pubkey = get(userPublickey);
      if (!pubkey) {
        update(s => ({ 
          ...s, 
          lists: [],
          initialized: true,
          error: 'Not logged in'
        }));
        return;
      }

      update(s => ({ ...s, loading: true, error: null }));

      try {
        const listEvents = await fetchGroceryLists();
        const lists = listEvents.map(le => le.list);

        update(s => ({
          ...s,
          lists,
          loading: false,
          initialized: true,
          error: null
        }));

        console.log(`[GroceryStore] Loaded ${lists.length} grocery lists`);
      } catch (error) {
        console.error('[GroceryStore] Failed to load lists:', error);
        update(s => ({
          ...s,
          loading: false,
          initialized: true,
          error: error instanceof Error ? error.message : 'Failed to load lists'
        }));
      }
    },

    /**
     * Refresh lists from Nostr
     */
    async refresh(): Promise<void> {
      return this.load();
    },

    /**
     * Add a new grocery list
     */
    async addList(title: string = 'New List'): Promise<GroceryList> {
      const newList = createEmptyList(title);

      // Add to local state immediately
      update(s => ({
        ...s,
        lists: [newList, ...s.lists],
        error: null
      }));

      // Save to Nostr (immediately, no debounce for new lists)
      try {
        await saveGroceryList(newList);
        update(s => ({ ...s, lastSaved: Date.now() }));
      } catch (error) {
        console.error('[GroceryStore] Failed to save new list:', error);
        update(s => ({ 
          ...s, 
          error: error instanceof Error ? error.message : 'Failed to create grocery list'
        }));
        // Keep in local state even if save fails - will retry on next change
      }

      return newList;
    },

    /**
     * Update a list's metadata (title, notes)
     */
    updateList(
      listId: string, 
      updates: Partial<Pick<GroceryList, 'title' | 'notes' | 'recipeLinks' | 'pantryCovered' | 'pantryOverrides' | 'sourceWeekId' | 'stats' | 'unresolvedRecipes'>>
    ): void {
      update(s => {
        const lists = s.lists.map(list => {
          if (list.id !== listId) return list;
          
          const updatedList: GroceryList = {
            ...list,
            ...updates,
            updatedAt: Math.floor(Date.now() / 1000)
          };
          
          // Schedule debounced save
          scheduleSave(updatedList.id);
          
          return updatedList;
        });

        return { ...s, lists };
      });
    },

    /**
     * Delete one or more grocery lists
     */
    async deleteLists(listIds: string[]): Promise<boolean> {
      const uniqueIds = [...new Set(listIds.filter(Boolean))];
      if (uniqueIds.length === 0) return true;

      for (const listId of uniqueIds) {
        const timer = saveTimers.get(listId);
        if (timer) {
          clearTimeout(timer);
          saveTimers.delete(listId);
        }
      }

      const idSet = new Set(uniqueIds);
      update(s => ({
        ...s,
        lists: s.lists.filter(l => !idSet.has(l.id))
      }));

      try {
        await deleteGroceryLists(uniqueIds);
        return true;
      } catch (error) {
        console.error('[GroceryStore] Failed to delete lists:', error);
        this.load();
        return false;
      }
    },

    /**
     * Delete a grocery list
     */
    async deleteList(listId: string): Promise<boolean> {
      return this.deleteLists([listId]);
    },

    /**
     * Add an item to a list
     */
    addItem(
      listId: string,
      name: string,
      quantity: string = '',
      category?: GroceryCategory,
      recipeId?: string
    ): GroceryItem {
      const inferredCategory = canonicalizeGroceryCategory(category, name);
      const newItem = createGroceryItem(name, quantity, inferredCategory, recipeId, {
        origin: recipeId ? 'recipe' : 'manual',
        normalizedName: groceryConsolidationKey(name)
      });

      update(s => {
        const lists = s.lists.map(list => {
          if (list.id !== listId) return list;
          
          const updatedList: GroceryList = {
            ...list,
            items: [...list.items, newItem],
            updatedAt: Math.floor(Date.now() / 1000)
          };
          
          // Schedule debounced save
          scheduleSave(updatedList.id);
          
          return updatedList;
        });

        return { ...s, lists };
      });

      return newItem;
    },

    /**
     * Move a pantry-covered ingredient onto the shopping list.
     * The user decided they don't have enough of it.
     */
    addPantryCoveredToList(listId: string, index: number): GroceryItem | null {
      let added: GroceryItem | null = null;

      update((s) => {
        const lists = s.lists.map((list) => {
          if (list.id !== listId) return list;
          const result = movePantryCoveredToList(toSnapshot(list), index);
          added = result.added as GroceryItem | null;
          if (!added) return list;
          scheduleSave(listId);
          return fromSnapshot(result.list, list);
        });

        return { ...s, lists };
      });

      return added;
    },

    /**
     * Reverse a pantry override: take the item off the shopping list
     * and put it back under Already in My Kitchen.
     */
    returnPantryOverride(listId: string, itemId: string): void {
      update((s) => {
        const lists = s.lists.map((list) => {
          if (list.id !== listId) return list;
          const next = fromSnapshot(returnOverrideToPantry(toSnapshot(list), itemId), list);
          scheduleSave(listId);
          return next;
        });
        return { ...s, lists };
      });
    },

    /**
     * Record recipe ingredients that were skipped because they matched
     * the pantry. Existing pantryCovered rows are kept.
     */
    appendPantryCovered(listId: string, items: PantryCoveredItem[]): void {
      if (!items.length) return;
      update((s) => {
        const lists = s.lists.map((list) => {
          if (list.id !== listId) return list;
          return {
            ...list,
            pantryCovered: [...(list.pantryCovered || []), ...items],
            updatedAt: Math.floor(Date.now() / 1000)
          };
        });
        scheduleSave(listId);
        return { ...s, lists };
      });
    },

    /**
     * Update an item in a list
     */
    updateItem(
      listId: string,
      itemId: string,
      updates: Partial<Omit<GroceryItem, 'id' | 'addedAt'>>
    ): void {
      update(s => {
        const lists = s.lists.map(list => {
          if (list.id !== listId) return list;
          
          const items = list.items.map(item => {
            if (item.id !== itemId) return item;
            return { ...item, ...updates };
          });
          
          const updatedList: GroceryList = {
            ...list,
            items,
            updatedAt: Math.floor(Date.now() / 1000)
          };
          
          // Schedule debounced save
          scheduleSave(updatedList.id);
          
          return updatedList;
        });

        return { ...s, lists };
      });
    },

    /**
     * Toggle an item's checked state
     */
    toggleItem(listId: string, itemId: string): void {
      update(s => {
        const lists = s.lists.map(list => {
          if (list.id !== listId) return list;
          
          const items = list.items.map(item => {
            if (item.id !== itemId) return item;
            return { ...item, checked: !item.checked };
          });
          
          const updatedList: GroceryList = {
            ...list,
            items,
            updatedAt: Math.floor(Date.now() / 1000)
          };
          
          // Schedule debounced save
          scheduleSave(updatedList.id);
          
          return updatedList;
        });

        return { ...s, lists };
      });
    },

    /**
     * Remove an item from a list
     */
    removeItem(listId: string, itemId: string): void {
      update(s => {
        const lists = s.lists.map(list => {
          if (list.id !== listId) return list;
          const next = fromSnapshot(removeGroceryItemFromList(toSnapshot(list), itemId), list);
          scheduleSave(listId);
          return next;
        });

        return { ...s, lists };
      });
    },

    /**
     * Reorder an item within a category
     */
    reorderItem(listId: string, category: GroceryCategory, oldIndex: number, newIndex: number): void {
      if (oldIndex === newIndex) return;

      const aisle = canonicalizeGroceryCategory(category);

      update(s => {
        const lists = s.lists.map(list => {
          if (list.id !== listId) return list;

          const categoryItemIndices: number[] = [];
          list.items.forEach((item, idx) => {
            if (canonicalizeGroceryCategory(item.category, item.name) === aisle) {
              categoryItemIndices.push(idx);
            }
          });

          if (oldIndex < 0 || oldIndex >= categoryItemIndices.length) return list;
          if (newIndex < 0 || newIndex >= categoryItemIndices.length) return list;

          const actualOldIndex = categoryItemIndices[oldIndex];
          const actualNewIndex = categoryItemIndices[newIndex];
          const newItems = [...list.items];
          const [movedItem] = newItems.splice(actualOldIndex, 1);

          const insertAt = actualOldIndex < actualNewIndex ? actualNewIndex - 1 : actualNewIndex;
          newItems.splice(insertAt, 0, movedItem);

          const updatedList: GroceryList = {
            ...list,
            items: newItems,
            updatedAt: Math.floor(Date.now() / 1000)
          };

          scheduleSave(updatedList.id);

          return updatedList;
        });

        return { ...s, lists };
      });
    },

    /**
     * Clear all checked items from a list
     */
    clearCheckedItems(listId: string): void {
      update(s => {
        const lists = s.lists.map(list => {
          if (list.id !== listId) return list;
          
          const updatedList: GroceryList = {
            ...list,
            items: list.items.filter(item => !item.checked),
            updatedAt: Math.floor(Date.now() / 1000)
          };
          
          // Schedule debounced save
          scheduleSave(updatedList.id);
          
          return updatedList;
        });

        return { ...s, lists };
      });
    },

    /**
     * Add a recipe link to a list
     */
    addRecipeLink(listId: string, recipeATag: string): void {
      update(s => {
        const lists = s.lists.map(list => {
          if (list.id !== listId) return list;
          
          // Don't add duplicate links
          if (list.recipeLinks.includes(recipeATag)) {
            return list;
          }
          
          const updatedList: GroceryList = {
            ...list,
            recipeLinks: [...list.recipeLinks, recipeATag],
            updatedAt: Math.floor(Date.now() / 1000)
          };
          
          // Schedule debounced save
          scheduleSave(updatedList.id);
          
          return updatedList;
        });

        return { ...s, lists };
      });
    },

    /**
     * Remove a recipe link from a list
     */
    removeRecipeLink(listId: string, recipeATag: string): void {
      update(s => {
        const lists = s.lists.map(list => {
          if (list.id !== listId) return list;
          
          const updatedList: GroceryList = {
            ...list,
            recipeLinks: list.recipeLinks.filter(link => link !== recipeATag),
            updatedAt: Math.floor(Date.now() / 1000)
          };
          
          // Schedule debounced save
          scheduleSave(updatedList.id);
          
          return updatedList;
        });

        return { ...s, lists };
      });
    },

    /**
     * Replace recipe-derived items from a meal-plan snapshot. Manual
     * items and checked state are preserved. Adding the same week twice
     * updates the existing list instead of doubling quantities.
     */
    applySnapshot(listId: string, snapshot: GrocerySnapshot): void {
      update((s) => {
        const lists = s.lists.map((list) => {
          if (list.id !== listId) return list;
          const next = fromSnapshot(applySnapshotToList(toSnapshot(list), snapshot), list);
          scheduleSave(listId);
          return next;
        });
        return { ...s, lists };
      });
    },

    /**
     * Find the grocery list generated for a meal-plan week, if any.
     */
    findListForWeek(weekId: string): GroceryList | undefined {
      const state = get({ subscribe });
      return (
        state.lists.find((list) => list.sourceWeekId === weekId) ||
        state.lists.find((list) => list.title === `Groceries — ${weekDisplayRange(weekId)}`)
      );
    },

    /**
     * Create or update the grocery list for a planned week.
     */
    async applyOrCreateWeekList(weekId: string, snapshot: GrocerySnapshot): Promise<GroceryList> {
      const existing = this.findListForWeek(weekId);
      if (existing) {
        this.applySnapshot(existing.id, { ...snapshot, sourceWeekId: weekId });
        const updated = get({ subscribe }).lists.find((list) => list.id === existing.id);
        return updated || existing;
      }

      const newList = createEmptyList(`Groceries — ${weekDisplayRange(weekId)}`, { sourceWeekId: weekId });
      const populated = fromSnapshot(
        applySnapshotToList(toSnapshot(newList), { ...snapshot, sourceWeekId: weekId }),
        newList
      );

      update((s) => ({
        ...s,
        lists: [populated, ...s.lists],
        error: null
      }));

      try {
        await saveGroceryList(populated);
        update((s) => ({ ...s, lastSaved: Date.now() }));
      } catch (error) {
        console.error('[GroceryStore] Failed to save week grocery list:', error);
        update((s) => ({
          ...s,
          error: error instanceof Error ? error.message : 'Failed to create grocery list'
        }));
      }

      return populated;
    },

    mergeRequirements(
      listId: string,
      requirements: GroceryRequirement[],
      pantryCovered: GroceryRequirement[] = []
    ): void {
      update((s) => {
        const lists = s.lists.map((list) => {
          if (list.id !== listId) return list;
          const next = fromSnapshot(
            mergeRequirementsIntoList(toSnapshot(list), requirements, pantryCovered),
            list
          );
          scheduleSave(listId);
          return next;
        });
        return { ...s, lists };
      });
    },

    /**
     * Recalculate recipe-derived quantities after the meal plan changes.
     * Manual items are not touched.
     */
    syncMealPlanSources(weekId: string, plan: MealPlan): void {
      update((s) => {
        let changed = false;
        const lists = s.lists.map((list) => {
          if (list.sourceWeekId !== weekId) return list;
          const next = fromSnapshot(dropStaleSourcesFromList(toSnapshot(list), plan), list);
          changed = true;
          scheduleSave(list.id);
          return next;
        });
        return changed ? { ...s, lists } : s;
      });
    },

    /**
     * Force save all pending changes immediately
     */
    async saveNow(): Promise<void> {
      await flushPendingSaves();
    },

    /**
     * Clear the store (call on logout)
     */
    clear(): void {
      clearAllTimers();
      pendingSaves.clear();
      set({
        lists: [],
        loading: false,
        initialized: false,
        error: null,
        saving: false,
        lastSaved: null
      });
    },

    /**
     * Initialize the store and set up pubkey change listener
     */
    init(): void {
      if (!browser) return;

      // Clean up any existing subscription
      if (pubkeyUnsubscribe) {
        pubkeyUnsubscribe();
      }

      // Subscribe to pubkey changes to clear store on logout
      pubkeyUnsubscribe = userPublickey.subscribe(pubkey => {
        if (!pubkey) {
          // User logged out - clear the store
          this.clear();
        }
      });

      registerMealPlanGrocerySync((weekId, plan) => {
        this.syncMealPlanSources(weekId, plan);
      });
    },

    /**
     * Cleanup subscriptions
     */
    destroy(): void {
      clearAllTimers();
      registerMealPlanGrocerySync(null);
      if (pubkeyUnsubscribe) {
        pubkeyUnsubscribe();
        pubkeyUnsubscribe = null;
      }
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════

export const groceryStore = createGroceryStore();

// Initialize on import (browser only)
if (browser) {
  groceryStore.init();
}

// ═══════════════════════════════════════════════════════════════
// DERIVED STORES
// ═══════════════════════════════════════════════════════════════

/**
 * Derived store: just the lists array
 */
export const groceryLists = derived(groceryStore, $store => $store.lists);

/**
 * Derived store: loading state
 */
export const groceryLoading = derived(groceryStore, $store => $store.loading);

/**
 * Derived store: saving state
 */
export const grocerySaving = derived(groceryStore, $store => $store.saving);

/**
 * Derived store: error state
 */
export const groceryError = derived(groceryStore, $store => $store.error);

/**
 * Derived store: initialized state
 */
export const groceryInitialized = derived(groceryStore, $store => $store.initialized);

/**
 * Derived store: total item count across all lists
 */
export const totalGroceryItems = derived(groceryStore, $store => 
  $store.lists.reduce((total, list) => total + list.items.length, 0)
);

/**
 * Derived store: total unchecked items across all lists
 */
export const uncheckedGroceryItems = derived(groceryStore, $store =>
  $store.lists.reduce(
    (total, list) => total + list.items.filter(item => !item.checked).length,
    0
  )
);

/**
 * Get a specific list by ID (reactive)
 */
export function getGroceryList(listId: string) {
  return derived(groceryStore, $store => 
    $store.lists.find(list => list.id === listId) || null
  );
}

/**
 * Get items for a specific list, optionally filtered by category
 */
export function getGroceryItems(listId: string, category?: GroceryCategory) {
  return derived(groceryStore, $store => {
    const list = $store.lists.find(l => l.id === listId);
    if (!list) return [];
    
    if (category) {
      return list.items.filter(item => item.category === category);
    }
    return list.items;
  });
}

/**
 * Get items grouped by category for a specific list
 */
export function getGroceryItemsByCategory(listId: string) {
  return derived(groceryStore, $store => {
    const list = $store.lists.find(l => l.id === listId);
    if (!list) return new Map<GroceryAisle, GroceryItem[]>();
    
    const grouped = new Map<GroceryAisle, GroceryItem[]>();
    
    for (const category of GROCERY_CATEGORIES) {
      const items = list.items.filter(
        (item) => canonicalizeGroceryCategory(item.category, item.name) === category
      );
      if (items.length > 0) {
        grouped.set(category, items);
      }
    }
    
    return grouped;
  });
}

// ═══════════════════════════════════════════════════════════════
// RE-EXPORTS FROM SERVICE
// ═══════════════════════════════════════════════════════════════

export type { GroceryList, GroceryItem, GroceryCategory } from '$lib/services/groceryService';
export { inferCategory, createGroceryItem } from '$lib/services/groceryService';
export { inferGroceryCategory } from '$lib/grocery/categories';
