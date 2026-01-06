/**
 * NIP-65 Relay List Cache
 * 
 * Aggressive caching layer for kind:10002 relay list events with:
 * - In-memory Map for fast runtime access
 * - IndexedDB for persistence across sessions
 * - TTL of 1 hour before considering stale
 * - Background refresh for stale entries (serve stale, update async)
 * - Batch prefetching for feeds
 */

import { browser } from '$app/environment';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { getNdkInstance, ndkReady } from './nostr';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RelayList {
  read: string[];   // inbox relays (for mentions)
  write: string[];  // outbox relays (where user publishes)
  updatedAt: number;
}

interface CachedRelayList extends RelayList {
  pubkey: string;
  fetchedAt: number;
  eventCreatedAt: number;
}

export interface RelayListCache {
  get(pubkey: string): Promise<RelayList | null>;
  getMany(pubkeys: string[]): Promise<Map<string, RelayList>>;
  prefetch(pubkeys: string[]): void; // fire-and-forget
  invalidate(pubkey: string): void;
  clear(): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  DB_NAME: 'zapcooking-relay-list-cache',
  DB_VERSION: 1,
  STORE_NAME: 'relay-lists',
  
  // TTL settings
  TTL_MS: 60 * 60 * 1000,                  // 1 hour before stale
  HARD_EXPIRE_MS: 24 * 60 * 60 * 1000,     // 24 hours before forced refresh
  
  // Memory cache limits
  MAX_MEMORY_ENTRIES: 2000,
  
  // Network settings
  BATCH_SIZE: 100,                          // Pubkeys per network request
  NETWORK_TIMEOUT_MS: 8000,                 // Timeout for network requests
  
  // Prefetch settings
  PREFETCH_DEBOUNCE_MS: 100,                // Debounce rapid prefetch calls
  MAX_PREFETCH_BATCH: 500,                  // Max pubkeys per prefetch batch
  
  // IndexedDB settings
  CLEANUP_INTERVAL_MS: 30 * 60 * 1000,      // Cleanup expired entries every 30 min
  MAX_DB_ENTRIES: 10000,                    // Max entries in IndexedDB
  
  // Discovery relays for fetching relay lists
  DISCOVERY_RELAYS: [
    'wss://purplepag.es',
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net'
  ]
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
        console.warn('[RelayListCache] IndexedDB open failed:', request.error);
        resolve(null);
      };
      
      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        
        // Create object store with pubkey as key
        if (!database.objectStoreNames.contains(CONFIG.STORE_NAME)) {
          const store = database.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'pubkey' });
          
          // Index for cleanup queries
          store.createIndex('fetchedAt', 'fetchedAt', { unique: false });
          store.createIndex('eventCreatedAt', 'eventCreatedAt', { unique: false });
        }
      };
      
      request.onsuccess = () => {
        db = request.result;
        
        // Handle connection errors
        db.onerror = (event) => {
          console.warn('[RelayListCache] IndexedDB error:', event);
        };
        
        // Handle database being closed unexpectedly
        db.onclose = () => {
          db = null;
          dbInitPromise = null;
        };
        
        resolve(db);
      };
    } catch (err) {
      console.warn('[RelayListCache] IndexedDB init error:', err);
      resolve(null);
    }
  });
  
  return dbInitPromise;
}

// ═══════════════════════════════════════════════════════════════
// INDEXEDDB OPERATIONS
// ═══════════════════════════════════════════════════════════════

async function dbGet(pubkey: string): Promise<CachedRelayList | null> {
  const database = await initDB();
  if (!database) return null;
  
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(CONFIG.STORE_NAME, 'readonly');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      const request = store.get(pubkey);
      
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      
      request.onerror = () => {
        console.warn('[RelayListCache] dbGet error:', request.error);
        resolve(null);
      };
    } catch (err) {
      console.warn('[RelayListCache] dbGet error:', err);
      resolve(null);
    }
  });
}

async function dbGetMany(pubkeys: string[]): Promise<Map<string, CachedRelayList>> {
  const database = await initDB();
  const results = new Map<string, CachedRelayList>();
  
  if (!database || pubkeys.length === 0) return results;
  
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(CONFIG.STORE_NAME, 'readonly');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      
      let completed = 0;
      
      for (const pubkey of pubkeys) {
        const request = store.get(pubkey);
        
        request.onsuccess = () => {
          if (request.result) {
            results.set(pubkey, request.result);
          }
          completed++;
          if (completed === pubkeys.length) {
            resolve(results);
          }
        };
        
        request.onerror = () => {
          completed++;
          if (completed === pubkeys.length) {
            resolve(results);
          }
        };
      }
      
      // Handle empty pubkeys array
      if (pubkeys.length === 0) {
        resolve(results);
      }
    } catch (err) {
      console.warn('[RelayListCache] dbGetMany error:', err);
      resolve(results);
    }
  });
}

async function dbPut(entry: CachedRelayList): Promise<void> {
  const database = await initDB();
  if (!database) return;
  
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(CONFIG.STORE_NAME, 'readwrite');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      
      store.put(entry);
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn('[RelayListCache] dbPut error:', tx.error);
        resolve();
      };
    } catch (err) {
      // Handle quota exceeded gracefully
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        console.warn('[RelayListCache] Storage quota exceeded, clearing old entries');
        cleanupOldEntries().then(() => resolve());
      } else {
        console.warn('[RelayListCache] dbPut error:', err);
        resolve();
      }
    }
  });
}

async function dbPutMany(entries: CachedRelayList[]): Promise<void> {
  const database = await initDB();
  if (!database || entries.length === 0) return;
  
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(CONFIG.STORE_NAME, 'readwrite');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      
      for (const entry of entries) {
        store.put(entry);
      }
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn('[RelayListCache] dbPutMany error:', tx.error);
        resolve();
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        console.warn('[RelayListCache] Storage quota exceeded, clearing old entries');
        cleanupOldEntries().then(() => resolve());
      } else {
        console.warn('[RelayListCache] dbPutMany error:', err);
        resolve();
      }
    }
  });
}

async function dbDelete(pubkey: string): Promise<void> {
  const database = await initDB();
  if (!database) return;
  
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(CONFIG.STORE_NAME, 'readwrite');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      
      store.delete(pubkey);
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (err) {
      console.warn('[RelayListCache] dbDelete error:', err);
      resolve();
    }
  });
}

async function dbClear(): Promise<void> {
  const database = await initDB();
  if (!database) return;
  
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(CONFIG.STORE_NAME, 'readwrite');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      
      store.clear();
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (err) {
      console.warn('[RelayListCache] dbClear error:', err);
      resolve();
    }
  });
}

async function cleanupOldEntries(): Promise<void> {
  const database = await initDB();
  if (!database) return;
  
  const cutoffTime = Date.now() - CONFIG.HARD_EXPIRE_MS;
  
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(CONFIG.STORE_NAME, 'readwrite');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      const index = store.index('fetchedAt');
      
      // Delete entries older than hard expire time
      const range = IDBKeyRange.upperBound(cutoffTime);
      const request = index.openCursor(range);
      
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (err) {
      console.warn('[RelayListCache] cleanupOldEntries error:', err);
      resolve();
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// NIP-65 PARSING
// ═══════════════════════════════════════════════════════════════

/**
 * Normalize relay URL to consistent format
 * - Lowercase
 * - Remove trailing slashes
 * - Ensure wss:// prefix
 */
export function normalizeRelayUrl(url: string): string {
  try {
    let normalized = url.trim().toLowerCase();
    
    // Ensure protocol
    if (!normalized.startsWith('wss://') && !normalized.startsWith('ws://')) {
      normalized = 'wss://' + normalized;
    }
    
    // Parse and reconstruct to normalize
    const parsed = new URL(normalized);
    
    // Remove trailing slash from pathname
    let path = parsed.pathname;
    while (path.endsWith('/') && path.length > 1) {
      path = path.slice(0, -1);
    }
    
    return `${parsed.protocol}//${parsed.host}${path === '/' ? '' : path}`;
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Validate relay URL
 */
export function isValidRelayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'wss:' || parsed.protocol === 'ws:';
  } catch {
    return false;
  }
}

/**
 * Parse a kind:10002 NIP-65 relay list event
 * 
 * Per NIP-65:
 * - Tags with no marker = both read AND write
 * - Tags with "read" marker = inbox only (where to fetch mentions)
 * - Tags with "write" marker = outbox only (where user publishes)
 */
export function parseNip65Event(event: NDKEvent): RelayList {
  const read: string[] = [];
  const write: string[] = [];
  const seenRead = new Set<string>();
  const seenWrite = new Set<string>();
  
  for (const tag of event.tags) {
    // Must be an 'r' tag with a URL
    if (tag[0] !== 'r' || !tag[1]) continue;
    
    // Validate URL
    if (!isValidRelayUrl(tag[1])) continue;
    
    const relay = normalizeRelayUrl(tag[1]);
    const marker = tag[2]?.toLowerCase();
    
    // No marker = both read and write
    if (!marker) {
      if (!seenRead.has(relay)) {
        seenRead.add(relay);
        read.push(relay);
      }
      if (!seenWrite.has(relay)) {
        seenWrite.add(relay);
        write.push(relay);
      }
    } else if (marker === 'read') {
      if (!seenRead.has(relay)) {
        seenRead.add(relay);
        read.push(relay);
      }
    } else if (marker === 'write') {
      if (!seenWrite.has(relay)) {
        seenWrite.add(relay);
        write.push(relay);
      }
    }
  }
  
  return {
    read,
    write,
    updatedAt: (event.created_at || 0) * 1000
  };
}

// ═══════════════════════════════════════════════════════════════
// MEMORY CACHE
// ═══════════════════════════════════════════════════════════════

const memoryCache = new Map<string, CachedRelayList>();

function isStale(entry: CachedRelayList): boolean {
  return Date.now() - entry.fetchedAt > CONFIG.TTL_MS;
}

function isHardExpired(entry: CachedRelayList): boolean {
  return Date.now() - entry.fetchedAt > CONFIG.HARD_EXPIRE_MS;
}

function pruneMemoryCache(): void {
  if (memoryCache.size <= CONFIG.MAX_MEMORY_ENTRIES) return;
  
  // Convert to array and sort by fetchedAt (oldest first)
  const entries = [...memoryCache.entries()]
    .sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  
  // Remove oldest 20%
  const removeCount = Math.floor(memoryCache.size * 0.2);
  for (let i = 0; i < removeCount; i++) {
    memoryCache.delete(entries[i][0]);
  }
}

// ═══════════════════════════════════════════════════════════════
// NETWORK FETCHING
// ═══════════════════════════════════════════════════════════════

// Track in-flight fetches to prevent duplicate requests
const inFlightFetches = new Map<string, Promise<RelayList | null>>();
const batchQueue = new Set<string>();
let batchTimeout: ReturnType<typeof setTimeout> | null = null;

async function fetchFromNetwork(pubkeys: string[]): Promise<Map<string, CachedRelayList>> {
  const results = new Map<string, CachedRelayList>();
  
  if (pubkeys.length === 0) return results;
  
  try {
    await ndkReady;
    const ndk = getNdkInstance();
    
    if (!ndk) {
      console.warn('[RelayListCache] NDK not available');
      return results;
    }
    
    // Fetch kind:10002 events
    const events = await Promise.race([
      ndk.fetchEvents({
        kinds: [10002],
        authors: pubkeys
      }),
      new Promise<Set<NDKEvent>>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), CONFIG.NETWORK_TIMEOUT_MS)
      )
    ]);
    
    const now = Date.now();
    
    for (const event of events) {
      const relayList = parseNip65Event(event);
      
      const cached: CachedRelayList = {
        pubkey: event.pubkey,
        read: relayList.read,
        write: relayList.write,
        updatedAt: relayList.updatedAt,
        fetchedAt: now,
        eventCreatedAt: (event.created_at || 0) * 1000
      };
      
      results.set(event.pubkey, cached);
      
      // Update memory cache
      memoryCache.set(event.pubkey, cached);
    }
    
    // Store negative results for pubkeys that didn't have relay lists
    // This prevents repeatedly fetching for users without NIP-65
    for (const pubkey of pubkeys) {
      if (!results.has(pubkey)) {
        const emptyCache: CachedRelayList = {
          pubkey,
          read: [],
          write: [],
          updatedAt: now,
          fetchedAt: now,
          eventCreatedAt: 0
        };
        results.set(pubkey, emptyCache);
        memoryCache.set(pubkey, emptyCache);
      }
    }
    
    // Persist to IndexedDB (fire and forget)
    dbPutMany([...results.values()]).catch(() => {});
    
    pruneMemoryCache();
    
  } catch (err) {
    if ((err as Error).message !== 'Timeout') {
      console.warn('[RelayListCache] Network fetch error:', err);
    }
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// CACHE MANAGER CLASS
// ═══════════════════════════════════════════════════════════════

class RelayListCacheManager implements RelayListCache {
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  
  constructor() {
    if (browser) {
      // Start periodic cleanup
      this.cleanupInterval = setInterval(() => {
        cleanupOldEntries().catch(() => {});
      }, CONFIG.CLEANUP_INTERVAL_MS);
      
      // Initialize DB on construction
      initDB().catch(() => {});
    }
  }
  
  /**
   * Get relay list for a single pubkey
   * 
   * Strategy:
   * 1. Check memory cache first (fastest)
   * 2. Check IndexedDB if not in memory
   * 3. Fetch from network if missing or stale
   * 4. For stale entries: return stale data immediately, refresh in background
   */
  async get(pubkey: string): Promise<RelayList | null> {
    if (!pubkey) return null;
    
    // 1. Check memory cache
    const memoryCached = memoryCache.get(pubkey);
    
    if (memoryCached) {
      // Fresh in memory - return immediately
      if (!isStale(memoryCached)) {
        return this.toRelayList(memoryCached);
      }
      
      // Stale but not hard expired - return stale, refresh in background
      if (!isHardExpired(memoryCached)) {
        this.backgroundRefresh([pubkey]);
        return this.toRelayList(memoryCached);
      }
    }
    
    // 2. Check IndexedDB
    const dbCached = await dbGet(pubkey);
    
    if (dbCached) {
      // Populate memory cache
      memoryCache.set(pubkey, dbCached);
      
      // Fresh - return immediately
      if (!isStale(dbCached)) {
        return this.toRelayList(dbCached);
      }
      
      // Stale but not hard expired - return stale, refresh in background
      if (!isHardExpired(dbCached)) {
        this.backgroundRefresh([pubkey]);
        return this.toRelayList(dbCached);
      }
    }
    
    // 3. Fetch from network
    const fetched = await this.fetchWithDedup(pubkey);
    return fetched;
  }
  
  /**
   * Get relay lists for multiple pubkeys
   * 
   * Optimized batch fetching - groups network requests
   */
  async getMany(pubkeys: string[]): Promise<Map<string, RelayList>> {
    if (pubkeys.length === 0) return new Map();
    
    const results = new Map<string, RelayList>();
    const needsDbLookup: string[] = [];
    const needsNetworkFetch: string[] = [];
    const staleToRefresh: string[] = [];
    
    // 1. Check memory cache for all pubkeys
    for (const pubkey of pubkeys) {
      const cached = memoryCache.get(pubkey);
      
      if (cached) {
        if (!isStale(cached)) {
          results.set(pubkey, this.toRelayList(cached));
        } else if (!isHardExpired(cached)) {
          // Stale but usable - return now, refresh later
          results.set(pubkey, this.toRelayList(cached));
          staleToRefresh.push(pubkey);
        } else {
          needsNetworkFetch.push(pubkey);
        }
      } else {
        needsDbLookup.push(pubkey);
      }
    }
    
    // 2. Batch lookup from IndexedDB
    if (needsDbLookup.length > 0) {
      const dbResults = await dbGetMany(needsDbLookup);
      
      for (const pubkey of needsDbLookup) {
        const cached = dbResults.get(pubkey);
        
        if (cached) {
          memoryCache.set(pubkey, cached);
          
          if (!isStale(cached)) {
            results.set(pubkey, this.toRelayList(cached));
          } else if (!isHardExpired(cached)) {
            results.set(pubkey, this.toRelayList(cached));
            staleToRefresh.push(pubkey);
          } else {
            needsNetworkFetch.push(pubkey);
          }
        } else {
          needsNetworkFetch.push(pubkey);
        }
      }
    }
    
    // 3. Batch fetch from network
    if (needsNetworkFetch.length > 0) {
      // Fetch in batches to avoid overwhelming relays
      for (let i = 0; i < needsNetworkFetch.length; i += CONFIG.BATCH_SIZE) {
        const batch = needsNetworkFetch.slice(i, i + CONFIG.BATCH_SIZE);
        const networkResults = await fetchFromNetwork(batch);
        
        for (const [pubkey, cached] of networkResults) {
          results.set(pubkey, this.toRelayList(cached));
        }
      }
    }
    
    // 4. Background refresh stale entries
    if (staleToRefresh.length > 0) {
      this.backgroundRefresh(staleToRefresh);
    }
    
    return results;
  }
  
  /**
   * Fire-and-forget prefetch for a list of pubkeys
   * 
   * Useful for prefetching relay lists when loading a feed
   */
  prefetch(pubkeys: string[]): void {
    if (pubkeys.length === 0) return;
    
    // Add to batch queue
    for (const pubkey of pubkeys) {
      // Skip if we have fresh data in memory
      const cached = memoryCache.get(pubkey);
      if (cached && !isStale(cached)) continue;
      
      batchQueue.add(pubkey);
    }
    
    // Debounce batch processing
    if (batchTimeout) {
      clearTimeout(batchTimeout);
    }
    
    batchTimeout = setTimeout(() => {
      this.processPrefetchBatch();
    }, CONFIG.PREFETCH_DEBOUNCE_MS);
  }
  
  /**
   * Invalidate cache for a specific pubkey
   * 
   * Called when we see a newer kind:10002 event
   */
  invalidate(pubkey: string): void {
    memoryCache.delete(pubkey);
    dbDelete(pubkey).catch(() => {});
    inFlightFetches.delete(pubkey);
  }
  
  /**
   * Invalidate if event is newer than cached
   * 
   * Returns true if cache was invalidated
   */
  invalidateIfNewer(pubkey: string, eventCreatedAt: number): boolean {
    const cached = memoryCache.get(pubkey);
    
    if (cached && eventCreatedAt > cached.eventCreatedAt / 1000) {
      this.invalidate(pubkey);
      return true;
    }
    
    return false;
  }
  
  /**
   * Clear all cached data
   */
  async clear(): Promise<void> {
    memoryCache.clear();
    inFlightFetches.clear();
    batchQueue.clear();
    
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }
    
    await dbClear();
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    memorySize: number;
    inFlightCount: number;
    batchQueueSize: number;
  } {
    return {
      memorySize: memoryCache.size,
      inFlightCount: inFlightFetches.size,
      batchQueueSize: batchQueue.size
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════
  
  private toRelayList(cached: CachedRelayList): RelayList {
    return {
      read: cached.read,
      write: cached.write,
      updatedAt: cached.updatedAt
    };
  }
  
  private async fetchWithDedup(pubkey: string): Promise<RelayList | null> {
    // Check if already fetching
    const existing = inFlightFetches.get(pubkey);
    if (existing) {
      return existing;
    }
    
    // Create fetch promise
    const fetchPromise = (async () => {
      try {
        const results = await fetchFromNetwork([pubkey]);
        const cached = results.get(pubkey);
        return cached ? this.toRelayList(cached) : null;
      } finally {
        inFlightFetches.delete(pubkey);
      }
    })();
    
    inFlightFetches.set(pubkey, fetchPromise);
    return fetchPromise;
  }
  
  private backgroundRefresh(pubkeys: string[]): void {
    // Don't block - just queue for refresh
    setTimeout(async () => {
      const toRefresh = pubkeys.filter(pk => !inFlightFetches.has(pk));
      
      if (toRefresh.length > 0) {
        for (let i = 0; i < toRefresh.length; i += CONFIG.BATCH_SIZE) {
          const batch = toRefresh.slice(i, i + CONFIG.BATCH_SIZE);
          await fetchFromNetwork(batch).catch(() => {});
        }
      }
    }, 0);
  }
  
  private async processPrefetchBatch(): Promise<void> {
    const pubkeys = [...batchQueue].slice(0, CONFIG.MAX_PREFETCH_BATCH);
    batchQueue.clear();
    
    if (pubkeys.length === 0) return;
    
    // Filter out pubkeys that are already being fetched
    const toFetch = pubkeys.filter(pk => !inFlightFetches.has(pk));
    
    if (toFetch.length === 0) return;
    
    console.debug(`[RelayListCache] Prefetching ${toFetch.length} relay lists`);
    
    // Check IndexedDB first
    const dbResults = await dbGetMany(toFetch);
    const needsNetwork: string[] = [];
    
    for (const pubkey of toFetch) {
      const cached = dbResults.get(pubkey);
      
      if (cached) {
        memoryCache.set(pubkey, cached);
        
        if (isHardExpired(cached)) {
          needsNetwork.push(pubkey);
        }
      } else {
        needsNetwork.push(pubkey);
      }
    }
    
    // Fetch missing from network
    if (needsNetwork.length > 0) {
      for (let i = 0; i < needsNetwork.length; i += CONFIG.BATCH_SIZE) {
        const batch = needsNetwork.slice(i, i + CONFIG.BATCH_SIZE);
        await fetchFromNetwork(batch).catch(() => {});
      }
    }
  }
  
  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════

export const relayListCache = new RelayListCacheManager();

// ═══════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Get write relays (outbox) for a user
 * These are the relays where the user publishes their events
 */
export async function getOutboxRelays(pubkey: string): Promise<string[]> {
  const relayList = await relayListCache.get(pubkey);
  return relayList?.write || [];
}

/**
 * Get read relays (inbox) for a user  
 * These are the relays where the user reads mentions/tags
 */
export async function getInboxRelays(pubkey: string): Promise<string[]> {
  const relayList = await relayListCache.get(pubkey);
  return relayList?.read || [];
}

/**
 * Get all relays for a user (both read and write, deduplicated)
 */
export async function getAllRelays(pubkey: string): Promise<string[]> {
  const relayList = await relayListCache.get(pubkey);
  if (!relayList) return [];
  
  const all = new Set([...relayList.read, ...relayList.write]);
  return [...all];
}

/**
 * Batch get outbox relays for multiple users
 * Returns a Map of pubkey -> write relays
 */
export async function getOutboxRelaysMany(pubkeys: string[]): Promise<Map<string, string[]>> {
  const relayLists = await relayListCache.getMany(pubkeys);
  const result = new Map<string, string[]>();
  
  for (const [pubkey, relayList] of relayLists) {
    result.set(pubkey, relayList.write);
  }
  
  return result;
}

/**
 * Handle incoming kind:10002 event - invalidate cache if newer
 */
export function handleRelayListEvent(event: NDKEvent): void {
  if (event.kind !== 10002) return;
  
  relayListCache.invalidateIfNewer(event.pubkey, event.created_at || 0);
}

