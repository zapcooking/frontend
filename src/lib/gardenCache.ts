/**
 * Garden Relay Cache Service
 * 
 * Dedicated IndexedDB-based caching for the Garden relay feed.
 * Since Garden is a single relay with lower traffic, we can:
 * - Cache events for longer periods
 * - Show cached data immediately (stale-while-revalidate)
 * - Work offline when the relay is unavailable
 */

import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';

// Database configuration
const DB_NAME = 'zapcooking-garden-cache';
const DB_VERSION = 1;
const EVENTS_STORE = 'garden_events';
const METADATA_STORE = 'metadata';

// Cache configuration
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes - show cached immediately, refresh in background
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes - consider data "fresh" for this long
const MAX_CACHED_EVENTS = 200; // Maximum events to keep in cache

/**
 * Serialized Garden event for storage
 */
export interface CachedGardenEvent {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  sig: string;
  cachedAt: number;
}

/**
 * Cache metadata
 */
interface CacheMetadata {
  key: string;
  lastFetched: number;
  eventCount: number;
  oldestEvent: number;
  newestEvent: number;
}

/**
 * Cache status for UI
 */
export interface GardenCacheStatus {
  isLoading: boolean;
  isFresh: boolean;
  lastFetched: number | null;
  cachedEventCount: number;
  error: string | null;
}

// Export store for cache status
export const gardenCacheStatus = writable<GardenCacheStatus>({
  isLoading: false,
  isFresh: false,
  lastFetched: null,
  cachedEventCount: 0,
  error: null
});

/**
 * Garden Cache Manager
 */
class GardenCacheManager {
  private db: IDBDatabase | null = null;
  private dbReady!: Promise<void>;
  private dbReadyResolve!: () => void;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.dbReady = new Promise((resolve) => {
      this.dbReadyResolve = resolve;
    });

    if (browser) {
      this.initPromise = this.initDatabase();
    } else {
      this.dbReadyResolve();
    }
  }

  /**
   * Initialize IndexedDB database
   */
  private async initDatabase(): Promise<void> {
    if (!browser || typeof window === 'undefined') {
      this.dbReadyResolve();
      return;
    }

    const idb = (globalThis as any).indexedDB;
    if (!idb) {
      console.warn('[GardenCache] IndexedDB not available');
      this.dbReadyResolve();
      return;
    }

    return new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[GardenCache] Failed to open database:', request.error);
        this.dbReadyResolve();
        resolve();
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[GardenCache] Database initialized');
        this.dbReadyResolve();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        console.log('[GardenCache] Creating database stores');

        // Create events store with indexes
        if (!db.objectStoreNames.contains(EVENTS_STORE)) {
          const eventsStore = db.createObjectStore(EVENTS_STORE, { keyPath: 'id' });
          eventsStore.createIndex('created_at', 'created_at', { unique: false });
          eventsStore.createIndex('cachedAt', 'cachedAt', { unique: false });
          eventsStore.createIndex('pubkey', 'pubkey', { unique: false });
        }

        // Create metadata store
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE, { keyPath: 'key' });
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

  /**
   * Serialize an NDKEvent for storage
   */
  private serializeEvent(event: any): CachedGardenEvent {
    return {
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      content: event.content,
      tags: event.tags?.map((t: string[]) => [...t]) || [],
      created_at: event.created_at,
      sig: event.sig,
      cachedAt: Date.now()
    };
  }

  /**
   * Get cached events
   */
  async getCachedEvents(): Promise<CachedGardenEvent[]> {
    await this.ready();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([EVENTS_STORE], 'readonly');
      const store = transaction.objectStore(EVENTS_STORE);
      const index = store.index('created_at');
      
      // Get all events sorted by created_at descending
      const request = index.getAll();

      request.onsuccess = () => {
        const events = (request.result || []).sort(
          (a, b) => b.created_at - a.created_at
        );
        resolve(events);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save events to cache
   */
  async saveEvents(events: any[]): Promise<void> {
    await this.ready();
    if (!this.db || events.length === 0) return;

    const serializedEvents = events.map(e => this.serializeEvent(e));
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([EVENTS_STORE, METADATA_STORE], 'readwrite');
      const eventsStore = transaction.objectStore(EVENTS_STORE);
      const metadataStore = transaction.objectStore(METADATA_STORE);

      // Add/update each event
      for (const event of serializedEvents) {
        eventsStore.put(event);
      }

      // Update metadata
      const now = Date.now();
      const createdAts = serializedEvents.map(e => e.created_at);
      const metadata: CacheMetadata = {
        key: 'garden_feed',
        lastFetched: now,
        eventCount: serializedEvents.length,
        oldestEvent: Math.min(...createdAts),
        newestEvent: Math.max(...createdAts)
      };
      metadataStore.put(metadata);

      transaction.oncomplete = () => {
        console.log(`[GardenCache] Saved ${serializedEvents.length} events to cache`);
        
        // Update status store
        gardenCacheStatus.update(s => ({
          ...s,
          lastFetched: now,
          cachedEventCount: serializedEvents.length,
          isFresh: true,
          error: null
        }));
        
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Merge new events with cached events (deduplication)
   */
  async mergeEvents(newEvents: any[]): Promise<void> {
    await this.ready();
    if (!this.db) return;

    const serializedEvents = newEvents.map(e => this.serializeEvent(e));
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([EVENTS_STORE, METADATA_STORE], 'readwrite');
      const eventsStore = transaction.objectStore(EVENTS_STORE);
      const metadataStore = transaction.objectStore(METADATA_STORE);

      // Add/update each event (put will overwrite existing)
      for (const event of serializedEvents) {
        eventsStore.put(event);
      }

      // Get total count and update metadata
      const countRequest = eventsStore.count();
      countRequest.onsuccess = () => {
        const totalCount = countRequest.result;
        
        // Update metadata
        const now = Date.now();
        const metadata: CacheMetadata = {
          key: 'garden_feed',
          lastFetched: now,
          eventCount: totalCount,
          oldestEvent: 0, // Will be calculated on read
          newestEvent: 0
        };
        metadataStore.put(metadata);
        
        // Update status store
        gardenCacheStatus.update(s => ({
          ...s,
          lastFetched: now,
          cachedEventCount: totalCount,
          isFresh: true,
          error: null
        }));
      };

      transaction.oncomplete = () => {
        console.log(`[GardenCache] Merged ${serializedEvents.length} events`);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get cache metadata
   */
  async getMetadata(): Promise<CacheMetadata | null> {
    await this.ready();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([METADATA_STORE], 'readonly');
      const store = transaction.objectStore(METADATA_STORE);
      const request = store.get('garden_feed');

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Check if cache is fresh (within STALE_THRESHOLD_MS)
   */
  async isCacheFresh(): Promise<boolean> {
    const metadata = await this.getMetadata();
    if (!metadata) return false;

    const age = Date.now() - metadata.lastFetched;
    return age < STALE_THRESHOLD_MS;
  }

  /**
   * Check if cache is valid (within CACHE_TTL_MS)
   */
  async isCacheValid(): Promise<boolean> {
    const metadata = await this.getMetadata();
    if (!metadata) return false;

    const age = Date.now() - metadata.lastFetched;
    return age < CACHE_TTL_MS;
  }

  /**
   * Clear old events to keep cache size manageable
   */
  async pruneCache(): Promise<void> {
    await this.ready();
    if (!this.db) return;

    const events = await this.getCachedEvents();
    
    if (events.length <= MAX_CACHED_EVENTS) {
      return;
    }

    // Keep only the newest MAX_CACHED_EVENTS
    const eventsToDelete = events.slice(MAX_CACHED_EVENTS);
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([EVENTS_STORE], 'readwrite');
      const store = transaction.objectStore(EVENTS_STORE);

      for (const event of eventsToDelete) {
        store.delete(event.id);
      }

      transaction.oncomplete = () => {
        console.log(`[GardenCache] Pruned ${eventsToDelete.length} old events`);
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Clear all cached data
   */
  async clearCache(): Promise<void> {
    await this.ready();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([EVENTS_STORE, METADATA_STORE], 'readwrite');
      
      transaction.objectStore(EVENTS_STORE).clear();
      transaction.objectStore(METADATA_STORE).clear();

      transaction.oncomplete = () => {
        console.log('[GardenCache] Cache cleared');
        gardenCacheStatus.set({
          isLoading: false,
          isFresh: false,
          lastFetched: null,
          cachedEventCount: 0,
          error: null
        });
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    eventCount: number;
    lastFetched: number | null;
    cacheAge: number | null;
    isFresh: boolean;
    isValid: boolean;
  }> {
    const metadata = await this.getMetadata();
    
    if (!metadata) {
      return {
        eventCount: 0,
        lastFetched: null,
        cacheAge: null,
        isFresh: false,
        isValid: false
      };
    }

    const cacheAge = Date.now() - metadata.lastFetched;
    
    return {
      eventCount: metadata.eventCount,
      lastFetched: metadata.lastFetched,
      cacheAge,
      isFresh: cacheAge < STALE_THRESHOLD_MS,
      isValid: cacheAge < CACHE_TTL_MS
    };
  }
}

// Export singleton instance
export const gardenCache = new GardenCacheManager();

/**
 * Helper function to convert cached events back to a format compatible with NDKEvent
 * The feed component can use this to display cached events
 */
export function cachedEventToNDKLike(cached: CachedGardenEvent): any {
  return {
    id: cached.id,
    pubkey: cached.pubkey,
    kind: cached.kind,
    content: cached.content,
    tags: cached.tags,
    created_at: cached.created_at,
    sig: cached.sig,
    // Add methods expected by the UI (minimal implementation)
    tagValue: (tagName: string) => {
      const tag = cached.tags.find(t => t[0] === tagName);
      return tag ? tag[1] : undefined;
    },
    getMatchingTags: (tagName: string) => {
      return cached.tags.filter(t => t[0] === tagName);
    }
  };
}
