import { nip19 } from 'nostr-tools';
import { ndk } from './nostr';
import type { NDKUserProfile, NDK } from '@nostr-dev-kit/ndk';

// Types for profile data
export interface ProfileData {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  lud16?: string;
  lastFetched: number;
}

// Cache interface
interface ProfileCache {
  [pubkey: string]: ProfileData;
}

// Cache configuration
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 1000;

// In-memory cache
let profileCache: ProfileCache = {};

// Cache management functions
function isCacheValid(profile: ProfileData): boolean {
  return Date.now() - profile.lastFetched < CACHE_DURATION;
}

function cleanupCache(): void {
  const now = Date.now();
  const entries = Object.entries(profileCache);
  
  if (entries.length > MAX_CACHE_SIZE) {
    // Sort by lastFetched and remove oldest entries
    entries.sort((a, b) => a[1].lastFetched - b[1].lastFetched);
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    
    toRemove.forEach(([pubkey]) => {
      delete profileCache[pubkey];
    });
  }
  
  // Remove expired entries
  Object.keys(profileCache).forEach(pubkey => {
    if (!isCacheValid(profileCache[pubkey])) {
      delete profileCache[pubkey];
    }
  });
}

// Decode nostr profile string to get pubkey
export function decodeNostrProfile(nostrString: string): string | null {
  try {
    if (!nostrString.startsWith('nostr:nprofile1')) {
      return null;
    }
    
    const decoded = nip19.decode(nostrString.replace('nostr:', ''));
    if (decoded.type === 'nprofile') {
      return decoded.data.pubkey;
    }
    return null;
  } catch (error) {
    console.warn('Failed to decode nostr profile:', error);
    return null;
  }
}

// Fetch profile data from relays
async function fetchProfileFromRelays(pubkey: string, ndkInstance: NDK): Promise<ProfileData | null> {
  try {
    if (!ndkInstance) {
      console.warn('NDK not available for profile fetch');
      return null;
    }

    if (!pubkey) {
      console.warn('No pubkey provided for profile fetch');
      return null;
    }

    // Get user profile using NDK
    const user = ndkInstance.getUser({ hexpubkey: pubkey });
    await user.fetchProfile();
    
    const profile = user.profile;
    if (!profile) {
      return null;
    }

    return {
      pubkey,
      name: profile.name,
      display_name: profile.displayName,
      picture: profile.image,
      about: profile.bio,
      nip05: profile.nip05,
      lud16: profile.lud16,
      lastFetched: Date.now()
    };
  } catch (error) {
    console.warn(`Failed to fetch profile for ${pubkey}:`, error);
    return null;
  }
}

// Main function to resolve profile data
export async function resolveProfile(nostrString: string, ndkInstance: NDK): Promise<ProfileData | null> {
  try {
    if (!nostrString) {
      console.warn('No nostr string provided for profile resolution');
      return null;
    }

    if (!ndkInstance) {
      console.warn('No NDK instance provided for profile resolution');
      return null;
    }

    const pubkey = decodeNostrProfile(nostrString);
    if (!pubkey) {
      return null;
    }

    // Check cache first
    const cached = profileCache[pubkey];
    if (cached && isCacheValid(cached)) {
      return cached;
    }

    // Fetch from relays
    const profile = await fetchProfileFromRelays(pubkey, ndkInstance);
    if (profile) {
      profileCache[pubkey] = profile;
      cleanupCache();
    }

    return profile;
  } catch (error) {
    console.warn('Error in resolveProfile:', error);
    return null;
  }
}

// Get display name for a profile
export function getDisplayName(profile: ProfileData | null): string {
  if (!profile) {
    return 'Anonymous';
  }

  // Priority: display_name > name > truncated pubkey
  if (profile.display_name) {
    return profile.display_name;
  }
  
  if (profile.name) {
    return profile.name;
  }

  // Fallback to truncated pubkey
  return `@${profile.pubkey.slice(0, 8)}...${profile.pubkey.slice(-4)}`;
}

// Format display name with @ prefix
export function formatDisplayName(profile: ProfileData | null): string {
  const name = getDisplayName(profile);
  return name.startsWith('@') ? name : `@${name}`;
}

// Batch resolve multiple profiles
export async function resolveProfiles(nostrStrings: string[], ndkInstance: NDK): Promise<Map<string, ProfileData | null>> {
  const results = new Map<string, ProfileData | null>();
  
  // Process in parallel with a reasonable concurrency limit
  const batchSize = 10;
  for (let i = 0; i < nostrStrings.length; i += batchSize) {
    const batch = nostrStrings.slice(i, i + batchSize);
    const promises = batch.map(async (nostrString) => {
      const profile = await resolveProfile(nostrString, ndkInstance);
      return { nostrString, profile };
    });
    
    const batchResults = await Promise.all(promises);
    batchResults.forEach(({ nostrString, profile }) => {
      results.set(nostrString, profile);
    });
  }
  
  return results;
}

// Clear cache (useful for testing or manual refresh)
export function clearProfileCache(): void {
  profileCache = {};
}

// Get cache stats (useful for debugging)
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: Object.keys(profileCache).length,
    entries: Object.keys(profileCache)
  };
}
