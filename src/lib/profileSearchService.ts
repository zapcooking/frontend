import { nip19 } from 'nostr-tools';
import { browser } from '$app/environment';
import { getPrimalCache, type PrimalProfile } from '$lib/primalCache';
import { naSuggest } from '$lib/nostrArchives';

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

/**
 * Order profiles for a name query: exact name, name prefix, exact NIP-05
 * local part, NIP-05 prefix, then the rest, each tier in the order the
 * indexes returned them (their own relevance rank).
 */
export function rankProfiles(query: string, profiles: SearchProfile[]): SearchProfile[] {
  const q = query.trim().replace(/^@/, '').toLowerCase();
  const tier = (p: SearchProfile): number => {
    const names = [p.displayName, p.name].filter(Boolean).map((n) => n!.toLowerCase());
    if (names.some((n) => n === q)) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    const local = p.nip05?.split('@')[0]?.toLowerCase();
    if (local === q) return 2;
    if (local?.startsWith(q)) return 3;
    return 4;
  };
  return profiles
    .map((p, i) => ({ p, i, t: tier(p) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.p);
}

export interface SearchProfilesOptions {
  /**
   * Called with the ranked, limited merge each time an index answers, so a
   * caller can paint the fast index without waiting for the slow one.
   * Not called after the search settles (use the returned promise).
   */
  onPartial?: (profiles: SearchProfile[]) => void;
}

export async function searchProfiles(
  query: string,
  limit: number = 10,
  options: SearchProfilesOptions = {}
): Promise<SearchProfile[]> {
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

  // Two independent indexes, run concurrently (sidecar's merge): the
  // slower one must not delay the faster one, and either failing (or
  // being unavailable — Primal's cache can be null) just means fewer
  // results. Primal's rows go first within a tier when both answered.
  const primalRows: SearchProfile[] = [];
  const naRows: SearchProfile[] = [];
  let settled = false;
  const merged = (): SearchProfile[] => {
    const seen = new Set<string>();
    const out: SearchProfile[] = [];
    for (const p of [...primalRows, ...naRows]) {
      if (seen.has(p.pubkey)) continue;
      seen.add(p.pubkey);
      out.push(p);
    }
    return rankProfiles(query, out).slice(0, limit);
  };
  const partial = () => {
    if (!settled) options.onPartial?.(merged());
  };
  const row = (pubkey: string, data: Omit<SearchProfile, 'pubkey' | 'npub'>): SearchProfile => {
    const profile: SearchProfile = { pubkey, npub: nip19.npubEncode(pubkey), ...data };
    profileCache.set(pubkey, profile);
    return profile;
  };

  const primal = getPrimalCache();
  await Promise.allSettled([
    (primal ? primal.searchProfiles(query, limit) : Promise.resolve([] as PrimalProfile[])).then(
      (results) => {
        for (const profile of results) {
          if (profile.nip05?.endsWith('@mostr.pub')) continue;
          primalRows.push(
            row(profile.pubkey, {
              name: profile.name,
              displayName: profile.display_name,
              picture: profile.picture,
              nip05: profile.nip05,
              about: profile.about
            })
          );
        }
        partial();
      },
      (error) => console.error('[ProfileSearch] Search error:', error)
    ),
    naSuggest(query).then((results) => {
      for (const s of results) {
        naRows.push(
          row(s.pubkey, { name: s.name, picture: s.picture || undefined, nip05: s.nip05 || undefined })
        );
      }
      partial();
    })
  ]);
  settled = true;
  return merged();
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
