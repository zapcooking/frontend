/**
 * Cookbook Store - Unified management for recipe collections
 * 
 * Uses NIP-51 kind 30001 for all lists. The default "Saved" list uses
 * the identifier 'nostrcooking-bookmarks' for backward compatibility.
 * 
 * OFFLINE-FIRST: Reads from IndexedDB first, then syncs with Nostr.
 * Changes are persisted locally and queued for sync when offline.
 */

import { writable, derived, get } from 'svelte/store';
import { ndk, userPublickey, ensureNdkConnected } from '$lib/nostr';
import { NDKEvent, type NDKFilter, type NDKSubscription } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { RECIPE_TAGS, RECIPE_TAG_PREFIX_NEW } from '$lib/consts';
import { offlineStorage, type SyncOperation, type OfflineCookbook, type SerializedCookbookData } from '$lib/offlineStorage';
import { isCurrentlyOnline, onConnect } from '$lib/connectionMonitor';

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
  pendingSync?: boolean; // True if has local changes not yet synced to Nostr
}

export interface CookbookState {
  lists: CookbookList[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
  syncStatus: 'synced' | 'syncing' | 'pending' | 'offline';
  pendingOperations: number;
}

// Create the store
function createCookbookStore() {
  const { subscribe, set, update } = writable<CookbookState>({
    lists: [],
    loading: false,
    initialized: false,
    error: null,
    syncStatus: 'synced',
    pendingOperations: 0
  });

  let subscription: NDKSubscription | null = null;
  let syncUnsubscribe: (() => void) | null = null;

  // Timestamp of the last refreshFromNostr that reached EOSE (0 = never this
  // session). "The store has no default list" only confirms absence on relays
  // after a completed refresh — before that it usually means "not fetched
  // yet" (docs/ndk-readiness-discovery.md §4b).
  let refreshCompletedAt = 0;
  // Single-flight guard: concurrent refresh calls share one subscription —
  // a second subscribe would stop the first sub and strand its awaiter.
  let inflightRefresh: Promise<void> | null = null;

  // If relays never EOSE (dead pool, filter routed nowhere), resolve anyway so
  // an awaited refresh can't hang the UI. Does NOT count as a completed
  // refresh — absence stays unconfirmed.
  const REFRESH_EOSE_TIMEOUT_MS = 10000;

  // Register for auto-sync when connection is restored
  if (typeof window !== 'undefined') {
    syncUnsubscribe = onConnect(() => {
      console.log('[CookbookStore] Connection restored, triggering sync');
      syncPendingChanges();
    });
  }

  /**
   * Process pending sync operations
   */
  async function syncPendingChanges(): Promise<void> {
    const pubkey = get(userPublickey);
    const ndkInstance = get(ndk);
    
    if (!pubkey || !ndkInstance || !isCurrentlyOnline()) {
      return;
    }

    update(s => ({ ...s, syncStatus: 'syncing' }));

    const operations = await offlineStorage.getPendingOperations();
    console.log(`[CookbookStore] Processing ${operations.length} pending operations`);

    for (const op of operations) {
      try {
        await executeSyncOperation(op, ndkInstance, pubkey);
        await offlineStorage.removeOperation(op.id);
        
        // Mark cookbook as synced
        await offlineStorage.markCookbookSynced(op.listId, pubkey);
        
        // Update pending count
        update(s => ({ 
          ...s, 
          pendingOperations: Math.max(0, s.pendingOperations - 1),
          lists: s.lists.map(l => 
            l.id === op.listId ? { ...l, pendingSync: false } : l
          )
        }));
      } catch (error) {
        console.error(`[CookbookStore] Failed to sync operation ${op.id}:`, error);
        await offlineStorage.updateOperationRetry(op.id, String(error));
        
        // Stop if too many retries
        if (op.retryCount >= 9) {
          console.warn(`[CookbookStore] Operation ${op.id} exceeded max retries, removing`);
          await offlineStorage.removeOperation(op.id);
        }
      }
    }

    // Clear failed operations
    await offlineStorage.clearFailedOperations();

    // Update final sync status
    const remaining = await offlineStorage.getPendingOperations();
    update(s => ({ 
      ...s, 
      syncStatus: remaining.length > 0 ? 'pending' : 'synced',
      pendingOperations: remaining.length
    }));
  }

  /**
   * Execute a single sync operation against Nostr
   */
  async function executeSyncOperation(
    op: SyncOperation,
    ndkInstance: any,
    pubkey: string
  ): Promise<void> {
    const state = get({ subscribe });
    const list = state.lists.find(l => l.id === op.listId);
    
    switch (op.type) {
      case 'create_list': {
        const event = new NDKEvent(ndkInstance);
        event.kind = 30001;
        event.tags = [
          ['d', op.payload.identifier],
          ['title', op.payload.title],
          ['t', RECIPE_TAG_PREFIX_NEW]
        ];
        if (op.payload.summary) event.tags.push(['summary', op.payload.summary]);
        if (op.payload.image) event.tags.push(['image', op.payload.image]);
        
        const { addClientTagToEvent } = await import('$lib/nip89');
        addClientTagToEvent(event);
        await event.publish();
        break;
      }
      
      case 'add_recipe': {
        if (!list) throw new Error('List not found');
        const event = rebuildListEvent(list, ndkInstance);
        const { addClientTagToEvent } = await import('$lib/nip89');
        addClientTagToEvent(event);
        await event.publish();
        break;
      }
      
      case 'remove_recipe': {
        if (!list) throw new Error('List not found');
        const event = rebuildListEvent(list, ndkInstance);
        const { addClientTagToEvent } = await import('$lib/nip89');
        addClientTagToEvent(event);
        await event.publish();
        break;
      }
      
      case 'update_list': {
        if (!list) throw new Error('List not found');
        const event = rebuildListEvent(list, ndkInstance);
        const { addClientTagToEvent } = await import('$lib/nip89');
        addClientTagToEvent(event);
        await event.publish();
        break;
      }
      
      case 'set_cover': {
        if (!list) throw new Error('List not found');
        const event = rebuildListEvent(list, ndkInstance);
        const { addClientTagToEvent } = await import('$lib/nip89');
        addClientTagToEvent(event);
        await event.publish();
        break;
      }
      
      case 'delete_list': {
        const deleteEvent = new NDKEvent(ndkInstance);
        deleteEvent.kind = 5;
        deleteEvent.tags = [
          ['e', op.payload.eventId],
          ['a', `30001:${pubkey}:${op.listId}`]
        ];
        await deleteEvent.publish();
        break;
      }
    }
  }

  /**
   * Rebuild a list event from current state
   */
  function rebuildListEvent(list: CookbookList, ndkInstance: any): NDKEvent {
    const event = new NDKEvent(ndkInstance);
    event.kind = 30001;
    event.tags = [['d', list.id]];
    
    event.tags.push(['title', list.title]);
    if (list.summary) event.tags.push(['summary', list.summary]);
    if (list.image) event.tags.push(['image', list.image]);
    if (!list.isDefault) event.tags.push(['t', RECIPE_TAG_PREFIX_NEW]);
    if (list.coverRecipeId) event.tags.push(['cover', list.coverRecipeId]);
    
    list.recipes.forEach(r => event.tags.push(['a', r]));
    
    return event;
  }

  /**
   * Deserialize cookbook data from IndexedDB back to CookbookList
   */
  function deserializeCookbook(offline: OfflineCookbook, ndkInstance: any): CookbookList {
    const data = offline.data;
    
    // Rebuild the NDKEvent from serialized data
    const event = new NDKEvent(ndkInstance);
    event.kind = 30001;
    event.tags = data.eventTags || [];
    event.pubkey = data.eventPubkey;
    event.created_at = data.eventCreatedAt;
    if (data.eventId) {
      event.id = data.eventId;
    }
    
    return {
      id: data.id,
      naddr: data.naddr,
      title: data.title,
      summary: data.summary,
      image: data.image,
      coverRecipeId: data.coverRecipeId,
      recipeCount: data.recipeCount,
      recipes: data.recipes,
      createdAt: data.createdAt,
      isDefault: data.isDefault,
      event,
      pendingSync: offline.pendingChanges
    };
  }

  /**
   * Save to local storage and optionally queue for sync
   */
  async function persistLocally(
    list: CookbookList, 
    pubkey: string, 
    synced: boolean = false
  ): Promise<void> {
    await offlineStorage.saveCookbook(list, pubkey, synced);
    
    if (!synced) {
      update(s => ({ 
        ...s, 
        syncStatus: 'pending',
        lists: s.lists.map(l => 
          l.id === list.id ? { ...l, pendingSync: true } : l
        )
      }));
    }
  }

  /**
   * Fetch cookbook lists from relays and reconcile into the store.
   * Only call via refreshFromNostr() (single-flight wrapper).
   */
  async function doRefreshFromNostr(): Promise<void> {
    const pubkey = get(userPublickey);
    const ndkInstance = get(ndk);

    if (!pubkey || !ndkInstance) return;

    // Wait for relay readiness before subscribing. Without this, a
    // cold-session subscribe races the connecting pool, EOSEs early against
    // the connected subset, and caches an empty list set
    // (docs/ndk-readiness-discovery.md §4a).
    try {
      await ensureNdkConnected();
    } catch {
      // ensureNdkConnected resolves rather than rejects by construction;
      // tolerate anyway and let the fetch (+ timeout below) decide.
    }

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

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      // Now that load() can await this promise, an EOSE that never arrives
      // must not hang callers. Timing out does NOT mark the refresh
      // completed — absence stays unconfirmed for ensureDefaultList.
      const eoseTimeout = setTimeout(() => {
        console.warn('[CookbookStore] Refresh timed out waiting for EOSE, keeping current lists');
        update(s => ({ ...s, loading: false, initialized: true }));
        finish();
      }, REFRESH_EOSE_TIMEOUT_MS);

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

      subscription.on('eose', async () => {
        clearTimeout(eoseTimeout);

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

        // Merge with local pending changes
        const currentState = get({ subscribe });
        const mergedLists = uniqueLists.map(remoteList => {
          const localList = currentState.lists.find(l => l.id === remoteList.id);
          if (localList?.pendingSync) {
            // Keep local version if it has pending changes
            return localList;
          }
          return remoteList;
        });

        // Add any local-only lists (created offline)
        currentState.lists.forEach(localList => {
          if (localList.pendingSync && !mergedLists.find(l => l.id === localList.id)) {
            mergedLists.push(localList);
          }
        });

        // Save all to offline storage
        for (const list of mergedLists) {
          await offlineStorage.saveCookbook(list, pubkey, !list.pendingSync);
        }

        // Re-sort after merge
        mergedLists.sort((a, b) => {
          if (a.isDefault) return -1;
          if (b.isDefault) return 1;
          return b.createdAt - a.createdAt;
        });

        const pendingOps = await offlineStorage.getPendingOperations();

        set({
          lists: mergedLists,
          loading: false,
          initialized: true,
          error: null,
          syncStatus: pendingOps.length > 0 ? 'pending' : 'synced',
          pendingOperations: pendingOps.length
        });

        // A refresh that reached EOSE is the only signal that "no default
        // list in the store" means "no default list on relays".
        refreshCompletedAt = Date.now();

        // Process any pending sync operations
        if (pendingOps.length > 0) {
          syncPendingChanges();
        }

        finish();
      });
    });
  }

  return {
    subscribe,
    update, // Expose update method for direct state updates
    set,    // Expose set method for direct state updates
    
    /**
     * Load all cookbook lists for the current user
     * OFFLINE-FIRST: Loads from IndexedDB first, then refreshes from Nostr
     */
    async load(): Promise<void> {
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!pubkey || !ndkInstance) {
        update(s => ({ ...s, error: 'Not logged in', loading: false }));
        return;
      }

      update(s => ({ ...s, loading: true, error: null }));

      // STEP 1: Load from IndexedDB first (instant)
      let hasOfflineData = false;
      try {
        const offlineCookbooks = await offlineStorage.getAllCookbooks(pubkey);

        if (offlineCookbooks.length > 0) {
          hasOfflineData = true;
          console.log(`[CookbookStore] Loaded ${offlineCookbooks.length} cookbooks from offline storage`);
          
          // Deserialize the cookbooks (rebuild NDKEvent objects)
          const lists = offlineCookbooks.map(oc => deserializeCookbook(oc, ndkInstance));
          
          // Sort: default list first, then by most recent
          lists.sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;
            return b.createdAt - a.createdAt;
          });

          const pendingOps = await offlineStorage.getPendingOperations();
          
          update(s => ({
            ...s,
            lists,
            loading: false,
            initialized: true,
            syncStatus: pendingOps.length > 0 ? 'pending' : 'synced',
            pendingOperations: pendingOps.length
          }));
        }
      } catch (error) {
        console.warn('[CookbookStore] Failed to load from offline storage:', error);
      }

      // STEP 2: If online, refresh from Nostr
      if (isCurrentlyOnline()) {
        if (hasOfflineData) {
          // Warm cache already rendered — reconcile in the background
          // (the EOSE handler's set() updates subscribers when it lands).
          this.refreshFromNostr();
        } else {
          // Cold cache: nothing rendered yet. Await the refresh so consumers
          // never observe initialized:true with an empty, never-fetched list
          // set — that's the My Kitchen "Start Your Kitchen" flash
          // (docs/ndk-readiness-discovery.md §4a).
          await this.refreshFromNostr();
        }
      } else {
        update(s => ({ ...s, syncStatus: 'offline', loading: false, initialized: true }));
      }
    },

    /**
     * Refresh cookbook data from Nostr relays.
     * Single-flight: concurrent calls await the same in-flight refresh.
     */
    async refreshFromNostr(): Promise<void> {
      if (inflightRefresh) return inflightRefresh;
      const refresh = doRefreshFromNostr().finally(() => {
        if (inflightRefresh === refresh) inflightRefresh = null;
      });
      inflightRefresh = refresh;
      return refresh;
    },

    /**
     * Create a new cookbook list
     */
    async createList(title: string, summary?: string, image?: string): Promise<string | null> {
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!pubkey || !ndkInstance) return null;

      const identifier = title.toLowerCase().replaceAll(' ', '-').replaceAll(/[^a-z0-9-]/g, '');
      
      const naddr = nip19.naddrEncode({
        identifier,
        kind: 30001,
        pubkey
      });

      // Create local event placeholder
      const event = new NDKEvent(ndkInstance);
      event.kind = 30001;
      event.tags = [
        ['d', identifier],
        ['title', title],
        ['t', RECIPE_TAG_PREFIX_NEW]
      ];
      if (summary) event.tags.push(['summary', summary]);
      if (image) event.tags.push(['image', image]);

      const newList: CookbookList = {
        id: identifier,
        naddr,
        title,
        summary,
        image,
        recipeCount: 0,
        recipes: [],
        createdAt: Math.floor(Date.now() / 1000),
        isDefault: false,
        event,
        pendingSync: !isCurrentlyOnline()
      };

      // Add to local state immediately
      update(s => ({
        ...s,
        lists: [newList, ...s.lists]
      }));

      // Persist locally
      await persistLocally(newList, pubkey, false);

      if (isCurrentlyOnline()) {
        try {
          const { addClientTagToEvent } = await import('$lib/nip89');
          addClientTagToEvent(event);
          await event.publish();
          
          // Mark as synced
          await offlineStorage.markCookbookSynced(identifier, pubkey);
          update(s => ({
            ...s,
            lists: s.lists.map(l => 
              l.id === identifier ? { ...l, pendingSync: false } : l
            )
          }));
        } catch (error) {
          console.error('[CookbookStore] Failed to publish new list:', error);
          // Queue for later sync
          await offlineStorage.queueOperation('create_list', identifier, {
            identifier, title, summary, image
          });
          update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
        }
      } else {
        // Queue for sync when online
        await offlineStorage.queueOperation('create_list', identifier, {
          identifier, title, summary, image
        });
        update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
      }

      return naddr;
    },

    /**
     * Ensure the default "Saved" list exists.
     *
     * The default list is a kind-30001 replaceable event with a fixed d tag,
     * so creating it when one already exists on relays SUPERSEDES the user's
     * real Saved list (docs/ndk-readiness-discovery.md §4b). Creation is
     * therefore only allowed after a refresh that reached EOSE has confirmed
     * absence — never from a store that simply hasn't fetched yet, and never
     * on navigator.onLine alone. Returns null when absence can't be
     * confirmed (offline, relays unreachable); callers already tolerate null.
     */
    async ensureDefaultList(): Promise<CookbookList | null> {
      const findDefault = () => get({ subscribe }).lists.find(l => l.isDefault);

      // A default already in the store (fetched or restored from IndexedDB)
      // is safe to return — the dangerous direction is concluding ABSENCE.
      const existingDefault = findDefault();
      if (existingDefault) return existingDefault;

      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);

      if (!pubkey || !ndkInstance) return null;

      // Absence is only meaningful after a completed refresh. Run one if we
      // don't have one yet (awaits relay readiness internally; single-flight
      // with any refresh already started by load()).
      if (refreshCompletedAt === 0) {
        await this.refreshFromNostr();
        const fetchedDefault = findDefault();
        if (fetchedDefault) return fetchedDefault;
      }

      if (refreshCompletedAt === 0) {
        // The refresh could not reach EOSE (offline / dead pool): the user's
        // Saved list may exist on relays we never heard from. Do not create —
        // a d-tag collision must be impossible by construction.
        console.warn('[CookbookStore] Skipping default list creation: relay refresh has not confirmed absence');
        return null;
      }

      const naddr = nip19.naddrEncode({
        identifier: DEFAULT_LIST_ID,
        kind: 30001,
        pubkey
      });

      const event = new NDKEvent(ndkInstance);
      event.kind = 30001;
      event.tags = [
        ['d', DEFAULT_LIST_ID],
        ['title', DEFAULT_LIST_TITLE]
      ];

      const newList: CookbookList = {
        id: DEFAULT_LIST_ID,
        naddr,
        title: DEFAULT_LIST_TITLE,
        image: undefined,
        recipeCount: 0,
        recipes: [],
        createdAt: Math.floor(Date.now() / 1000),
        isDefault: true,
        event,
        pendingSync: true
      };

      // Check again before updating (race condition protection)
      update(s => {
        if (s.lists.some(l => l.id === DEFAULT_LIST_ID)) {
          return s;
        }
        return {
          ...s,
          lists: [newList, ...s.lists]
        };
      });

      // Persist locally
      await persistLocally(newList, pubkey, false);

      try {
        await event.publish();
        await offlineStorage.markCookbookSynced(DEFAULT_LIST_ID, pubkey);
        update(s => ({
          ...s,
          lists: s.lists.map(l =>
            l.id === DEFAULT_LIST_ID ? { ...l, pendingSync: false } : l
          )
        }));
      } catch (error) {
        console.error('[CookbookStore] Failed to publish default list:', error);
        await offlineStorage.queueOperation('create_list', DEFAULT_LIST_ID, {
          identifier: DEFAULT_LIST_ID, title: DEFAULT_LIST_TITLE
        });
      }

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

      // Update local state immediately (optimistic update)
      const isFirstRecipe = list.recipes.length === 0;
      const updatedList: CookbookList = {
        ...list,
        recipes: [...list.recipes, aTag],
        recipeCount: list.recipeCount + 1,
        coverRecipeId: isFirstRecipe && !list.coverRecipeId ? aTag : list.coverRecipeId,
        pendingSync: true
      };

      update(s => ({
        ...s,
        lists: s.lists.map(l => l.id === listId ? updatedList : l)
      }));

      // Persist locally
      await persistLocally(updatedList, pubkey, false);

      if (isCurrentlyOnline()) {
        try {
          // Create updated event
          const event = new NDKEvent(ndkInstance);
          event.kind = 30001;
          
          const tagsToKeep = ['d', 'title', 'summary', 'image', 't', 'cover'];
          list.event.tags.forEach(tag => {
            if (tagsToKeep.includes(tag[0])) {
              event.tags.push([...tag]);
            }
          });
          
          if (isFirstRecipe && !list.coverRecipeId) {
            event.tags.push(['cover', aTag]);
          } else if (list.coverRecipeId) {
            event.tags.push(['cover', list.coverRecipeId]);
          }
          
          list.recipes.forEach(r => event.tags.push(['a', r]));
          event.tags.push(['a', aTag]);

          const { addClientTagToEvent } = await import('$lib/nip89');
          addClientTagToEvent(event);
          await event.publish();

          // Update with synced event
          update(s => ({
            ...s,
            lists: s.lists.map(l => 
              l.id === listId ? { ...updatedList, event, pendingSync: false } : l
            )
          }));
          await offlineStorage.markCookbookSynced(listId, pubkey);
        } catch (error) {
          console.error('[CookbookStore] Failed to publish add recipe:', error);
          await offlineStorage.queueOperation('add_recipe', listId, { aTag });
          update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
        }
      } else {
        await offlineStorage.queueOperation('add_recipe', listId, { aTag });
        update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
      }

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

      const remainingRecipes = list.recipes.filter(r => r !== recipeATag);
      const wasCover = list.coverRecipeId === recipeATag;
      
      const updatedList: CookbookList = {
        ...list,
        recipes: remainingRecipes,
        recipeCount: Math.max(0, list.recipeCount - 1),
        coverRecipeId: wasCover && remainingRecipes.length > 0 
          ? remainingRecipes[0] 
          : wasCover ? undefined : list.coverRecipeId,
        pendingSync: true
      };

      // Update local state immediately
      update(s => ({
        ...s,
        lists: s.lists.map(l => l.id === listId ? updatedList : l)
      }));

      // Persist locally
      await persistLocally(updatedList, pubkey, false);

      if (isCurrentlyOnline()) {
        try {
          const event = new NDKEvent(ndkInstance);
          event.kind = 30001;
          
          const tagsToKeep = ['d', 'title', 'summary', 'image', 't'];
          list.event.tags.forEach(tag => {
            if (tagsToKeep.includes(tag[0])) {
              event.tags.push([...tag]);
            }
          });
          
          if (wasCover && remainingRecipes.length > 0) {
            event.tags.push(['cover', remainingRecipes[0]]);
          } else if (list.coverRecipeId && !wasCover) {
            event.tags.push(['cover', list.coverRecipeId]);
          }
          
          remainingRecipes.forEach(r => event.tags.push(['a', r]));

          const { addClientTagToEvent } = await import('$lib/nip89');
          addClientTagToEvent(event);
          await event.publish();

          update(s => ({
            ...s,
            lists: s.lists.map(l => 
              l.id === listId ? { ...updatedList, event, pendingSync: false } : l
            )
          }));
          await offlineStorage.markCookbookSynced(listId, pubkey);
        } catch (error) {
          console.error('[CookbookStore] Failed to publish remove recipe:', error);
          await offlineStorage.queueOperation('remove_recipe', listId, { recipeATag });
          update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
        }
      } else {
        await offlineStorage.queueOperation('remove_recipe', listId, { recipeATag });
        update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
      }

      return true;
    },

    /**
     * Bulk add many recipes to a list with a single Nostr publish.
     *
     * Returns counts so callers can show "Added X, skipped Y already saved".
     * Skips a-tags already present in the list. Persists locally first
     * so partial failures still leave the cookbook in a usable state.
     */
    async bulkAddRecipesToList(
      listId: string,
      recipeEvents: NDKEvent[]
    ): Promise<{ added: number; skipped: number; failed: number }> {
      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);

      if (!list || !pubkey || !ndkInstance) {
        return { added: 0, skipped: 0, failed: recipeEvents.length };
      }

      const existing = new Set(list.recipes);
      const toAdd: string[] = [];
      let skipped = 0;
      for (const ev of recipeEvents) {
        if (!ev) continue;
        const dTag = ev.replaceableDTag?.() || ev.tags?.find(t => t[0] === 'd')?.[1] || '';
        if (!dTag || !ev.kind || !ev.pubkey) continue;
        const aTag = `${ev.kind}:${ev.pubkey}:${dTag}`;
        if (existing.has(aTag)) { skipped++; continue; }
        if (toAdd.includes(aTag)) { skipped++; continue; }
        toAdd.push(aTag);
      }

      if (toAdd.length === 0) {
        return { added: 0, skipped, failed: 0 };
      }

      const mergedRecipes = [...list.recipes, ...toAdd];
      const isFirstBatch = list.recipes.length === 0;
      const updatedList: CookbookList = {
        ...list,
        recipes: mergedRecipes,
        recipeCount: mergedRecipes.length,
        coverRecipeId: isFirstBatch && !list.coverRecipeId ? toAdd[0] : list.coverRecipeId,
        pendingSync: true
      };

      update(s => ({
        ...s,
        lists: s.lists.map(l => (l.id === listId ? updatedList : l))
      }));

      await persistLocally(updatedList, pubkey, false);

      if (isCurrentlyOnline()) {
        try {
          const event = new NDKEvent(ndkInstance);
          event.kind = 30001;

          const tagsToKeep = ['d', 'title', 'summary', 'image', 't'];
          list.event.tags.forEach(tag => {
            if (tagsToKeep.includes(tag[0])) {
              event.tags.push([...tag]);
            }
          });

          // Preserve cover (or seed it from first added recipe)
          const coverId = updatedList.coverRecipeId;
          if (coverId) event.tags.push(['cover', coverId]);

          mergedRecipes.forEach(r => event.tags.push(['a', r]));

          const { addClientTagToEvent } = await import('$lib/nip89');
          addClientTagToEvent(event);
          await event.publish();

          update(s => ({
            ...s,
            lists: s.lists.map(l =>
              l.id === listId ? { ...updatedList, event, pendingSync: false } : l
            )
          }));
          await offlineStorage.markCookbookSynced(listId, pubkey);
        } catch (error) {
          console.error('[CookbookStore] bulkAddRecipesToList publish failed:', error);
          // Queue each as a separate add_recipe op so retry logic stays simple.
          for (const aTag of toAdd) {
            await offlineStorage.queueOperation('add_recipe', listId, { aTag });
          }
          update(s => ({
            ...s,
            syncStatus: 'pending',
            pendingOperations: s.pendingOperations + toAdd.length
          }));
        }
      } else {
        for (const aTag of toAdd) {
          await offlineStorage.queueOperation('add_recipe', listId, { aTag });
        }
        update(s => ({
          ...s,
          syncStatus: 'pending',
          pendingOperations: s.pendingOperations + toAdd.length
        }));
      }

      return { added: toAdd.length, skipped, failed: 0 };
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

      if (!list.recipes.includes(recipeATag)) {
        throw new Error('Recipe not found in this collection');
      }

      const updatedList: CookbookList = {
        ...list,
        coverRecipeId: recipeATag,
        pendingSync: true
      };

      // Update local state immediately
      update(s => ({
        ...s,
        lists: s.lists.map(l => l.id === listId ? updatedList : l)
      }));

      // Persist locally
      await persistLocally(updatedList, pubkey, false);

      if (isCurrentlyOnline()) {
        try {
          if (!ndkInstance.signer) {
            throw new Error('Not authenticated. Please sign in again.');
          }

          const event = new NDKEvent(ndkInstance);
          event.kind = 30001;
          
          const metaTags = ['d', 'title', 'summary', 'image', 't'];
          list.event.tags.forEach(tag => {
            if (metaTags.includes(tag[0])) {
              event.tags.push([...tag]);
            }
          });
          
          event.tags.push(['cover', recipeATag]);
          list.recipes.forEach(r => event.tags.push(['a', r]));

          const { addClientTagToEvent } = await import('$lib/nip89');
          addClientTagToEvent(event);

          if (!event.sig) await event.sign();

          const publishPromise = event.publish();
          const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Publish timeout after 10 seconds')), 10000)
          );
          
          await Promise.race([publishPromise, timeoutPromise]);

          update(s => ({
            ...s,
            lists: s.lists.map(l => 
              l.id === listId ? { ...updatedList, event, pendingSync: false } : l
            )
          }));
          await offlineStorage.markCookbookSynced(listId, pubkey);
        } catch (error: any) {
          console.error('[CookbookStore] Failed to publish cover change:', error);
          await offlineStorage.queueOperation('set_cover', listId, { recipeATag });
          update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
          
          if (!error?.message?.includes('timeout')) {
            throw error;
          }
        }
      } else {
        await offlineStorage.queueOperation('set_cover', listId, { recipeATag });
        update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
      }

      return true;
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
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!list || !pubkey || !ndkInstance) return false;

      const updatedList: CookbookList = {
        ...list,
        title: updates.title || list.title,
        summary: updates.summary !== undefined ? updates.summary : list.summary,
        image: updates.image !== undefined ? updates.image : list.image,
        pendingSync: true
      };

      // Update local state immediately
      update(s => ({
        ...s,
        lists: s.lists.map(l => l.id === listId ? updatedList : l)
      }));

      // Persist locally
      await persistLocally(updatedList, pubkey, false);

      if (isCurrentlyOnline()) {
        try {
          const event = new NDKEvent(ndkInstance);
          event.kind = 30001;
          event.tags = [['d', listId]];
          
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
          
          if (!list.isDefault) event.tags.push(['t', RECIPE_TAG_PREFIX_NEW]);
          if (list.coverRecipeId) event.tags.push(['cover', list.coverRecipeId]);
          
          list.recipes.forEach(r => event.tags.push(['a', r]));

          const { addClientTagToEvent } = await import('$lib/nip89');
          addClientTagToEvent(event);
          await event.publish();

          update(s => ({
            ...s,
            lists: s.lists.map(l => 
              l.id === listId ? { ...updatedList, event, pendingSync: false } : l
            )
          }));
          await offlineStorage.markCookbookSynced(listId, pubkey);
        } catch (error) {
          console.error('[CookbookStore] Failed to publish list update:', error);
          await offlineStorage.queueOperation('update_list', listId, updates);
          update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
        }
      } else {
        await offlineStorage.queueOperation('update_list', listId, updates);
        update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
      }

      return true;
    },

    /**
     * Delete a list (not the default one)
     */
    async deleteList(listId: string): Promise<boolean> {
      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!list || list.isDefault || !pubkey || !ndkInstance) return false;

      // Remove from local state immediately
      update(s => ({
        ...s,
        lists: s.lists.filter(l => l.id !== listId)
      }));

      // Remove from offline storage
      await offlineStorage.deleteCookbook(listId, pubkey);
      // Clean up any queued sync operations related to this cookbook
      await offlineStorage.deleteCookbookOperations(listId, pubkey);

      if (isCurrentlyOnline()) {
        try {
          const deleteEvent = new NDKEvent(ndkInstance);
          deleteEvent.kind = 5;
          deleteEvent.tags = [
            ['e', list.event.id],
            ['a', `30001:${list.event.pubkey}:${listId}`]
          ];
          await deleteEvent.publish();
        } catch (error) {
          console.error('[CookbookStore] Failed to publish delete:', error);
          await offlineStorage.queueOperation('delete_list', listId, { eventId: list.event.id });
          update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
        }
      } else {
        await offlineStorage.queueOperation('delete_list', listId, { eventId: list.event.id });
        update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
      }

      return true;
    },

    /**
     * Manually trigger sync of pending changes
     */
    async syncNow(): Promise<void> {
      if (!isCurrentlyOnline()) {
        console.log('[CookbookStore] Cannot sync - offline');
        return;
      }
      await syncPendingChanges();
    },

    /**
     * Get sync status information
     */
    async getSyncStatus(): Promise<{ pending: number; failed: number }> {
      return offlineStorage.getQueueStatus();
    },

    /**
     * Reset store state
     */
    reset() {
      if (subscription) {
        subscription.stop();
        subscription = null;
      }
      // A reset store has no relay knowledge: absence must be re-confirmed
      // before ensureDefaultList may create again.
      refreshCompletedAt = 0;
      inflightRefresh = null;
      set({
        lists: [],
        loading: false,
        initialized: false,
        error: null,
        syncStatus: 'synced',
        pendingOperations: 0
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
  const coverRecipeId = event.tags.find(t => t[0] === 'cover')?.[1];
  const recipes = event.tags.filter(t => t[0] === 'a').map(t => t[1]);
  const isDefault = dTag === DEFAULT_LIST_ID;
  
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
    coverRecipeId,
    recipeCount: recipes.length,
    recipes,
    createdAt: event.created_at || 0,
    isDefault,
    event,
    pendingSync: false
  };
}

/**
 * Helper function to get the actual cover image URL from a cookbook list
 */
export async function getCookbookCoverImage(
  list: CookbookList,
  ndkInstance: any,
  forceRefresh: boolean = false
): Promise<string | undefined> {
  if (list.coverRecipeId) {
    const parts = list.coverRecipeId.split(':');
    if (parts.length === 3) {
      const [kind, pubkey, identifier] = parts;
      try {
        const recipeEvent = await ndkInstance.fetchEvent({
          kinds: [Number(kind)],
          '#d': [identifier],
          authors: [pubkey]
        }, { groupable: false });
        
        if (recipeEvent) {
          const image = recipeEvent.tags.find((t: string[]) => t[0] === 'image')?.[1];
          if (image) {
            return forceRefresh ? `${image}?t=${Date.now()}` : image;
          }
        }
      } catch (error) {
        console.warn('Failed to fetch cover recipe:', error);
      }
    }
  }
  
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
          const image = recipeEvent.tags.find((t: string[]) => t[0] === 'image')?.[1];
          if (image) {
            return forceRefresh ? `${image}?t=${Date.now()}` : image;
          }
        }
      } catch (error) {
        console.warn('Failed to fetch first recipe:', error);
      }
    }
  }
  
  if (list.image) {
    return forceRefresh ? `${list.image}?t=${Date.now()}` : list.image;
  }
  
  return undefined;
}

// Export singleton store
export const cookbookStore = createCookbookStore();

// Derived stores for convenience
export const cookbookLists = derived(cookbookStore, $store => $store.lists);
export const cookbookLoading = derived(cookbookStore, $store => $store.loading);
export const cookbookSyncStatus = derived(cookbookStore, $store => $store.syncStatus);
export const cookbookPendingOps = derived(cookbookStore, $store => $store.pendingOperations);
export const defaultCookbookList = derived(cookbookStore, $store => 
  $store.lists.find(l => l.isDefault)
);
