/**
 * Centralized cache for follow list profiles
 * Prevents multiple components from fetching the same data
 */
import { writable, get } from 'svelte/store';
import { ndk, userPublickey } from '$lib/nostr';
import { nip19 } from 'nostr-tools';
import type NDK from '@nostr-dev-kit/ndk';

export interface CachedProfile {
  name: string;
  npub: string;
  picture?: string;
  pubkey: string;
  nip05?: string;
}

// Singleton cache
const profileCache = new Map<string, CachedProfile>();
let isLoading = false;
let isLoaded = false;
let loadPromise: Promise<void> | null = null;

// Store to notify components when cache is updated
export const followListReady = writable(false);
export const followListSize = writable(0);

/**
 * Load follow list profiles (only loads once, subsequent calls return cached data)
 */
export async function loadFollowListProfiles(): Promise<Map<string, CachedProfile>> {
  // Return existing cache if already loaded
  if (isLoaded) {
    return profileCache;
  }
  
  // If currently loading, wait for it to finish
  if (loadPromise) {
    await loadPromise;
    return profileCache;
  }
  
  // Start loading
  isLoading = true;
  loadPromise = doLoadFollowList();
  
  try {
    await loadPromise;
  } finally {
    isLoading = false;
    loadPromise = null;
  }
  
  return profileCache;
}

async function doLoadFollowList(): Promise<void> {
  const pubkey = get(userPublickey);
  const ndkInstance = get(ndk);
  
  if (!pubkey || !ndkInstance) {
    return;
  }
  
  try {
    // Fetch the user's contact list (kind 3)
    const contactEvent = await ndkInstance.fetchEvent({
      kinds: [3],
      authors: [pubkey],
      limit: 1
    });
    
    if (!contactEvent) {
      isLoaded = true;
      followListReady.set(true);
      return;
    }
    
    // Extract all follow pubkeys
    const followPubkeys = contactEvent.tags
      .filter(t => t[0] === 'p' && t[1])
      .map(t => t[1]);
    
    if (followPubkeys.length === 0) {
      isLoaded = true;
      followListReady.set(true);
      return;
    }
    
    // Fetch profiles in batches
    const batchSize = 100;
    for (let i = 0; i < followPubkeys.length; i += batchSize) {
      const batch = followPubkeys.slice(i, i + batchSize);
      
      try {
        const events = await ndkInstance.fetchEvents({
          kinds: [0],
          authors: batch
        });
        
        for (const event of events) {
          try {
            const profile = JSON.parse(event.content);
            const name = profile.display_name || profile.name || '';
            const nip05 = profile.nip05;
            
            if (name || nip05) {
              profileCache.set(event.pubkey, {
                name: name || nip05?.split('@')[0] || 'Unknown',
                npub: nip19.npubEncode(event.pubkey),
                picture: profile.picture,
                pubkey: event.pubkey,
                nip05
              });
            }
          } catch {}
        }
        
        // Update size as we load
        followListSize.set(profileCache.size);
      } catch (e) {
        console.debug('[FollowListCache] Failed to fetch profile batch:', e);
      }
    }
    
    isLoaded = true;
    followListReady.set(true);
    console.log(`[FollowListCache] Loaded ${profileCache.size} profiles`);
  } catch (e) {
    console.debug('[FollowListCache] Failed to load follow list:', e);
    isLoaded = true;
    followListReady.set(true);
  }
}

/**
 * Get the cached profiles (does not trigger load)
 */
export function getProfileCache(): Map<string, CachedProfile> {
  return profileCache;
}

/**
 * Add a profile to the cache (e.g., from network search)
 */
export function addToCache(profile: CachedProfile): void {
  profileCache.set(profile.pubkey, profile);
  followListSize.set(profileCache.size);
}

/**
 * Search profiles in the cache
 */
export function searchCachedProfiles(query: string, limit: number = 10): CachedProfile[] {
  if (!query) {
    return Array.from(profileCache.values()).slice(0, limit);
  }
  
  const queryLower = query.toLowerCase();
  const matches: CachedProfile[] = [];
  
  for (const profile of profileCache.values()) {
    const nameMatch = profile.name.toLowerCase().includes(queryLower);
    const nip05Match = profile.nip05?.toLowerCase().includes(queryLower);
    
    if (nameMatch || nip05Match) {
      matches.push(profile);
    }
  }
  
  // Sort: exact name match first, then NIP-05, then alphabetical
  matches.sort((a, b) => {
    const aNameLower = a.name.toLowerCase();
    const bNameLower = b.name.toLowerCase();
    const aNip05Lower = a.nip05?.toLowerCase() || '';
    const bNip05Lower = b.nip05?.toLowerCase() || '';

    const aNameStarts = aNameLower.startsWith(queryLower);
    const bNameStarts = bNameLower.startsWith(queryLower);
    const aNip05Starts = aNip05Lower.startsWith(queryLower);
    const bNip05Starts = bNip05Lower.startsWith(queryLower);

    if (aNameStarts && !bNameStarts) return -1;
    if (!aNameStarts && bNameStarts) return 1;
    if (aNip05Starts && !bNip05Starts) return -1;
    if (!aNip05Starts && bNip05Starts) return 1;

    return aNameLower.localeCompare(bNameLower);
  });
  
  return matches.slice(0, limit);
}

/**
 * Check if cache is loaded
 */
export function isCacheLoaded(): boolean {
  return isLoaded;
}

/**
 * Reset the cache (e.g., when user changes)
 */
export function resetCache(): void {
  profileCache.clear();
  isLoaded = false;
  isLoading = false;
  loadPromise = null;
  followListReady.set(false);
  followListSize.set(0);
}

