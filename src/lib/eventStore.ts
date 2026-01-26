/**
 * Event Store - IndexedDB Cache for Feed Events
 * 
 * Provides persistent caching for feed events with:
 * - IndexedDB storage for large datasets
 * - TTL-based expiration
 * - Indexed queries by author, kind, timestamp, hashtags
 * - Cache rehydration for instant paint on load
 * - Automatic cleanup of expired entries
 */

import { browser } from '$app/environment';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { getNdkInstance } from './nostr';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface CachedEvent {
  id: string;
  event: any; // Serialized event JSON (rawEvent)
  author: string;
  kind: number;
  created_at: number;
  cached_at: number;
  expires_at: number;
  tags: string[][];
  hashtags: string[]; // Extracted hashtags for filtering
}

export interface EventFilter {
  kinds?: number[];
  authors?: string[];
  hashtags?: string[];
  since?: number;
  until?: number;
  limit?: number;
}

export interface CacheStats {
  total: number;
  expired: number;
  estimatedSizeKB: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  DB_NAME: 'zapcooking-event-store',
  DB_VERSION: 1,
  STORE_NAME: 'events',
  
  // TTL settings - longer TTLs since we do smart background refreshes
  DEFAULT_TTL_MS: 15 * 60 * 1000,          // 15 minutes default TTL
  FEED_TTL_MS: 30 * 60 * 1000,             // 30 minutes for feed events (articles, recipes)
  PROFILE_TTL_MS: 60 * 60 * 1000,          // 1 hour for profile data
  
  // Limits
  MAX_CACHED_EVENTS: 5000,                  // Max events to store
  CLEANUP_BATCH_SIZE: 500,                  // Events per cleanup batch
  
  // Cleanup
  CLEANUP_INTERVAL_MS: 10 * 60 * 1000,      // Cleanup every 10 minutes
  
  // Size estimate
  AVG_EVENT_SIZE_KB: 1                      // ~1KB per event estimate
};

// ═══════════════════════════════════════════════════════════════
// INDEXEDDB SETUP
// ═══════════════════════════════════════════════════════════════

let db: IDBDatabase | null = null;
let dbInitPromise: Promise<IDBDatabase | null> | null = null;

async function initDB(): Promise<IDBDatabase | null> {
  if (!browser) return null;
  
  if (db) return db;
  if (dbInitPromise) return dbInitPromise;
  
  dbInitPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
      
      request.onerror = () => {
        console.warn('[EventStore] IndexedDB open failed:', request.error);
        resolve(null);
      };
      
      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        
        if (!database.objectStoreNames.contains(CONFIG.STORE_NAME)) {
          const store = database.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'id' });
          
          // Create indexes for efficient querying
          store.createIndex('author', 'author', { unique: false });
          store.createIndex('kind', 'kind', { unique: false });
          store.createIndex('created_at', 'created_at', { unique: false });
          store.createIndex('cached_at', 'cached_at', { unique: false });
          store.createIndex('expires_at', 'expires_at', { unique: false });
          
          console.debug('[EventStore] Created IndexedDB store with indexes');
        }
      };
      
      request.onsuccess = () => {
        db = request.result;
        
        db.onerror = (event) => {
          console.warn('[EventStore] IndexedDB error:', event);
        };
        
        db.onclose = () => {
          db = null;
          dbInitPromise = null;
        };
        
        resolve(db);
      };
    } catch (err) {
      console.warn('[EventStore] IndexedDB init error:', err);
      resolve(null);
    }
  });
  
  return dbInitPromise;
}

// ═══════════════════════════════════════════════════════════════
// EVENT STORE CLASS
// ═══════════════════════════════════════════════════════════════

export class EventStore {
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  
  constructor() {
    if (browser) {
      // Initialize DB
      initDB().catch(() => {});
      
      // Start periodic cleanup
      this.cleanupInterval = setInterval(() => {
        this.clearExpired().catch(() => {});
      }, CONFIG.CLEANUP_INTERVAL_MS);
    }
  }
  
  /**
   * Store events with TTL
   */
  async storeEvents(
    events: NDKEvent[],
    ttlMs: number = CONFIG.DEFAULT_TTL_MS
  ): Promise<void> {
    if (events.length === 0) return;
    
    const database = await initDB();
    if (!database) return;
    
    const now = Date.now();
    const expiresAt = now + ttlMs;
    
    const cached: CachedEvent[] = events.map(event => {
      // Extract hashtags for filtering
      const hashtags = event.tags
        .filter(t => t[0] === 't' && t[1])
        .map(t => (t[1] as string).toLowerCase());
      
      return {
        id: event.id,
        event: event.rawEvent(), // Serialize to raw format
        author: event.pubkey,
        kind: event.kind || 1,
        created_at: event.created_at || 0,
        cached_at: now,
        expires_at: expiresAt,
        tags: event.tags,
        hashtags
      };
    });
    
    return new Promise((resolve) => {
      try {
        const tx = database.transaction(CONFIG.STORE_NAME, 'readwrite');
        const store = tx.objectStore(CONFIG.STORE_NAME);
        
        for (const entry of cached) {
          store.put(entry);
        }
        
        tx.oncomplete = () => {
          console.debug(`[EventStore] Cached ${cached.length} events`);
          resolve();
        };
        
        tx.onerror = () => {
          console.warn('[EventStore] Store failed:', tx.error);
          resolve();
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'QuotaExceededError') {
          console.warn('[EventStore] Storage quota exceeded, clearing old entries');
          this.clearExpired().then(() => resolve());
        } else {
          console.warn('[EventStore] Store error:', err);
          resolve();
        }
      }
    });
  }
  
  /**
   * Load events from cache with filtering
   * Returns NDKEvent objects ready for use
   */
  async loadEvents(filter: EventFilter): Promise<NDKEvent[]> {
    const database = await initDB();
    if (!database) return [];
    
    const now = Date.now();
    
    try {
      return new Promise((resolve) => {
        const tx = database.transaction(CONFIG.STORE_NAME, 'readonly');
        const store = tx.objectStore(CONFIG.STORE_NAME);
        
        // Use index for better performance when possible
        let request: IDBRequest;
        
        if (filter.authors && filter.authors.length === 1) {
          // Single author - use index
          const index = store.index('author');
          request = index.getAll(filter.authors[0]);
        } else {
          // Multiple authors or no author filter - full scan
          request = store.getAll();
        }
        
        request.onsuccess = () => {
          let results: CachedEvent[] = request.result || [];
          
          // Filter out expired
          results = results.filter(e => e.expires_at > now);
          
          // Apply filters
          if (filter.kinds && filter.kinds.length > 0) {
            results = results.filter(e => filter.kinds!.includes(e.kind));
          }
          
          if (filter.authors && filter.authors.length > 1) {
            const authorSet = new Set(filter.authors);
            results = results.filter(e => authorSet.has(e.author));
          }
          
          if (filter.hashtags && filter.hashtags.length > 0) {
            const hashtagSet = new Set(filter.hashtags.map(h => h.toLowerCase()));
            results = results.filter(e => 
              e.hashtags?.some(h => hashtagSet.has(h))
            );
          }
          
          if (filter.since) {
            results = results.filter(e => e.created_at >= filter.since!);
          }
          
          if (filter.until) {
            results = results.filter(e => e.created_at <= filter.until!);
          }
          
          // Sort by created_at descending (newest first)
          results.sort((a, b) => b.created_at - a.created_at);
          
          // Apply limit
          if (filter.limit) {
            results = results.slice(0, filter.limit);
          }
          
          // Convert to NDKEvent objects
          const ndk = getNdkInstance();
          const events: NDKEvent[] = [];
          
          // Dynamic import to avoid circular dependency
          import('@nostr-dev-kit/ndk').then(({ NDKEvent }) => {
            for (const cached of results) {
              try {
                const event = new NDKEvent(ndk, cached.event);
                events.push(event);
              } catch {
                // Skip invalid events
              }
            }
            
            console.debug(`[EventStore] Loaded ${events.length} events from cache`);
            resolve(events);
          }).catch(() => {
            resolve([]);
          });
        };
        
        request.onerror = () => {
          console.warn('[EventStore] Load failed:', request.error);
          resolve([]);
        };
      });
    } catch (err) {
      console.warn('[EventStore] loadEvents error:', err);
      return [];
    }
  }
  
  /**
   * Quick check if cache has events for a filter
   * Useful for deciding whether to show loading state
   */
  async hasEvents(filter: EventFilter): Promise<boolean> {
    const events = await this.loadEvents({ ...filter, limit: 1 });
    return events.length > 0;
  }
  
  /**
   * Clear expired events from cache
   */
  async clearExpired(): Promise<number> {
    const database = await initDB();
    if (!database) return 0;
    
    const now = Date.now();
    
    return new Promise((resolve) => {
      try {
        const tx = database.transaction(CONFIG.STORE_NAME, 'readwrite');
        const store = tx.objectStore(CONFIG.STORE_NAME);
        const index = store.index('expires_at');
        
        // Get expired entries
        const range = IDBKeyRange.upperBound(now);
        const request = index.openCursor(range);
        
        let deletedCount = 0;
        
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor && deletedCount < CONFIG.CLEANUP_BATCH_SIZE) {
            cursor.delete();
            deletedCount++;
            cursor.continue();
          }
        };
        
        tx.oncomplete = () => {
          if (deletedCount > 0) {
            console.debug(`[EventStore] Cleared ${deletedCount} expired events`);
          }
          resolve(deletedCount);
        };
        
        tx.onerror = () => {
          resolve(0);
        };
      } catch (err) {
        console.warn('[EventStore] clearExpired error:', err);
        resolve(0);
      }
    });
  }
  
  /**
   * Clear all cached events
   */
  async clearAll(): Promise<void> {
    const database = await initDB();
    if (!database) return;
    
    return new Promise((resolve) => {
      try {
        const tx = database.transaction(CONFIG.STORE_NAME, 'readwrite');
        const store = tx.objectStore(CONFIG.STORE_NAME);
        store.clear();
        
        tx.oncomplete = () => {
          console.debug('[EventStore] Cleared all cached events');
          resolve();
        };
        
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
  
  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const database = await initDB();
    if (!database) {
      return { total: 0, expired: 0, estimatedSizeKB: 0 };
    }
    
    const now = Date.now();
    
    return new Promise((resolve) => {
      try {
        const tx = database.transaction(CONFIG.STORE_NAME, 'readonly');
        const store = tx.objectStore(CONFIG.STORE_NAME);
        
        const countRequest = store.count();
        
        countRequest.onsuccess = () => {
          const total = countRequest.result;
          
          // Count expired
          const index = store.index('expires_at');
          const expiredRequest = index.count(IDBKeyRange.upperBound(now));
          
          expiredRequest.onsuccess = () => {
            const expired = expiredRequest.result;
            resolve({
              total,
              expired,
              estimatedSizeKB: total * CONFIG.AVG_EVENT_SIZE_KB
            });
          };
          
          expiredRequest.onerror = () => {
            resolve({
              total,
              expired: 0,
              estimatedSizeKB: total * CONFIG.AVG_EVENT_SIZE_KB
            });
          };
        };
        
        countRequest.onerror = () => {
          resolve({ total: 0, expired: 0, estimatedSizeKB: 0 });
        };
      } catch {
        resolve({ total: 0, expired: 0, estimatedSizeKB: 0 });
      }
    });
  }
  
  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let eventStore: EventStore | null = null;

/**
 * Get or create the singleton event store
 */
export function getEventStore(): EventStore {
  if (!eventStore) {
    eventStore = new EventStore();
  }
  return eventStore;
}

/**
 * Reset the event store (for testing)
 */
export async function resetEventStore(): Promise<void> {
  if (eventStore) {
    await eventStore.clearAll();
    eventStore.destroy();
    eventStore = null;
  }
}

// ═══════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Store feed events with appropriate TTL
 */
export async function cacheFeedEvents(events: NDKEvent[]): Promise<void> {
  const store = getEventStore();
  await store.storeEvents(events, CONFIG.FEED_TTL_MS);
}

/**
 * Load cached feed events for instant paint
 * Call this before fetching from relays
 */
export async function loadCachedFeedEvents(filter: EventFilter): Promise<NDKEvent[]> {
  const store = getEventStore();
  return store.loadEvents(filter);
}

/**
 * Check if we have cached events (for showing loading vs cached state)
 */
export async function hasCachedEvents(filter: EventFilter): Promise<boolean> {
  const store = getEventStore();
  return store.hasEvents(filter);
}

