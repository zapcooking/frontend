/**
 * Offline Storage Service
 * 
 * Provides IndexedDB-based persistence for cookbooks with sync queue support.
 * Enables offline-first experience with automatic background sync to Nostr.
 */

import { browser } from '$app/environment';

// Database configuration
const DB_NAME = 'zapcooking-offline';
const DB_VERSION = 2; // Bumped for recipes store

// Store names
const COOKBOOKS_STORE = 'cookbooks';
const SYNC_QUEUE_STORE = 'syncQueue';
const RECIPES_STORE = 'recipes';

/**
 * Serializable cookbook data (without NDKEvent which has non-cloneable methods)
 */
export interface SerializedCookbookData {
  id: string;
  naddr: string;
  title: string;
  summary?: string;
  image?: string;
  coverRecipeId?: string;
  recipeCount: number;
  recipes: string[];
  createdAt: number;
  isDefault: boolean;
  pendingSync?: boolean;
  // Store event as serializable tags/metadata instead of full NDKEvent
  eventTags: string[][];
  eventPubkey: string;
  eventCreatedAt: number;
  eventId?: string;
}

/**
 * Stored cookbook with sync metadata
 */
export interface OfflineCookbook {
  id: string;              // Cookbook list ID (d-tag value)
  pubkey: string;          // Owner's pubkey
  data: SerializedCookbookData; // Serialized cookbook data (no functions)
  lastSynced: number;      // Timestamp of last successful sync
  pendingChanges: boolean; // Has unsynced local changes
  localVersion: number;    // Local version counter for conflict detection
}

/**
 * Sync operation queued for later execution
 */
export interface SyncOperation {
  id: string;              // Unique operation ID
  type: 'add_recipe' | 'remove_recipe' | 'create_list' | 'update_list' | 'delete_list' | 'set_cover';
  listId: string;          // Target cookbook list ID
  payload: any;            // Operation-specific data
  createdAt: number;       // When operation was created
  retryCount: number;      // Number of sync attempts
  lastError?: string;      // Last error message if failed
}

/**
 * Cached recipe content (text only, no images stored)
 */
export interface CachedRecipe {
  id: string;              // a-tag format: kind:pubkey:d-tag
  title: string;
  summary?: string;
  content: string;         // Full recipe content/instructions
  ingredients: string[];   // Parsed ingredients list
  image?: string;          // Image URL (not cached, loads online)
  prepTime?: string;
  cookTime?: string;
  servings?: string;
  tags: string[];          // Recipe tags/categories
  authorPubkey: string;
  authorName?: string;
  createdAt: number;
  cachedAt: number;        // When this was cached locally
  // Event metadata for reconstruction
  eventKind: number;
  eventDTag: string;
  eventTags: string[][];
}

/**
 * Offline Storage Manager
 * Handles all IndexedDB operations for offline cookbook support
 */
class OfflineStorageManager {
  private db: IDBDatabase | null = null;
  private dbReady: Promise<void>;
  private dbReadyResolve!: () => void;

  constructor() {
    this.dbReady = new Promise((resolve) => {
      this.dbReadyResolve = resolve;
    });

    if (browser) {
      this.initDatabase();
    } else {
      // Resolve immediately on server
      this.dbReadyResolve();
    }
  }

  /**
   * Initialize IndexedDB database
   */
  private async initDatabase(): Promise<void> {
    if (!browser) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[OfflineStorage] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        const storeNames = Array.from(this.db.objectStoreNames);
        console.log('[OfflineStorage] Database initialized, version:', this.db.version, 'stores:', storeNames);
        this.dbReadyResolve();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
        console.log(`[OfflineStorage] Upgrading database from v${oldVersion} to v${DB_VERSION}`);

        // Create cookbooks store
        if (!db.objectStoreNames.contains(COOKBOOKS_STORE)) {
          console.log('[OfflineStorage] Creating cookbooks store');
          const cookbookStore = db.createObjectStore(COOKBOOKS_STORE, { keyPath: 'id' });
          cookbookStore.createIndex('pubkey', 'pubkey', { unique: false });
          cookbookStore.createIndex('lastSynced', 'lastSynced', { unique: false });
          cookbookStore.createIndex('pendingChanges', 'pendingChanges', { unique: false });
        }

        // Create sync queue store
        if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
          console.log('[OfflineStorage] Creating syncQueue store');
          const syncStore = db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: 'id' });
          syncStore.createIndex('createdAt', 'createdAt', { unique: false });
          syncStore.createIndex('listId', 'listId', { unique: false });
          syncStore.createIndex('type', 'type', { unique: false });
        }

        // Create recipes store (added in v2)
        if (!db.objectStoreNames.contains(RECIPES_STORE)) {
          console.log('[OfflineStorage] Creating recipes store');
          const recipesStore = db.createObjectStore(RECIPES_STORE, { keyPath: 'id' });
          recipesStore.createIndex('authorPubkey', 'authorPubkey', { unique: false });
          recipesStore.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
      };
    });
  }

  /**
   * Wait for database to be ready
   */
  async ready(): Promise<void> {
    return this.dbReady;
  }

  // ==================== Cookbook Operations ====================

  /**
   * Serialize a CookbookList for IndexedDB storage (strips non-cloneable data)
   */
  private serializeCookbook(cookbook: any): SerializedCookbookData {
    return {
      id: cookbook.id,
      naddr: cookbook.naddr,
      title: cookbook.title,
      summary: cookbook.summary,
      image: cookbook.image,
      coverRecipeId: cookbook.coverRecipeId,
      recipeCount: cookbook.recipeCount,
      recipes: [...cookbook.recipes],
      createdAt: cookbook.createdAt,
      isDefault: cookbook.isDefault,
      pendingSync: cookbook.pendingSync,
      // Serialize event data (NDKEvent has methods that can't be cloned)
      eventTags: cookbook.event?.tags ? cookbook.event.tags.map((t: string[]) => [...t]) : [],
      eventPubkey: cookbook.event?.pubkey || '',
      eventCreatedAt: cookbook.event?.created_at || cookbook.createdAt,
      eventId: cookbook.event?.id
    };
  }

  /**
   * Save a cookbook to local storage
   * @param cookbook - CookbookList object (will be serialized)
   * @param pubkey - User's public key
   * @param synced - Whether the cookbook is synced with Nostr
   */
  async saveCookbook(cookbook: any, pubkey: string, synced: boolean = true): Promise<void> {
    await this.ready();
    if (!this.db) return;

    const existing = await this.getCookbookRaw(cookbook.id, pubkey);
    
    const serializedData = this.serializeCookbook(cookbook);
    
    const offlineCookbook: OfflineCookbook = {
      id: `${pubkey}:${cookbook.id}`,
      pubkey,
      data: serializedData,
      lastSynced: synced ? Date.now() : (existing?.lastSynced || 0),
      pendingChanges: !synced,
      localVersion: (existing?.localVersion || 0) + 1
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([COOKBOOKS_STORE], 'readwrite');
      const store = transaction.objectStore(COOKBOOKS_STORE);
      const request = store.put(offlineCookbook);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get raw cookbook data from local storage (internal use)
   */
  private async getCookbookRaw(listId: string, pubkey: string): Promise<OfflineCookbook | null> {
    await this.ready();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([COOKBOOKS_STORE], 'readonly');
      const store = transaction.objectStore(COOKBOOKS_STORE);
      const request = store.get(`${pubkey}:${listId}`);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a cookbook from local storage
   */
  async getCookbook(listId: string, pubkey: string): Promise<OfflineCookbook | null> {
    return this.getCookbookRaw(listId, pubkey);
  }

  /**
   * Get all cookbooks for a user
   */
  async getAllCookbooks(pubkey: string): Promise<OfflineCookbook[]> {
    await this.ready();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([COOKBOOKS_STORE], 'readonly');
      const store = transaction.objectStore(COOKBOOKS_STORE);
      const index = store.index('pubkey');
      const request = index.getAll(pubkey);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a cookbook from local storage
   */
  async deleteCookbook(listId: string, pubkey: string): Promise<void> {
    await this.ready();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([COOKBOOKS_STORE], 'readwrite');
      const store = transaction.objectStore(COOKBOOKS_STORE);
      const request = store.delete(`${pubkey}:${listId}`);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Mark a cookbook as synced
   */
  async markCookbookSynced(listId: string, pubkey: string): Promise<void> {
    await this.ready();
    if (!this.db) return;

    const cookbook = await this.getCookbook(listId, pubkey);
    if (!cookbook) return;

    cookbook.lastSynced = Date.now();
    cookbook.pendingChanges = false;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([COOKBOOKS_STORE], 'readwrite');
      const store = transaction.objectStore(COOKBOOKS_STORE);
      const request = store.put(cookbook);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all cookbooks with pending changes
   */
  async getPendingCookbooks(pubkey: string): Promise<OfflineCookbook[]> {
    const all = await this.getAllCookbooks(pubkey);
    return all.filter(c => c.pendingChanges);
  }

  // ==================== Sync Queue Operations ====================

  /**
   * Add an operation to the sync queue
   */
  async queueOperation(
    type: SyncOperation['type'],
    listId: string,
    payload: any
  ): Promise<string> {
    await this.ready();
    if (!this.db) return '';

    const operation: SyncOperation = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      listId,
      payload,
      createdAt: Date.now(),
      retryCount: 0
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SYNC_QUEUE_STORE], 'readwrite');
      const store = transaction.objectStore(SYNC_QUEUE_STORE);
      const request = store.add(operation);

      request.onsuccess = () => resolve(operation.id);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all pending sync operations
   */
  async getPendingOperations(): Promise<SyncOperation[]> {
    await this.ready();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SYNC_QUEUE_STORE], 'readonly');
      const store = transaction.objectStore(SYNC_QUEUE_STORE);
      const index = store.index('createdAt');
      const request = index.getAll();

      request.onsuccess = () => {
        // Sort by createdAt ascending (oldest first)
        const operations = (request.result || []).sort((a, b) => a.createdAt - b.createdAt);
        resolve(operations);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get pending operations for a specific list
   */
  async getOperationsForList(listId: string): Promise<SyncOperation[]> {
    await this.ready();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SYNC_QUEUE_STORE], 'readonly');
      const store = transaction.objectStore(SYNC_QUEUE_STORE);
      const index = store.index('listId');
      const request = index.getAll(listId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Remove an operation from the queue (after successful sync)
   */
  async removeOperation(operationId: string): Promise<void> {
    await this.ready();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SYNC_QUEUE_STORE], 'readwrite');
      const store = transaction.objectStore(SYNC_QUEUE_STORE);
      const request = store.delete(operationId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update operation retry count and error
   */
  async updateOperationRetry(operationId: string, error?: string): Promise<void> {
    await this.ready();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SYNC_QUEUE_STORE], 'readwrite');
      const store = transaction.objectStore(SYNC_QUEUE_STORE);
      const getRequest = store.get(operationId);

      getRequest.onsuccess = () => {
        const operation = getRequest.result;
        if (!operation) {
          resolve();
          return;
        }

        operation.retryCount += 1;
        operation.lastError = error;

        const putRequest = store.put(operation);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Clear all failed operations (retry count > max)
   */
  async clearFailedOperations(maxRetries: number = 10): Promise<number> {
    const operations = await this.getPendingOperations();
    const failed = operations.filter(op => op.retryCount >= maxRetries);
    
    for (const op of failed) {
      await this.removeOperation(op.id);
    }

    return failed.length;
  }

  /**
   * Get sync queue status
   */
  async getQueueStatus(): Promise<{ pending: number; failed: number }> {
    const operations = await this.getPendingOperations();
    const failed = operations.filter(op => op.retryCount >= 10).length;
    
    return {
      pending: operations.length - failed,
      failed
    };
  }

  // ==================== Recipe Cache Operations ====================

  /**
   * Save a recipe to local cache
   * @param recipe - CachedRecipe object
   */
  async saveRecipe(recipe: CachedRecipe): Promise<void> {
    await this.ready();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([RECIPES_STORE], 'readwrite');
      const store = transaction.objectStore(RECIPES_STORE);
      const request = store.put(recipe);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save a recipe from an NDKEvent
   */
  async saveRecipeFromEvent(event: any): Promise<void> {
    if (!event) {
      console.warn('[OfflineStorage] saveRecipeFromEvent called with null event');
      return;
    }

    const dTag = event.tags?.find((t: string[]) => t[0] === 'd')?.[1] || '';
    const aTag = `${event.kind}:${event.pubkey}:${dTag}`;
    console.log('[OfflineStorage] Saving recipe:', aTag, '- Title:', event.tags?.find((t: string[]) => t[0] === 'title')?.[1]);

    // Parse ingredients from tags
    const ingredients: string[] = [];
    event.tags?.forEach((tag: string[]) => {
      if (tag[0] === 'ingredient') {
        // Format: ['ingredient', 'amount', 'unit', 'name'] or just ['ingredient', 'name']
        if (tag.length >= 4) {
          ingredients.push(`${tag[1]} ${tag[2]} ${tag[3]}`.trim());
        } else if (tag.length >= 2) {
          ingredients.push(tag[1]);
        }
      }
    });

    const cachedRecipe: CachedRecipe = {
      id: aTag,
      title: event.tags?.find((t: string[]) => t[0] === 'title')?.[1] || 'Untitled',
      summary: event.tags?.find((t: string[]) => t[0] === 'summary')?.[1],
      content: event.content || '',
      ingredients,
      image: event.tags?.find((t: string[]) => t[0] === 'image')?.[1],
      prepTime: event.tags?.find((t: string[]) => t[0] === 'prep_time')?.[1],
      cookTime: event.tags?.find((t: string[]) => t[0] === 'cook_time')?.[1],
      servings: event.tags?.find((t: string[]) => t[0] === 'servings')?.[1],
      tags: event.tags?.filter((t: string[]) => t[0] === 't').map((t: string[]) => t[1]) || [],
      authorPubkey: event.pubkey,
      createdAt: event.created_at || Date.now() / 1000,
      cachedAt: Date.now(),
      eventKind: event.kind,
      eventDTag: dTag,
      eventTags: event.tags?.map((t: string[]) => [...t]) || []
    };

    await this.saveRecipe(cachedRecipe);
  }

  /**
   * Get a cached recipe by its a-tag
   */
  async getRecipe(aTag: string): Promise<CachedRecipe | null> {
    await this.ready();
    if (!this.db) {
      console.warn('[OfflineStorage] getRecipe: DB not ready');
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([RECIPES_STORE], 'readonly');
      const store = transaction.objectStore(RECIPES_STORE);
      const request = store.get(aTag);

      request.onsuccess = () => {
        const result = request.result || null;
        if (!result) {
          console.log('[OfflineStorage] Recipe not found in cache:', aTag);
        }
        resolve(result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get multiple recipes by their a-tags
   */
  async getRecipes(aTags: string[]): Promise<CachedRecipe[]> {
    const recipes: CachedRecipe[] = [];
    
    // Log all cached recipe IDs for debugging
    const allCached = await this.getAllRecipes();
    if (allCached.length > 0) {
      console.log('[OfflineStorage] All cached recipe IDs:', allCached.map(r => r.id));
    }
    
    for (const aTag of aTags) {
      const recipe = await this.getRecipe(aTag);
      if (recipe) {
        recipes.push(recipe);
      }
    }
    
    return recipes;
  }

  /**
   * Get all cached recipes
   */
  async getAllRecipes(): Promise<CachedRecipe[]> {
    await this.ready();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([RECIPES_STORE], 'readonly');
      const store = transaction.objectStore(RECIPES_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a cached recipe
   */
  async deleteRecipe(aTag: string): Promise<void> {
    await this.ready();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([RECIPES_STORE], 'readwrite');
      const store = transaction.objectStore(RECIPES_STORE);
      const request = store.delete(aTag);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get recipe cache statistics
   */
  async getRecipeCacheStats(): Promise<{ count: number; oldestCache: number | null }> {
    const recipes = await this.getAllRecipes();
    
    if (recipes.length === 0) {
      return { count: 0, oldestCache: null };
    }
    
    const oldestCache = Math.min(...recipes.map(r => r.cachedAt));
    return { count: recipes.length, oldestCache };
  }

  // ==================== Utility Operations ====================

  /**
   * Clear all offline data for a user
   */
  async clearUserData(pubkey: string): Promise<void> {
    const cookbooks = await this.getAllCookbooks(pubkey);
    
    for (const cookbook of cookbooks) {
      await this.deleteCookbook(cookbook.data.id, pubkey);
      
      // Also clear any pending operations for this cookbook
      const operations = await this.getOperationsForList(cookbook.data.id);
      for (const op of operations) {
        await this.removeOperation(op.id);
      }
    }
  }

  /**
   * Clear all offline data
   */
  async clearAll(): Promise<void> {
    await this.ready();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([COOKBOOKS_STORE, SYNC_QUEUE_STORE, RECIPES_STORE], 'readwrite');
      
      transaction.objectStore(COOKBOOKS_STORE).clear();
      transaction.objectStore(SYNC_QUEUE_STORE).clear();
      transaction.objectStore(RECIPES_STORE).clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{ cookbooks: number; pendingOps: number; pendingCookbooks: number }> {
    await this.ready();
    if (!this.db) return { cookbooks: 0, pendingOps: 0, pendingCookbooks: 0 };

    const [cookbooksCount, opsCount] = await Promise.all([
      new Promise<number>((resolve, reject) => {
        const transaction = this.db!.transaction([COOKBOOKS_STORE], 'readonly');
        const request = transaction.objectStore(COOKBOOKS_STORE).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
      new Promise<number>((resolve, reject) => {
        const transaction = this.db!.transaction([SYNC_QUEUE_STORE], 'readonly');
        const request = transaction.objectStore(SYNC_QUEUE_STORE).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
    ]);

    // Count pending cookbooks
    const allCookbooks = await new Promise<OfflineCookbook[]>((resolve, reject) => {
      const transaction = this.db!.transaction([COOKBOOKS_STORE], 'readonly');
      const request = transaction.objectStore(COOKBOOKS_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    const pendingCookbooks = allCookbooks.filter(c => c.pendingChanges).length;

    return {
      cookbooks: cookbooksCount,
      pendingOps: opsCount,
      pendingCookbooks
    };
  }
}

// Export singleton instance
export const offlineStorage = new OfflineStorageManager();
