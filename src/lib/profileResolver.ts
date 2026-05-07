import { nip19 } from 'nostr-tools';
import { ndk } from './nostr';
import type { NDKUserProfile } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';
import { getAnonChefName } from './anonName';

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
    // Handle both nprofile1 and npub1 formats
    if (!nostrString.startsWith('nostr:nprofile1') && !nostrString.startsWith('nostr:npub1')) {
      return null;
    }
    
    const decoded = nip19.decode(nostrString.replace('nostr:', ''));
    if (decoded.type === 'nprofile') {
      return decoded.data.pubkey;
    } else if (decoded.type === 'npub') {
      return decoded.data;
    }
    return null;
  } catch (error) {
    console.warn('Failed to decode nostr profile:', error);
    return null;
  }
}

// Profile fetch timeout
const PROFILE_FETCH_TIMEOUT = 5000; // 5 seconds

/**
 * Relays we'll always consult for kind:0 lookups, in addition to NDK's
 * default pool. Purplepag.es is the de-facto Nostr profile relay —
 * many users publish kind:0 there (or it's the only relay their
 * NIP-65 client targeted). Without including it, profiles that don't
 * happen to live on garden / nos.lol / damus / primal silently 404
 * and render as the anon-chef fallback. nostr.wine is a common
 * secondary mirror.
 */
const PROFILE_RELAY_URLS = [
  'wss://purplepag.es',
  'wss://nostr.wine'
];

// Fetch profile data from relays
async function fetchProfileFromRelays(pubkey: string, ndkInstance: NDK): Promise<ProfileData | null> {
  try {
    if (!ndkInstance) {
      return null;
    }

    if (!pubkey) {
      return null;
    }

    // Build an explicit relay set: NDK's connected pool relays
    // (whatever the page already has open — garden, nos.lol, damus,
    // primal in default mode) plus the canonical profile relays.
    // NDK's `user.fetchProfile()` doesn't let us widen the relay set,
    // so we drop down to fetchEvent + parse the kind:0 manually.
    const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
    const relayUrls = new Set<string>();
    if (ndkInstance.pool?.relays) {
      for (const [url] of ndkInstance.pool.relays) relayUrls.add(url);
    }
    for (const url of PROFILE_RELAY_URLS) relayUrls.add(url);

    const relays = [];
    for (const url of relayUrls) {
      // autoConnect=true, createIfMissing=true — purplepag.es etc.
      // may not be in the pool yet; this opens a connection in the
      // background. fetchEvent will queue against not-yet-ready
      // relays and resolve when any of them returns.
      const relay = ndkInstance.pool?.getRelay(url, true, true);
      if (relay) relays.push(relay);
    }
    const relaySet = relays.length > 0 ? new NDKRelaySet(new Set(relays), ndkInstance) : undefined;

    const fetchPromise = ndkInstance.fetchEvent(
      { kinds: [0], authors: [pubkey] },
      undefined,
      relaySet
    );
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), PROFILE_FETCH_TIMEOUT)
    );

    const event = await Promise.race([fetchPromise, timeoutPromise]);
    if (!event) {
      return null;
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(event.content || '{}');
    } catch {
      // Malformed kind:0 content — return null rather than a
      // half-populated profile that would obscure the user's identity.
      return null;
    }

    // Nostr profile field naming has historically varied: NIP-01 says
    // `name`, but many clients also (or only) populate `display_name`,
    // and a few use camelCase `displayName`. Read all three so we
    // surface the user's identity regardless of which client wrote
    // their kind:0.
    const name =
      typeof parsed.name === 'string' ? parsed.name : undefined;
    const displayName =
      typeof parsed.display_name === 'string'
        ? (parsed.display_name as string)
        : typeof parsed.displayName === 'string'
        ? (parsed.displayName as string)
        : undefined;

    const profileData: ProfileData = {
      pubkey,
      name,
      display_name: displayName,
      picture: typeof parsed.picture === 'string' ? parsed.picture : undefined,
      about: typeof parsed.about === 'string' ? parsed.about : undefined,
      nip05: typeof parsed.nip05 === 'string' ? parsed.nip05 : undefined,
      lud16: typeof parsed.lud16 === 'string' ? parsed.lud16 : undefined,
      lastFetched: Date.now()
    };

    return profileData;
  } catch (error) {
    // Silently fail - profile fetch errors are common and non-critical
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

// Resolve profile by pubkey directly (for npub strings)
export async function resolveProfileByPubkey(pubkey: string, ndkInstance: NDK): Promise<ProfileData | null> {
  try {
    if (!pubkey) {
      console.warn('No pubkey provided for profile resolution');
      return null;
    }

    if (!ndkInstance) {
      console.warn('No NDK instance provided for profile resolution');
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
    console.warn('Error in resolveProfileByPubkey:', error);
    return null;
  }
}

// Get display name for a profile.
//
// Falls back to a friendly per-pubkey "Anon Chef" name (see
// $lib/anonName) when the profile is missing or has no name fields.
// Old recipes whose authors deleted their kind:0 metadata used to
// render as "Anonymous" or a truncated hex; the anon helper makes
// them feel attributed instead of broken.
//
// Callers that have a bare pubkey but no ProfileData object should
// import `getAnonChefName` directly rather than passing `null` here —
// the null path can't compute a stable per-pubkey name and returns
// the generic 'Anon Chef'.
export function getDisplayName(profile: ProfileData | null): string {
  if (!profile) {
    return getAnonChefName(null);
  }

  // Priority: display_name > name > anon fallback (hash-stable per pubkey)
  if (profile.display_name) {
    return profile.display_name;
  }

  if (profile.name) {
    return profile.name;
  }

  return getAnonChefName(profile.pubkey);
}

// Get username for a profile (without @ prefix). Same fallback policy
// as getDisplayName: display_name → name → anon. Previously this only
// checked `name`, which silently fell back to the anon helper for
// profiles that set only `display_name` (a common shape on Nostr —
// "display_name" is the human-readable identity, "name" is the optional
// short handle). formatDisplayName, AuthorName, ProfileLink, and the
// feed all flow through here, so the fix lights up display_name-only
// profiles everywhere at once.
export function getUsername(profile: ProfileData | null): string {
  if (!profile) {
    return getAnonChefName(null);
  }

  if (profile.display_name) {
    return profile.display_name;
  }

  if (profile.name) {
    return profile.name;
  }

  return getAnonChefName(profile.pubkey);
}

// Format display name with @ prefix
export function formatDisplayName(profile: ProfileData | null): string {
  return getUsername(profile);
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
