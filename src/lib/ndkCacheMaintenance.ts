/**
 * NDK Dexie cache maintenance
 *
 * ndk-cache-dexie has no pruning path: its in-memory LRUs only bound
 * memory, while the on-disk tables grow forever. This module caps the
 * cache once a day — when the events table exceeds MAX_CACHED_EVENTS it
 * is cleared wholesale (together with its tag index) and repopulates
 * over subsequent use.
 *
 * Why clear instead of deleting the oldest rows: the events table has no
 * created_at index, so age-based pruning would have to deserialize every
 * row on the main thread. A cache reset is two cheap IndexedDB
 * operations. The app keeps its own feed hydration cache separately, so
 * the user-visible cost of a reset is modest.
 */

import { browser } from '$app/environment';
import Dexie from 'dexie';

const MAINTENANCE_KEY = 'zc_ndk_cache_maintenance_v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_EVENTS = 50_000;
const PRUNE_DELAY_MS = 60_000;

// Same stores and version ndk-cache-dexie declares (Database.version(15)).
// This is a second connection to the same database, used only for
// counting and clearing.
class NdkCacheDb extends Dexie {
  events!: Dexie.Table<{ id: string; createdAt?: number }, string>;
  eventTags!: Dexie.Table<{ tagValue: string; eventId: string }, string>;

  constructor() {
    super('zapcooking-ndk-cache-db');
    this.version(15).stores({
      events: '&id, kind',
      eventTags: '&tagValue'
    });
  }
}

/** Run the cache cap check at most once per day, after startup settles. */
export function scheduleNdkCacheMaintenance(): void {
  if (!browser) return;

  let last = 0;
  try {
    last = Number(localStorage.getItem(MAINTENANCE_KEY) || 0);
  } catch {
    return; // private mode / storage disabled — nothing to do
  }
  if (Date.now() - last < DAY_MS) return;
  try {
    localStorage.setItem(MAINTENANCE_KEY, String(Date.now()));
  } catch {
    return;
  }

  // Past the adapter warm-up and the first minute of session churn. The
  // check itself is one IDB count; a reset is two cheap clears.
  setTimeout(() => {
    pruneNdkCache().catch((e) => {
      // Version drift in ndk-cache-dexie (schema bump) surfaces here as
      // a VersionError — fail silent; the adapter still works.
      console.debug('[NdkCache] Maintenance skipped:', e);
    });
  }, PRUNE_DELAY_MS);
}

async function pruneNdkCache(): Promise<void> {
  const db = new NdkCacheDb();
  try {
    const count = await db.events.count();
    if (count <= MAX_CACHED_EVENTS) return;

    await db.transaction('rw', db.events, db.eventTags, async () => {
      await db.events.clear();
      await db.eventTags.clear();
    });
    console.info(
      `[NdkCache] Reset ${count} cached events (cap ${MAX_CACHED_EVENTS}); the cache will repopulate`
    );
  } finally {
    db.close();
  }
}
