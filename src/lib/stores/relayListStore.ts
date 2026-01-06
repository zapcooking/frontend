/**
 * Svelte Store for NIP-65 Relay Lists
 * 
 * Provides reactive access to relay list data with automatic caching.
 * Uses the relayListCache for all data fetching and caching logic.
 * 
 * Usage in Svelte components:
 * ```svelte
 * <script>
 *   import { getRelayListStore, prefetchRelayLists } from '$lib/stores/relayListStore';
 *   
 *   export let pubkey: string;
 *   
 *   $: relayStore = getRelayListStore(pubkey);
 *   $: relayList = $relayStore;
 *   
 *   // For feed prefetching
 *   onMount(() => {
 *     prefetchRelayLists(authorPubkeys);
 *   });
 * </script>
 * 
 * {#if relayList.loading}
 *   <span>Loading relays...</span>
 * {:else if relayList.data}
 *   <span>Writes to: {relayList.data.write.join(', ')}</span>
 * {/if}
 * ```
 */

import { writable, type Writable, type Readable, derived } from 'svelte/store';
import { 
  relayListCache, 
  type RelayList,
  getOutboxRelays,
  getInboxRelays
} from '$lib/relayListCache';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RelayListStoreData {
  data: RelayList | null;
  loading: boolean;
  error: string | null;
}

// ═══════════════════════════════════════════════════════════════
// STORE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

const relayListStores = new Map<string, Writable<RelayListStoreData>>();
const fetchPromises = new Map<string, Promise<void>>();

const defaultData: RelayListStoreData = {
  data: null,
  loading: true,
  error: null
};

/**
 * Get or create a reactive store for a pubkey's relay list
 * 
 * The store automatically fetches data from cache/network on first access.
 */
export function getRelayListStore(pubkey: string): Readable<RelayListStoreData> {
  if (!pubkey) {
    return writable({ data: null, loading: false, error: 'No pubkey provided' });
  }
  
  if (!relayListStores.has(pubkey)) {
    const store = writable<RelayListStoreData>({ ...defaultData });
    relayListStores.set(pubkey, store);
    
    // Start fetching
    fetchRelayList(pubkey, store);
  }
  
  return relayListStores.get(pubkey)!;
}

/**
 * Get stores for multiple pubkeys at once
 */
export function getRelayListStores(pubkeys: string[]): Map<string, Readable<RelayListStoreData>> {
  const stores = new Map<string, Readable<RelayListStoreData>>();
  
  for (const pubkey of pubkeys) {
    stores.set(pubkey, getRelayListStore(pubkey));
  }
  
  return stores;
}

/**
 * Create a derived store that combines multiple relay lists
 */
export function getCombinedRelayListStore(pubkeys: string[]): Readable<{
  loading: boolean;
  relayLists: Map<string, RelayList>;
  allWriteRelays: string[];
  allReadRelays: string[];
}> {
  const stores = pubkeys.map(pk => getRelayListStore(pk));
  
  return derived(stores, ($stores) => {
    const relayLists = new Map<string, RelayList>();
    let loading = false;
    const writeSet = new Set<string>();
    const readSet = new Set<string>();
    
    for (let i = 0; i < $stores.length; i++) {
      const store = $stores[i];
      const pubkey = pubkeys[i];
      
      if (store.loading) {
        loading = true;
      }
      
      if (store.data) {
        relayLists.set(pubkey, store.data);
        store.data.write.forEach(r => writeSet.add(r));
        store.data.read.forEach(r => readSet.add(r));
      }
    }
    
    return {
      loading,
      relayLists,
      allWriteRelays: [...writeSet],
      allReadRelays: [...readSet]
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// FETCHING
// ═══════════════════════════════════════════════════════════════

async function fetchRelayList(pubkey: string, store: Writable<RelayListStoreData>): Promise<void> {
  // Prevent duplicate fetches
  if (fetchPromises.has(pubkey)) {
    await fetchPromises.get(pubkey);
    return;
  }
  
  const fetchPromise = (async () => {
    try {
      const relayList = await relayListCache.get(pubkey);
      
      store.set({
        data: relayList,
        loading: false,
        error: null
      });
    } catch (err) {
      console.warn('[RelayListStore] Fetch error:', err);
      store.set({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch relay list'
      });
    } finally {
      fetchPromises.delete(pubkey);
    }
  })();
  
  fetchPromises.set(pubkey, fetchPromise);
  await fetchPromise;
}

/**
 * Prefetch relay lists for multiple pubkeys (fire-and-forget)
 * 
 * Call this when loading a feed to prefetch relay lists for all visible authors.
 * Does not block rendering.
 */
export function prefetchRelayLists(pubkeys: string[]): void {
  // Filter out pubkeys we already have stores for with non-loading state
  const toPrefetch = pubkeys.filter(pk => {
    const store = relayListStores.get(pk);
    // Prefetch if no store exists (hasn't been accessed yet)
    return !store;
  });
  
  if (toPrefetch.length > 0) {
    relayListCache.prefetch(toPrefetch);
  }
}

/**
 * Batch fetch relay lists and populate stores
 * 
 * Use this when you need to wait for multiple relay lists to be available
 */
export async function batchFetchRelayLists(pubkeys: string[]): Promise<Map<string, RelayList>> {
  const results = await relayListCache.getMany(pubkeys);
  
  // Update stores
  for (const [pubkey, relayList] of results) {
    const store = relayListStores.get(pubkey);
    if (store) {
      store.set({
        data: relayList,
        loading: false,
        error: null
      });
    }
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// INVALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Invalidate and refetch a specific pubkey's relay list
 */
export function invalidateRelayList(pubkey: string): void {
  relayListCache.invalidate(pubkey);
  
  const store = relayListStores.get(pubkey);
  if (store) {
    store.set({ ...defaultData });
    fetchRelayList(pubkey, store);
  }
}

/**
 * Clear all relay list stores
 */
export function clearAllRelayListStores(): void {
  relayListStores.clear();
  fetchPromises.clear();
}

/**
 * Clear the entire cache (both stores and underlying cache)
 */
export async function clearRelayListCache(): Promise<void> {
  clearAllRelayListStores();
  await relayListCache.clear();
}

// ═══════════════════════════════════════════════════════════════
// CONVENIENCE EXPORTS
// ═══════════════════════════════════════════════════════════════

// Re-export from cache for convenience
export { getOutboxRelays, getInboxRelays };

// Cache stats for debugging
export function getRelayListCacheStats() {
  return {
    ...relayListCache.getStats(),
    storeCount: relayListStores.size
  };
}

