/**
 * Who is live right now (NIP-53), for avatar rings and bio badges.
 *
 * Components declare interest in a pubkey with `watchLiveNow`; lookups are
 * batched — one request per relay for every watched host, on the Sidecar
 * profile-lookup lesson (a list of unbatched avatars used to open dozens of
 * relay connections and read as "not live" when relays refused the rest).
 * Answers are cached with a TTL so a page of avatars costs one scan every
 * couple of minutes, not one scan per render.
 *
 * Liveness rule matches the directory's announcement heuristic: the newest
 * announcement for the host says `live`, carries a media URL, and is under
 * an hour old. Playlist probing is reserved for the player and directory —
 * badges must stay cheap.
 */

import { writable, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import type { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import { StreamDirectory } from './directory';
import { createStreamPool } from './relayPage';
import { DISCOVERY_RELAYS } from './relays';
import type { NostrEventLike, StreamItem } from './types';

const liveByPubkey = writable<Map<string, StreamItem>>(new Map());

/** Pubkeys currently live → the announcement to open. */
export const liveNowStore: Readable<Map<string, StreamItem>> = {
  subscribe: liveByPubkey.subscribe
};

interface CacheEntry {
  item: StreamItem | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const watchers = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let pool: SimplePool | null = null;

const BATCH_WINDOW_MS = 300;
const BATCH_MAX = 80;
const RECHECK_TICK_MS = 30_000;
const LIVE_TTL_MS = 3 * 60_000;
const MISS_TTL_MS = 2 * 60_000;
const ERROR_TTL_MS = 30_000;
const LOOKUP_MAX_WAIT_MS = 4000;

function getPool(): SimplePool {
  if (!pool) pool = createStreamPool();
  return pool;
}

function publish() {
  const map = new Map<string, StreamItem>();
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.item && entry.expiresAt > now) map.set(key, entry.item);
  }
  liveByPubkey.set(map);
}

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const now = Date.now();
    const wanted = [...watchers.keys()].filter((key) => {
      const entry = cache.get(key);
      return !entry || entry.expiresAt <= now;
    });
    if (!wanted.length) return;
    const batch = wanted.slice(0, BATCH_MAX);

    let fresh: Map<string, StreamItem> | null = null;
    try {
      // Service-published announcements put the real host in a `p` tag
      // rather than the author field, so match both.
      const events = (await getPool().querySync(
        DISCOVERY_RELAYS,
        {
          kinds: [30311],
          authors: batch,
          '#p': batch,
          limit: Math.max(100, batch.length * 2)
        } as Filter,
        { maxWait: LOOKUP_MAX_WAIT_MS }
      )) as unknown as NostrEventLike[];

      // Newest announcement per address wins; then the directory's live
      // view (freshness + URL dedupe across re-announcements).
      const directory = new StreamDirectory(batch.length * 4);
      for (const event of events) directory.accept(event, now / 1000);
      fresh = new Map();
      for (const item of directory.live(now / 1000)) {
        // Only hosts the watcher actually asked about.
        if (batch.includes(item.host)) fresh.set(item.host, item);
      }
    } catch {
      // Relay failure: whatever we said before stands for another short TTL.
      for (const key of batch) {
        const entry = cache.get(key);
        cache.set(key, { item: entry?.item ?? null, expiresAt: now + ERROR_TTL_MS });
      }
      publish();
      return;
    }

    for (const key of batch) {
      const item = fresh?.get(key) ?? null;
      cache.set(key, { item, expiresAt: now + (item ? LIVE_TTL_MS : MISS_TTL_MS) });
    }
    publish();
  } finally {
    flushing = false;
  }
}

function tick() {
  flushTimer = null;
  if (!browser || !watchers.size) return;
  flush().finally(() => {
    // Keep re-checking while anything watches; TTLs set the per-pubkey pace.
    if (watchers.size && !flushTimer) flushTimer = setTimeout(tick, RECHECK_TICK_MS);
  });
}

/**
 * Watch a pubkey's liveness while a component shows it. Returns the
 * unwatch function; the reference is per call, so any number of badges can
 * watch the same host and the checks stop when the last one lets go.
 */
export function watchLiveNow(pubkey: string): () => void {
  if (!browser || !pubkey) return () => {};
  watchers.set(pubkey, (watchers.get(pubkey) || 0) + 1);
  if (!flushTimer) flushTimer = setTimeout(tick, BATCH_WINDOW_MS);
  return () => {
    const count = (watchers.get(pubkey) || 0) - 1;
    if (count <= 0) watchers.delete(pubkey);
    else watchers.set(pubkey, count);
    if (!watchers.size && flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
      cache.clear();
      publish();
    }
  };
}
