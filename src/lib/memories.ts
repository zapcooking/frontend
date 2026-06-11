/**
 * Memories — "On this day" service.
 *
 * Finds the logged-in user's own kind 1 (text note) posts from this same
 * calendar day 1, 2, and 3 years ago, fetched from relays, with a daily
 * localStorage cache so relays are queried at most once per day per user.
 *
 * NOTE: this module deliberately avoids static imports of `$lib/nostr` and
 * `$app/environment` so its pure helpers (`getMemoryWindows`, `isReplyNote`)
 * stay importable under vitest's node environment (the `$app` alias is not
 * available there). `getCurrentRelayGeneration` is loaded via dynamic import
 * at fetch time instead, matching the dynamic-import style used elsewhere.
 */

import type NDK from '@nostr-dev-kit/ndk';
import {
  NDKEvent,
  NDKRelaySet,
  type NDKFilter,
  type NostrEvent
} from '@nostr-dev-kit/ndk';
import { standardRelays } from './consts';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface MemoryWindow {
  yearsAgo: number;
  /** Unix seconds, 00:00:00 local time on the target day */
  since: number;
  /** Unix seconds, 23:59:59 local time on the target day */
  until: number;
}

export interface MemoryGroup {
  yearsAgo: number;
  /** Start of the target day, local time */
  date: Date;
  events: NDKEvent[];
  /**
   * How the window's subscription resolved. 'timeout' means relays never
   * sent EOSE, so an empty result may just mean "relays didn't answer" —
   * callers use this to decide whether an empty day is cacheable.
   */
  resolvedVia: 'eose' | 'timeout';
}

// ═══════════════════════════════════════════════════════════════
// DATE WINDOWS (pure)
// ═══════════════════════════════════════════════════════════════

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Local-time day windows for 1, 2, and 3 years before `now`.
 * Feb 29 falls back to Feb 28 in non-leap target years.
 */
export function getMemoryWindows(now: Date): MemoryWindow[] {
  const windows: MemoryWindow[] = [];
  const month = now.getMonth();
  const dayOfMonth = now.getDate();

  for (const yearsAgo of [1, 2, 3]) {
    const year = now.getFullYear() - yearsAgo;
    let day = dayOfMonth;
    if (month === 1 && day === 29 && !isLeapYear(year)) {
      day = 28;
    }
    const start = new Date(year, month, day, 0, 0, 0, 0);
    const end = new Date(year, month, day, 23, 59, 59, 0);
    windows.push({
      yearsAgo,
      since: Math.floor(start.getTime() / 1000),
      until: Math.floor(end.getTime() / 1000)
    });
  }

  return windows;
}

// ═══════════════════════════════════════════════════════════════
// REPLY PREDICATE (pure, NIP-10 aware)
// ═══════════════════════════════════════════════════════════════

/**
 * True if the event is a reply per NIP-10: it has an `e` tag marked
 * `root`/`reply`, an unmarked `e` tag (legacy positional reply), or an
 * `e` tag with an unknown marker. Mention-only `e` tags and `q`-tag
 * quotes are NOT replies.
 *
 * Mirrors the semantics of the feed's reply filter
 * (FoodstrFeedOptimized.svelte) as a pure, testable function.
 */
export function isReplyNote(event: { tags: string[][] }): boolean {
  const eTags = event.tags.filter(
    (tag) => Array.isArray(tag) && tag[0] === 'e' && tag[1]
  );
  if (eTags.length === 0) return false;

  return eTags.some((tag) => {
    const marker = tag[3]?.toLowerCase();
    if (marker === 'mention') return false;
    // 'root', 'reply', unmarked, or unknown marker → treat as reply
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════
// RELAY FETCH
// ═══════════════════════════════════════════════════════════════

/** Archive-friendly relays queried in addition to the standard set. */
const ARCHIVE_RELAYS = [
  'wss://relay.damus.io',
  'wss://nostr.wine',
  'wss://relay.primal.net'
];

const WINDOW_FETCH_TIMEOUT_MS = 10000;

function memoryRelayUrls(): string[] {
  return [...new Set([...standardRelays, ...ARCHIVE_RELAYS])];
}

function emptyGroup(window: MemoryWindow): MemoryGroup {
  return {
    yearsAgo: window.yearsAgo,
    date: new Date(window.since * 1000),
    events: [],
    resolvedVia: 'timeout'
  };
}

/**
 * Fetch one window's events. Follows the subscribe → collect on 'event' →
 * resolve on 'eose' with a timeout fallback pattern from the user profile
 * page's loadMedia(). Never rejects; resolves with an empty group on error.
 */
function fetchWindow(
  ndk: NDK,
  pubkey: string,
  window: MemoryWindow,
  relaySet: NDKRelaySet
): Promise<MemoryGroup> {
  return new Promise((resolve) => {
    const filter: NDKFilter = {
      kinds: [1],
      authors: [pubkey],
      since: window.since,
      until: window.until,
      limit: 50
    };

    let subscription;
    try {
      subscription = ndk.subscribe(filter, { closeOnEose: true }, relaySet);
    } catch (error) {
      console.error('[memories] Failed to subscribe for window', window.yearsAgo, error);
      resolve(emptyGroup(window));
      return;
    }

    const collected = new Map<string, NDKEvent>();
    let resolved = false;

    const finish = (resolvedVia: 'eose' | 'timeout') => {
      if (resolved) return;
      resolved = true;
      subscription.stop();

      const events = [...collected.values()]
        .filter((ev) => !isReplyNote(ev) && (ev.content?.trim().length ?? 0) > 0)
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

      resolve({
        yearsAgo: window.yearsAgo,
        date: new Date(window.since * 1000),
        events,
        resolvedVia
      });
    };

    subscription.on('event', (ev: NDKEvent) => {
      if (!collected.has(ev.id)) {
        collected.set(ev.id, ev);
      }
    });

    subscription.on('eose', () => finish('eose'));
    setTimeout(() => finish('timeout'), WINDOW_FETCH_TIMEOUT_MS);
  });
}

/**
 * Fetch memories for all three windows in parallel. Empty groups are
 * normal (relays prune old events); never throws on empty. If the relay
 * generation changes mid-flight, results are discarded (empty groups).
 */
export async function fetchMemories(
  ndk: NDK,
  pubkey: string,
  now: Date = new Date()
): Promise<MemoryGroup[]> {
  const windows = getMemoryWindows(now);

  const { getCurrentRelayGeneration, ensureNdkConnected } = await import('./nostr');

  // Don't start subscriptions while NDK is still connecting — they'd all
  // time out and read as "no memories today". Centralized here so every
  // caller (card mount, /memories load, refresh) is gated the same way.
  // ensureNdkConnected resolves on its own timeout, but awaiting ndkReady
  // inside it can reject if the initial connection failed — swallow that
  // to preserve this function's never-throw contract (windows would then
  // resolve via timeout and correctly not be cached).
  try {
    await ensureNdkConnected();
  } catch (error) {
    console.warn('[memories] Proceeding without confirmed NDK connection:', error);
  }

  const startGeneration = getCurrentRelayGeneration();

  const relaySet = NDKRelaySet.fromRelayUrls(memoryRelayUrls(), ndk, false);
  const groups = await Promise.all(
    windows.map((window) => fetchWindow(ndk, pubkey, window, relaySet))
  );

  if (getCurrentRelayGeneration() !== startGeneration) {
    // Relays switched mid-flight; results may mix relay sets. Discard.
    return windows.map(emptyGroup);
  }

  return groups;
}

// ═══════════════════════════════════════════════════════════════
// DAILY CACHE
// ═══════════════════════════════════════════════════════════════

const CACHE_PREFIX = 'zap_memories_';
const DISMISS_PREFIX = 'zap_memories_dismissed_';

interface StoredMemoryGroup {
  yearsAgo: number;
  date: string;
  events: NostrEvent[];
  resolvedVia?: 'eose' | 'timeout';
}

/**
 * Empty results are only cacheable when at least one window received EOSE —
 * an all-timeout empty result means relays never answered, and caching it
 * would suppress memories for the rest of the day. Non-empty results are
 * always cacheable.
 */
export function shouldCacheMemories(
  groups: { events: unknown[]; resolvedVia: 'eose' | 'timeout' }[]
): boolean {
  const hasEvents = groups.some((group) => group.events.length > 0);
  const sawEose = groups.some((group) => group.resolvedVia === 'eose');
  return hasEvents || sawEose;
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** Local-time YYYY-MM-DD */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function cacheKey(pubkey: string, now: Date): string {
  return `${CACHE_PREFIX}${pubkey}_${localDateKey(now)}`;
}

/** Remove keys with `prefix` except `keep`. */
function pruneStaleKeys(prefix: string, keep: string): void {
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix) && key !== keep) {
      stale.push(key);
    }
  }
  for (const key of stale) {
    localStorage.removeItem(key);
  }
}

function readCache(ndk: NDK, pubkey: string, now: Date): MemoryGroup[] | null {
  if (!hasLocalStorage()) return null;

  const raw = localStorage.getItem(cacheKey(pubkey, now));
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as StoredMemoryGroup[];
    if (!Array.isArray(stored)) return null;
    return stored.map((group) => ({
      yearsAgo: group.yearsAgo,
      date: new Date(group.date),
      events: group.events.map((ev) => new NDKEvent(ndk, ev)),
      // Anything that made it into the cache was deemed authoritative.
      resolvedVia: group.resolvedVia ?? 'eose'
    }));
  } catch {
    return null;
  }
}

function writeCache(pubkey: string, now: Date, groups: MemoryGroup[]): void {
  if (!hasLocalStorage()) return;

  const key = cacheKey(pubkey, now);
  const stored: StoredMemoryGroup[] = groups.map((group) => ({
    yearsAgo: group.yearsAgo,
    date: group.date.toISOString(),
    events: group.events.map((ev) => ev.rawEvent()),
    resolvedVia: group.resolvedVia
  }));

  try {
    pruneStaleKeys(`${CACHE_PREFIX}${pubkey}_`, key);
    localStorage.setItem(key, JSON.stringify(stored));
  } catch (error) {
    // Quota exceeded or storage unavailable — cache is best-effort only.
    console.warn('[memories] Failed to write cache:', error);
  }
}

/**
 * In-flight fetches keyed by pubkey+day. Rapid mount/unmount cycles (e.g.
 * bouncing between /community and /memories before the first fetch
 * finishes) share one fetch instead of opening 3 new subscriptions per
 * mount. Entries are removed when the fetch settles, so each subscription
 * still self-terminates on eose or its 10s timeout — nothing outlives that.
 */
const pendingFetches = new Map<string, Promise<MemoryGroup[]>>();

/**
 * Return today's cached memories if present, otherwise fetch from relays
 * and cache the result. Empty results are cached too (so relays aren't
 * re-queried all day for users with no memories) — but only when at least
 * one window received EOSE; empty-via-timeout is never cached. Cache
 * writes are also skipped if the relay generation changed during the fetch.
 */
export async function getMemoriesCached(
  ndk: NDK,
  pubkey: string,
  now: Date = new Date()
): Promise<MemoryGroup[]> {
  const cached = readCache(ndk, pubkey, now);
  if (cached) return cached;

  const key = cacheKey(pubkey, now);
  const pending = pendingFetches.get(key);
  if (pending) return pending;

  const fetchPromise = (async () => {
    try {
      const { getCurrentRelayGeneration } = await import('./nostr');
      const startGeneration = getCurrentRelayGeneration();

      const groups = await fetchMemories(ndk, pubkey, now);

      if (getCurrentRelayGeneration() === startGeneration && shouldCacheMemories(groups)) {
        writeCache(pubkey, now, groups);
      }

      return groups;
    } finally {
      pendingFetches.delete(key);
    }
  })();

  pendingFetches.set(key, fetchPromise);
  return fetchPromise;
}

/**
 * Overwrite today's cache entry with `groups`, but only when they're
 * authoritative per shouldCacheMemories. Returns whether the write
 * happened. Exported separately so the gating is unit-testable.
 */
export function overwriteMemoriesCache(
  pubkey: string,
  groups: MemoryGroup[],
  now: Date = new Date()
): boolean {
  if (!shouldCacheMemories(groups)) return false;
  writeCache(pubkey, now, groups);
  return true;
}

/**
 * Cache-bypassing refresh for the /memories page: always hits relays,
 * then overwrites today's cache entry only when the result is
 * authoritative (has events or saw EOSE) and the relay generation is
 * unchanged. `refreshed: false` means the caller should keep showing
 * its current (cached) data.
 */
export async function refreshMemories(
  ndk: NDK,
  pubkey: string,
  now: Date = new Date()
): Promise<{ groups: MemoryGroup[]; refreshed: boolean }> {
  const { getCurrentRelayGeneration } = await import('./nostr');
  const startGeneration = getCurrentRelayGeneration();

  const groups = await fetchMemories(ndk, pubkey, now);

  if (getCurrentRelayGeneration() !== startGeneration) {
    return { groups, refreshed: false };
  }

  return { groups, refreshed: overwriteMemoriesCache(pubkey, groups, now) };
}

// ═══════════════════════════════════════════════════════════════
// DISMISSAL
// ═══════════════════════════════════════════════════════════════

export function dismissMemoriesCard(pubkey: string, now: Date = new Date()): void {
  if (!hasLocalStorage()) return;
  const key = `${DISMISS_PREFIX}${pubkey}_${localDateKey(now)}`;
  try {
    pruneStaleKeys(`${DISMISS_PREFIX}${pubkey}_`, key);
    localStorage.setItem(key, '1');
  } catch {
    // Best-effort only.
  }
}

export function isMemoriesCardDismissed(pubkey: string, now: Date = new Date()): boolean {
  if (!hasLocalStorage()) return false;
  return localStorage.getItem(`${DISMISS_PREFIX}${pubkey}_${localDateKey(now)}`) !== null;
}

/** Clear today's dismissal (the card's "Undo" affordance). */
export function undismissMemoriesCard(pubkey: string, now: Date = new Date()): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(`${DISMISS_PREFIX}${pubkey}_${localDateKey(now)}`);
  } catch {
    // Best-effort only.
  }
}
