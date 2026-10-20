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
  banner?: string;
  about?: string;
  nip05?: string;
  lud16?: string;
  /** CLINK static offer bech32 string (noffer1…). Written by bxrd.app's
   * profile editor; we surface a Pay affordance when present.
   * See https://github.com/shocknet/CLINK/blob/main/specs/clink-offers.md */
  noffer?: string;
  /** created_at of the kind:0 this was parsed from — the profile's
   * version. Absent for seeded entries, which count as oldest. Compare
   * versions on this, never on lastFetched (our fetch time: a later
   * fetch can return an older kind:0 from a stale relay). */
  created_at?: number;
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

// Every profile that enters the cache — a relay fetch or a seed — is
// announced here, so already-mounted UI (profileStore) can pick up a
// profile that arrived through some other component's lookup.
type ProfileCachedListener = (pubkey: string, profile: ProfileData) => void;
const profileCachedListeners = new Set<ProfileCachedListener>();

/** Subscribe to profiles entering the cache; returns an unsubscribe. */
export function onProfileCached(listener: ProfileCachedListener): () => void {
  profileCachedListeners.add(listener);
  return () => {
    profileCachedListeners.delete(listener);
  };
}

function cacheProfile(pubkey: string, profile: ProfileData): void {
  profileCache[pubkey] = profile;
  for (const listener of [...profileCachedListeners]) {
    try {
      listener(pubkey, profile);
    } catch (error) {
      console.warn('profile cache listener failed:', error);
    }
  }
}

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

// Profile fetch timeout: the longest the pool pass waits for its
// subscription to settle. On expiry it resolves with whatever it has
// collected; it never discards events that already arrived.
const PROFILE_FETCH_TIMEOUT = 5000; // 5 seconds

/**
 * Relays added to the pool pass (one authors:[...] filter), on top of
 * NDK's pool and any nprofile hints, so users with a custom relay list
 * still reach common profile mirrors.
 */
const PROFILE_RELAY_URLS = [
  'wss://relay.primal.net',
  'wss://nostr.wine'
];

/**
 * purplepag.es — the de-facto kind:0 relay — gets its own request.
 *
 * It returns roughly one event per requested author per REQ AND keeps
 * old kind:0 versions, so an authors:[50] filter comes back as 50 events
 * covering only ~25 pubkeys (accounts that republish their profile eat
 * the budget; `limit` doesn't change it, and NIP-11 doesn't say). One
 * filter per author (limit 1) in a single REQ resolved 91/100 feed
 * authors vs 51 — and purplepag held every profile that existed
 * anywhere. Per-author filters go to purplepag ONLY: relay.damus.io
 * drops the connection on a 50-filter REQ.
 *
 * The pass runs in parallel with the pool pass, waits (bounded) for the
 * relay to actually connect — NDK's early-EOSE rule doesn't count relays
 * that are still connecting, so a not-yet-connected purplepag used to be
 * cut off — and reports whether its answer is a confirmed one.
 */
const PURPLEPAG_URL = 'wss://purplepag.es';
const PURPLEPAG_CONNECT_TIMEOUT = 3000;
const PURPLEPAG_REQ_TIMEOUT = 4000;
/** Max per-author filters in one REQ — the size verified against purplepag. */
const PURPLEPAG_MAX_FILTERS = 50;

/**
 * Confirmed misses: purplepag connected, answered EOSE without the
 * author, and nothing else had it either. Cached briefly so a feed full
 * of profile-less authors doesn't re-query on every mount. Unconfirmed
 * misses (purplepag down, slow, CLOSED, NOTICE) are never cached — the
 * next resolve retries. Any positive result clears the entry.
 */
const MISS_CACHE_DURATION = 60 * 1000;
const confirmedMisses = new Map<string, number>();

/**
 * Whether `pubkey` is a confirmed miss right now (purplepag.es answered
 * without it; see confirmedMisses). Read-only: lets callers that got
 * `null` tell "no profile exists" from "relays didn't answer".
 */
export function isProfileMissConfirmed(pubkey: string): boolean {
  return isConfirmedMiss(pubkey);
}

function isConfirmedMiss(pubkey: string): boolean {
  const expiry = confirmedMisses.get(pubkey);
  if (expiry === undefined) return false;
  if (Date.now() < expiry) return true;
  confirmedMisses.delete(pubkey);
  return false;
}

/**
 * Dedupe key for a relay URL: scheme and host are case-insensitive (URL
 * lowercases them), but path and query are not — wss://r.example/Profile
 * and wss://r.example/profile are different endpoints. Trailing slashes
 * are dropped so wss://purplepag.es and wss://purplepag.es/ match.
 */
function relayKey(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim().replace(/\/+$/, '');
  }
}

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

/** Pool relays + profile mirrors + the batch's nprofile hints (not purplepag). */
async function buildProfileRelaySet(
  ndkInstance: NDK,
  hintRelayLists: Array<string[] | undefined>
): Promise<NDKRelaySet | undefined> {
  const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
  const relayUrls = new Map<string, string>();
  const add = (url: string) => {
    const key = relayKey(url);
    // purplepag has its own per-author request (see PURPLEPAG_URL).
    if (key !== relayKey(PURPLEPAG_URL) && !relayUrls.has(key)) relayUrls.set(key, url);
  };
  if (ndkInstance.pool?.relays) {
    for (const [url] of ndkInstance.pool.relays) add(url);
  }
  for (const url of PROFILE_RELAY_URLS) add(url);
  for (const hints of hintRelayLists) {
    if (hints) for (const url of hints) add(url);
  }

  const relays = [];
  for (const url of relayUrls.values()) {
    // getRelay(url, connect, temporary) — NDK 2.10.0. Creation is
    // unconditional when the relay is missing; the third argument is
    // temporary, which arms a 30s removal timer (skipped for relays in
    // explicitRelayUrls).
    const relay = ndkInstance.pool?.getRelay(url, true, true);
    if (relay) relays.push(relay);
  }
  return relays.length > 0 ? new NDKRelaySet(new Set(relays), ndkInstance) : undefined;
}

/** Keep the newest kind:0 per pubkey (profiles get republished). */
function keepNewest(into: Map<string, NDKEvent>, event: NDKEvent): void {
  if (!event?.pubkey) return;
  const existing = into.get(event.pubkey);
  if (!existing || (event.created_at || 0) > (existing.created_at || 0)) {
    into.set(event.pubkey, event);
  }
}

/**
 * Pool pass: one authors:[...] REQ across the pool relay set. Events are
 * collected as they stream; it settles on NDK's EOSE or the timeout and
 * keeps everything received either way (fetchEvents + a timeout that
 * resolved to an empty Set used to drop a whole chunk).
 */
function runPoolPass(
  ndkInstance: NDK,
  chunk: string[],
  relaySet: NDKRelaySet | undefined,
  into: Map<string, NDKEvent>
): Promise<void> {
  return new Promise((resolve) => {
    let sub: ReturnType<NDK['subscribe']> | undefined;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub?.stop();
      resolve();
    };
    const timer = setTimeout(finish, PROFILE_FETCH_TIMEOUT);
    try {
      sub = ndkInstance.subscribe(
        { kinds: [0], authors: chunk },
        { closeOnEose: false, groupable: false },
        relaySet,
        false
      );
      sub.on('event', (event: NDKEvent) => keepNewest(into, event));
      sub.on('eose', finish);
      Promise.resolve(sub.start()).catch(finish);
    } catch {
      finish();
    }
  });
}

/** Resolve true once the relay is connected, false after `timeoutMs`. */
function waitForConnected(relay: any, connectedStatus: number, timeoutMs: number): Promise<boolean> {
  if (relay.status >= connectedStatus) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onReady = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      relay.off?.('ready', onReady);
      resolve(relay.status >= connectedStatus);
    }, timeoutMs);
    relay.once('ready', onReady);
  });
}

/**
 * purplepag pass: one REQ with a {kinds:[0], authors:[pk], limit:1}
 * filter per author (≤ PURPLEPAG_MAX_FILTERS). Resolves true only when
 * purplepag connected and sent EOSE for every REQ with no CLOSED or
 * NOTICE — i.e. its silence about an author is a confirmed miss.
 */
async function runPurplepagPass(
  ndkInstance: NDK,
  chunk: string[],
  into: Map<string, NDKEvent>
): Promise<boolean> {
  const { NDKRelaySet, NDKRelayStatus, NDKSubscriptionCacheUsage } = await import(
    '@nostr-dev-kit/ndk'
  );
  const relay: any = ndkInstance.pool?.getRelay(PURPLEPAG_URL, true, true);
  if (!relay) return false;
  if (!(await waitForConnected(relay, NDKRelayStatus.CONNECTED, PURPLEPAG_CONNECT_TIMEOUT))) {
    return false;
  }

  const requestSlice = (pubkeys: string[]) =>
    new Promise<boolean>((resolve) => {
      let sub: ReturnType<NDK['subscribe']> | undefined;
      let done = false;
      let noticed = false;
      const onNotice = () => {
        noticed = true;
      };
      const finish = (confirmed: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        relay.off?.('notice', onNotice);
        sub?.stop();
        resolve(confirmed && !noticed);
      };
      const timer = setTimeout(() => finish(false), PURPLEPAG_REQ_TIMEOUT);
      relay.on?.('notice', onNotice);
      try {
        // groupable:false + an explicit single-relay set: NDK sends these
        // as ONE REQ with separate filters (compileFilters only merges
        // across grouped subscriptions). ONLY_RELAY: 'eose' then comes
        // from purplepag itself, never from the cache.
        sub = ndkInstance.subscribe(
          pubkeys.map((pk) => ({ kinds: [0], authors: [pk], limit: 1 })),
          {
            closeOnEose: false,
            groupable: false,
            cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY
          },
          new NDKRelaySet(new Set([relay]), ndkInstance),
          false
        );
        sub.on('event', (event: NDKEvent) => keepNewest(into, event));
        sub.on('eose', () => finish(true));
        sub.on('closed', () => finish(false));
        Promise.resolve(sub.start()).catch(() => finish(false));
      } catch {
        finish(false);
      }
    });

  const slices: string[][] = [];
  for (let i = 0; i < chunk.length; i += PURPLEPAG_MAX_FILTERS) {
    slices.push(chunk.slice(i, i + PURPLEPAG_MAX_FILTERS));
  }
  const results = await Promise.all(slices.map(requestSlice));
  return results.every(Boolean);
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
      // Both passes start together and write into the same map, so the
      // newest kind:0 wins across them. purplepag-only authors (10–25%
      // of a feed) don't wait behind the pool pass.
      const [, purplepagConfirmed] = await Promise.all([
        runPoolPass(ndkInstance, chunk, relaySet, eventsByPubkey),
        runPurplepagPass(ndkInstance, chunk, eventsByPubkey).catch(() => false)
      ]);
      if (purplepagConfirmed) {
        const expiry = Date.now() + MISS_CACHE_DURATION;
        for (const pk of chunk) if (!eventsByPubkey.has(pk)) confirmedMisses.set(pk, expiry);
      }
    }

    for (const entry of queue) {
      const event = eventsByPubkey.get(entry.pubkey);
      if (event) confirmedMisses.delete(entry.pubkey);
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
  // A cached miss covers the relays that were asked, not an nprofile's
  // hints — a lookup that brings relay hints always goes to the relays.
  if (!hintRelays?.length && isConfirmedMiss(pubkey)) return Promise.resolve(null);

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
    banner: typeof parsed.banner === 'string' ? parsed.banner : undefined,
    about: typeof parsed.about === 'string' ? parsed.about : undefined,
    nip05: typeof parsed.nip05 === 'string' ? parsed.nip05 : undefined,
    lud16: typeof parsed.lud16 === 'string' ? parsed.lud16 : undefined,
    noffer,
    created_at: typeof event.created_at === 'number' ? event.created_at : undefined,
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
      cacheProfile(pubkey, profile);
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
      cacheProfile(pubkey, profile);
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
  confirmedMisses.delete(pubkey);
  cacheProfile(pubkey, { pubkey, ...data, lastFetched: Date.now() });
}

// Clear cache (useful for testing or manual refresh)
export function clearProfileCache(): void {
  profileCache = {};
  confirmedMisses.clear();
}

// Get cache stats (useful for debugging)
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: Object.keys(profileCache).length,
    entries: Object.keys(profileCache)
  };
}
