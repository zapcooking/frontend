import { writable, get, type Readable, type Writable } from 'svelte/store';
import { nip19 } from 'nostr-tools';
import { browser } from '$app/environment';
import { ndk } from './nostr';
import {
  formatDisplayName,
  isProfileMissConfirmed,
  onProfileCached,
  resolveProfileByPubkey,
  resolveProfiles,
  type ProfileData
} from './profileResolver';
import { getAnonChefName } from './anonName';

/**
 * Reactive per-pubkey profile state on top of profileResolver.
 *
 * Each hex pubkey gets its own small store, created on first subscribe,
 * so a row only hears about its own author: a 50-row feed resolving in
 * one batch is 50 updates, not 50×50, and a late profile for author A
 * never touches rows for author B.
 *
 *   loading      — asked, no answer yet (render a skeleton)
 *   found        — a kind:0 arrived; also set when a profile enters the
 *                  resolver cache through any other lookup or a seed
 *   missing      — a CONFIRMED miss (#853: purplepag.es answered without
 *                  the author) — the only state that shows an anon name
 *   unconfirmed  — relays didn't answer, even after one retry (short npub)
 *
 * An unconfirmed `null` is retried once, PROFILE_RETRY_DELAY_MS later.
 * When the last subscriber leaves, a pending retry is cancelled, and
 * missing/unconfirmed entries are dropped so a later mount asks again.
 * Found entries are kept (bounded) so remounts render the name at once;
 * a remount then reconciles with the resolver in case it refreshed the
 * profile while nothing was listening.
 */
export type ProfileState =
  | { status: 'loading' }
  | { status: 'found'; profile: ProfileData }
  | { status: 'missing' }
  | { status: 'unconfirmed' };

export const PROFILE_RETRY_DELAY_MS = 4000;
const MAX_KEPT_PROFILES = 1000;

interface Entry {
  store: Writable<ProfileState>;
  state: ProfileState;
  subscribers: number;
  requested: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  /** false once dropped: late results for it must not write anything. */
  alive: boolean;
}

const entries = new Map<string, Entry>();
let activeSubscribers = 0;
let stopListening: (() => void) | null = null;

// Callers check entry.alive first (request, its retry timer, onCached):
// a dropped entry never gets another write.
function setState(entry: Entry, state: ProfileState): void {
  entry.state = state;
  entry.store.set(state);
}

function clearRetry(entry: Entry): void {
  if (entry.retryTimer) {
    clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
  }
}

function onCached(pubkey: string, profile: ProfileData): void {
  const entry = entries.get(pubkey);
  if (!entry || !entry.alive) return;
  clearRetry(entry);
  setState(entry, { status: 'found', profile });
}

async function request(pubkey: string, entry: Entry, isRetry: boolean): Promise<void> {
  entry.requested = true;
  let profile: ProfileData | null = null;
  try {
    const ndkInstance = get(ndk);
    profile = ndkInstance ? await resolveProfileByPubkey(pubkey, ndkInstance) : null;
  } catch {
    profile = null;
  }
  // Dropped while in flight: never write.
  if (!entry.alive) return;
  if (entry.state.status === 'found') {
    // Already showing a name (from onCached, or a retained entry being
    // reconciled on remount). Take the result only if it's a different,
    // at-least-as-new profile — never a downgrade to a miss, and never
    // over a newer listener update. A cache hit returns the same object,
    // so it causes no notification.
    const current = entry.state.profile;
    if (profile && profile !== current && (profile.lastFetched ?? 0) >= (current.lastFetched ?? 0)) {
      setState(entry, { status: 'found', profile });
    }
    return;
  }
  if (profile) {
    setState(entry, { status: 'found', profile });
    return;
  }
  // Every null — fetched, or answered from the resolver's miss cache
  // without a batch — is checked against the confirmed-miss flag.
  if (isProfileMissConfirmed(pubkey)) {
    setState(entry, { status: 'missing' });
    return;
  }
  if (isRetry) {
    setState(entry, { status: 'unconfirmed' });
    return;
  }
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null;
    if (entry.alive && entry.state.status === 'loading') void request(pubkey, entry, true);
  }, PROFILE_RETRY_DELAY_MS);
}

function evictKeptProfiles(): void {
  if (entries.size <= MAX_KEPT_PROFILES) return;
  for (const [pubkey, entry] of entries) {
    if (entries.size <= MAX_KEPT_PROFILES) break;
    if (entry.subscribers === 0) {
      entry.alive = false;
      entries.delete(pubkey);
    }
  }
}

function acquire(pubkey: string): Entry {
  let entry = entries.get(pubkey);
  if (!entry) {
    const state: ProfileState = { status: 'loading' };
    entry = {
      store: writable(state),
      state,
      subscribers: 0,
      requested: false,
      retryTimer: null,
      alive: true
    };
    entries.set(pubkey, entry);
  }
  entry.subscribers++;
  activeSubscribers++;
  // Counted first, so eviction can't pick the entry being acquired even
  // when every other entry is mounted.
  evictKeptProfiles();
  // No fetches, timers or listeners during SSR: the server renders the
  // loading state (a skeleton) and the browser takes over.
  if (browser) {
    if (!stopListening) stopListening = onProfileCached(onCached);
    if (!entry.requested) {
      void request(pubkey, entry, false);
    } else if (entry.subscribers === 1 && entry.state.status === 'found') {
      // A retained name being remounted: nothing was listening while it
      // had no subscribers, so reconcile with the resolver (a cache hit,
      // or a fetch once the cache entry has expired). The current name
      // stays on screen meanwhile.
      void request(pubkey, entry, false);
    }
  }
  return entry;
}

function release(pubkey: string, entry: Entry): void {
  entry.subscribers--;
  activeSubscribers--;
  if (entry.subscribers === 0) {
    clearRetry(entry);
    if (entry.state.status !== 'found') {
      entry.alive = false;
      if (entries.get(pubkey) === entry) entries.delete(pubkey);
    }
  }
  if (activeSubscribers === 0 && stopListening) {
    stopListening();
    stopListening = null;
  }
}

/** Reactive profile state for one hex pubkey. */
export function profileFor(pubkey: string): Readable<ProfileState> {
  return {
    subscribe(run, invalidate) {
      const entry = acquire(pubkey);
      const unsubscribe = entry.store.subscribe(run, invalidate);
      return () => {
        unsubscribe();
        release(pubkey, entry);
      };
    }
  };
}

/**
 * Warm the resolver for nostr profile references (nprofile/npub strings)
 * — e.g. mentions in note content — so their names are ready when shown.
 */
export async function prefetchProfiles(nostrStrings: string[]): Promise<void> {
  if (!browser || nostrStrings.length === 0) return;
  const ndkInstance = get(ndk);
  if (!ndkInstance) return;
  try {
    await resolveProfiles(nostrStrings, ndkInstance);
  } catch {
    /* prefetch is best-effort */
  }
}

/** A real, truncated npub (nip19-encoded, not "npub1" + hex). */
export function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return 'npub…';
  }
}

/**
 * What an author label shows for a given state: a skeleton while
 * resolving, the profile name when found, the anon pool name only for a
 * confirmed miss, and a short npub when relays never answered.
 */
export function authorLabel(
  pubkey: string,
  state: ProfileState | undefined | null
): { kind: 'skeleton' } | { kind: 'text'; text: string } {
  if (!pubkey) return { kind: 'text', text: getAnonChefName(null) };
  switch (state?.status) {
    case 'found':
      return { kind: 'text', text: formatDisplayName(state.profile) || getAnonChefName(pubkey) };
    case 'missing':
      return { kind: 'text', text: getAnonChefName(pubkey) };
    case 'unconfirmed':
      return { kind: 'text', text: shortNpub(pubkey) };
    default:
      return { kind: 'skeleton' };
  }
}

/** Test hook: drop every entry and the cache listener. */
export function __resetProfileStore(): void {
  for (const entry of entries.values()) {
    clearRetry(entry);
    entry.alive = false;
  }
  entries.clear();
  activeSubscribers = 0;
  stopListening?.();
  stopListening = null;
}

/** Test hook: internal counts for leak assertions. */
export function __profileStoreStats(): { entries: number; listening: boolean; pendingRetries: number } {
  let pendingRetries = 0;
  for (const entry of entries.values()) if (entry.retryTimer) pendingRetries++;
  return { entries: entries.size, listening: stopListening !== null, pendingRetries };
}
