import { nip19 } from 'nostr-tools';
import { browser } from '$app/environment';
import { getPrimalCache, type PrimalProfile } from '$lib/primalCache';

export interface SearchProfile {
  pubkey: string;
  npub: string;
  name?: string;
  displayName?: string;
  picture?: string;
  nip05?: string;
  about?: string;
}

class ProfileCache {
  private cache = new Map<string, SearchProfile>();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  get(pubkey: string): SearchProfile | undefined {
    const profile = this.cache.get(pubkey);
    if (profile) {
      this.cache.delete(pubkey);
      this.cache.set(pubkey, profile);
    }
    return profile;
  }

  set(pubkey: string, profile: SearchProfile): void {
    if (this.cache.has(pubkey)) {
      this.cache.delete(pubkey);
    }
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(pubkey, profile);
  }

  clear(): void {
    this.cache.clear();
  }
}

const profileCache = new ProfileCache(100);

function toSearchProfile(profile: PrimalProfile): SearchProfile {
  return {
    pubkey: profile.pubkey,
    npub: nip19.npubEncode(profile.pubkey),
    name: profile.name,
    displayName: profile.display_name,
    picture: profile.picture,
    nip05: profile.nip05,
    about: profile.about
  };
}

export function parseIdentifier(input: string): { pubkey: string; relays?: string[] } | null {
  const trimmed = input.trim().replace(/^@/, '').replace(/^nostr:/, '');

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { pubkey: trimmed.toLowerCase() };
  }

  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === 'npub') {
      return { pubkey: decoded.data };
    }
    if (decoded.type === 'nprofile') {
      return { pubkey: decoded.data.pubkey, relays: decoded.data.relays };
    }
  } catch {}

  return null;
}

export function formatNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
  } catch {
    return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
  }
}

export function getDisplayName(profile: SearchProfile): string {
  return profile.displayName || profile.name || formatNpub(profile.pubkey);
}

export async function searchProfiles(query: string, limit: number = 10): Promise<SearchProfile[]> {
  if (!browser || !query) {
    return [];
  }

  const parsed = parseIdentifier(query);
  if (parsed) {
    const cached = profileCache.get(parsed.pubkey);
    if (cached) {
      return [cached];
    }

    const primal = getPrimalCache();
    if (primal) {
      try {
        const profile = await primal.fetchProfile(parsed.pubkey);
        if (profile) {
          const searchProfile = toSearchProfile(profile);
          profileCache.set(parsed.pubkey, searchProfile);
          return [searchProfile];
        }
      } catch (error) {
        console.error('[ProfileSearch] Error fetching profile:', error);
      }
    }

    return [
      {
        pubkey: parsed.pubkey,
        npub: nip19.npubEncode(parsed.pubkey)
      }
    ];
  }

  if (query.length < 2) {
    return [];
  }

  const primal = getPrimalCache();
  if (!primal) {
    return [];
  }

  try {
    const results = await primal.searchProfiles(query, limit);

    const filtered = results.filter((profile) => !profile.nip05?.endsWith('@mostr.pub'));

    const searchResults = filtered.map(toSearchProfile);
    searchResults.forEach((profile) => profileCache.set(profile.pubkey, profile));

    return searchResults;
  } catch (error) {
    console.error('[ProfileSearch] Search error:', error);
    return [];
  }
}

export async function fetchProfile(pubkey: string): Promise<SearchProfile | null> {
  const cached = profileCache.get(pubkey);
  if (cached) {
    return cached;
  }

  const primal = getPrimalCache();
  if (!primal) {
    return null;
  }

  try {
    const profile = await primal.fetchProfile(pubkey);
    if (profile) {
      const searchProfile = toSearchProfile(profile);
      profileCache.set(pubkey, searchProfile);
      return searchProfile;
    }
  } catch (error) {
    console.error('[ProfileSearch] Error fetching profile:', error);
  }

  return null;
}

export function getCachedProfile(pubkey: string): SearchProfile | undefined {
  return profileCache.get(pubkey);
}

export function clearProfileCache(): void {
  profileCache.clear();
}
