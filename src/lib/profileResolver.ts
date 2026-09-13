import { nip19 } from 'nostr-tools';
import { ndk } from './nostr';
import type { NDKUserProfile, NDKRelaySet, NDKEvent } from '@nostr-dev-kit/ndk';
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
  /** CLINK static offer bech32 string (noffer1…). Written by bxrd.app's
   * profile editor; we surface a Pay affordance when present.
   * See https://github.com/shocknet/CLINK/blob/main/specs/clink-offers.md */
  noffer?: string;
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
  return decodeNostrProfileFull(nostrString)?.pubkey ?? null;
}

// Decode nostr profile string to get pubkey AND any embedded relay hints.
export function decodeNostrProfileFull(nostrString: string): { pubkey: string; relays: string[] } | null {
  try {
    // The `nostr:` prefix is optional: several clients emit prefix-less
    // references and NoteContent now parses them, so rejecting them here
    // would leave a bare npub1/nprofile1 rendering as raw bech32 (issue
    // #637). nip19.decode below is still the real validation.
    const token = nostrString.replace(/^nostr:/, '');
    if (!token.startsWith('nprofile1') && !token.startsWith('npub1')) {
      return null;
    }
    const decoded = nip19.decode(token);
    if (decoded.type === 'nprofile') {
      return { pubkey: decoded.data.pubkey, relays: decoded.data.relays ?? [] };
    } else if (decoded.type === 'npub') {
      return { pubkey: decoded.data, relays: [] };
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
 * happen to live on nos.lol / damus / primal silently 404 and render
 * as the anon-chef fallback. nostr.wine is a common secondary mirror.
 */
const PROFILE_RELAY_URLS = [
  'wss://purplepag.es',
  'wss://nostr.wine'
];

// ─── Batched kind:0 fetching ─────────────────────────────────────────
// ProfileLink, AuthorName, CommentCard and friends each resolve profiles
// on mount, and each resolve used to fire its own kind:0 fetchEvent
// across the pool + profile relays — a 50-author feed opened ~50 REQs
// against ~6 relays apiece. Resolves now coalesce: per-pubkey
// single-flight, plus a short collection window that fetches queued
// pubkeys together in chunked authors:[...] REQs (relays cap filter
// sizes; 50 per REQ is safely below every limit).
const PROFILE_BATCH_WINDOW_MS = 150;
const PROFILE_BATCH_CHUNK = 50;
const inflightProfileFetches = new Map<string, Promise<ProfileData | null>>();

interface ProfileBatchEntry {
  pubkey: string;
  hintRelays?: string[];
  resolve: (profile: ProfileData | null) => void;
}
let profileBatchQueue: ProfileBatchEntry[] = [];
let profileBatchTimer: ReturnType<typeof setTimeout> | null = null;

/** Pool relays + canonical profile relays + the batch's nprofile hints. */
async function buildProfileRelaySet(
  ndkInstance: NDK,
  hintRelayLists: Array<string[] | undefined>
): Promise<NDKRelaySet | undefined> {
  const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
  const relayUrls = new Set<string>();
  if (ndkInstance.pool?.relays) {
    for (const [url] of ndkInstance.pool.relays) relayUrls.add(url);
  }
  for (const url of PROFILE_RELAY_URLS) relayUrls.add(url);
  for (const hints of hintRelayLists) {
    if (hints) for (const url of hints) relayUrls.add(url);
  }

  const relays = [];
  for (const url of relayUrls) {
    // getRelay(url, connect, temporary) — NDK 2.10.0. Creation is
    // unconditional when the relay is missing; the third argument is
    // temporary, which arms a 30s removal timer (skipped for relays in
    // explicitRelayUrls). purplepag.es etc. may not be in the pool yet;
    // this opens a connection in the background. fetchEvents will queue
    // against not-yet-ready relays and resolve at EOSE.
    const relay = ndkInstance.pool?.getRelay(url, true, true);
    if (relay) relays.push(relay);
  }
  return relays.length > 0 ? new NDKRelaySet(new Set(relays), ndkInstance) : undefined;
}

async function flushProfileBatch(ndkInstance: NDK): Promise<void> {
  const queue = profileBatchQueue;
  profileBatchQueue = [];
  if (queue.length === 0) return;

  const eventsByPubkey = new Map<string, NDKEvent>();
  try {
    const pubkeys = [...new Set(queue.map((entry) => entry.pubkey))];
    for (let i = 0; i < pubkeys.length; i += PROFILE_BATCH_CHUNK) {
      const chunk = pubkeys.slice(i, i + PROFILE_BATCH_CHUNK);
      const relaySet = await buildProfileRelaySet(
        ndkInstance,
        queue.filter((e) => chunk.includes(e.pubkey)).map((e) => e.hintRelays)
      );
      const fetchPromise = ndkInstance.fetchEvents(
        { kinds: [0], authors: chunk },
        undefined,
        relaySet
      );
      const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) =>
        setTimeout(() => resolve(new Set()), PROFILE_FETCH_TIMEOUT)
      );
      const events = await Promise.race([fetchPromise, timeoutPromise]);

      // A pubkey may have several kind:0 events (republished profiles);
      // keep the newest by created_at, matching fetchEvent's behavior.
      for (const event of events) {
        if (!event.pubkey) continue;
        const existing = eventsByPubkey.get(event.pubkey);
        if (!existing || (event.created_at || 0) > (existing.created_at || 0)) {
          eventsByPubkey.set(event.pubkey, event);
        }
      }
    }

    for (const entry of queue) {
      const event = eventsByPubkey.get(entry.pubkey);
      entry.resolve(event ? parseProfileEvent(entry.pubkey, event) : null);
    }
  } catch {
    // Profile fetch errors are common and non-critical — resolve what we
    // never fetched as null rather than rejecting.
    for (const entry of queue) {
      entry.resolve(eventsByPubkey.has(entry.pubkey)
        ? parseProfileEvent(entry.pubkey, eventsByPubkey.get(entry.pubkey)!)
        : null);
    }
  }
}

// Fetch profile data from relays (batched — see the batching block above)
function fetchProfileFromRelays(pubkey: string, ndkInstance: NDK, hintRelays?: string[]): Promise<ProfileData | null> {
  if (!ndkInstance || !pubkey) {
    return Promise.resolve(null);
  }

  const inflight = inflightProfileFetches.get(pubkey);
  if (inflight) return inflight;

  const promise = new Promise<ProfileData | null>((resolve) => {
    profileBatchQueue.push({ pubkey, hintRelays, resolve });
    if (profileBatchTimer === null) {
      profileBatchTimer = setTimeout(() => {
        profileBatchTimer = null;
        void flushProfileBatch(ndkInstance);
      }, PROFILE_BATCH_WINDOW_MS);
    }
  }).finally(() => inflightProfileFetches.delete(pubkey));

  inflightProfileFetches.set(pubkey, promise);
  return promise;
}

// Parse a kind:0 event into ProfileData. Returns null on malformed
// content rather than a half-populated profile that would obscure the
// user's identity.
function parseProfileEvent(pubkey: string, event: NDKEvent): ProfileData | null {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(event.content || '{}');
  } catch {
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

  // CLINK noffer: the field key isn't formally standardised yet — bxrd.app's
  // profile editor labels it "CLINK offer (noffer)" and most likely writes it
  // as `noffer`, but accept `offer` and `clink_offer` as fallbacks so we
  // don't lose data if the key name diverges. The value must start with
  // `noffer1` to be considered valid (so we don't pick up unrelated fields).
  const rawNoffer =
    (typeof parsed.noffer === 'string' && parsed.noffer) ||
    (typeof parsed.offer === 'string' && parsed.offer) ||
    (typeof parsed.clink_offer === 'string' && parsed.clink_offer) ||
    undefined;
  const noffer =
    rawNoffer && /^(nostr:)?noffer1/i.test(rawNoffer.trim()) ? rawNoffer.trim() : undefined;

  return {
    pubkey,
    name,
    display_name: displayName,
    picture: typeof parsed.picture === 'string' ? parsed.picture : undefined,
    about: typeof parsed.about === 'string' ? parsed.about : undefined,
    nip05: typeof parsed.nip05 === 'string' ? parsed.nip05 : undefined,
    lud16: typeof parsed.lud16 === 'string' ? parsed.lud16 : undefined,
    noffer,
    lastFetched: Date.now()
  };
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

    const decoded = decodeNostrProfileFull(nostrString);
    if (!decoded) {
      return null;
    }
    const { pubkey, relays: hintRelays } = decoded;

    // Check cache first
    const cached = profileCache[pubkey];
    if (cached && isCacheValid(cached)) {
      return cached;
    }

    // Fetch from relays, including any hint relays embedded in the nprofile.
    const profile = await fetchProfileFromRelays(pubkey, ndkInstance, hintRelays);
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

// Pre-populate the cache with a known profile (e.g. from mention autocomplete)
// so ProfileLink can resolve it immediately without a relay fetch.
export function seedProfileCache(pubkey: string, data: { name?: string; display_name?: string; picture?: string; nip05?: string }): void {
  if (!pubkey) return;
  const existing = profileCache[pubkey];
  if (existing && isCacheValid(existing)) return;
  profileCache[pubkey] = { pubkey, ...data, lastFetched: Date.now() };
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
