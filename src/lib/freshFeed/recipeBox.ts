import { FREE_WINDOW_SECONDS, type RelayEvent } from './relay';
import { isRecipe, publishedAt } from './posts';

/**
 * "From the recipe box": older recipes woven into the Fresh feed as one of
 * its special cards ($lib/freshFeed/specials decides where), picked at
 * random from the recipes this device hasn't shown yet (so different
 * readers see different recipes).
 *
 * Pool: kind 35000, and kind 30023 tagged zapcooking / nostrcooking, first
 * published (`published_at`, else `created_at`) more than 14 days ago; one
 * per address (the newest version of a replaceable recipe).
 *
 * "Already shown" is a device-local list in localStorage: recipe address →
 * when it was shown, pruned after 90 days and capped at the 1,000 newest.
 * It never leaves the device.
 */

export const SEEN_KEY = 'zapcooking_fresh_recipe_box_seen';
export const SEEN_MAX = 1000;
export const SEEN_TTL_SECONDS = 90 * 24 * 60 * 60;

/** `kind:pubkey:d`, the address every version of a recipe shares. */
export function recipeAddress(e: Pick<RelayEvent, 'kind' | 'pubkey' | 'tags'>): string {
  const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
  return `${e.kind}:${e.pubkey}:${d}`;
}

/** An older recipe: first published before the free window. */
export function isBoxCandidate(e: RelayEvent, now: number): boolean {
  if (!isRecipe(e)) return false;
  const first = publishedAt(e) ?? e.created_at;
  return first < now - FREE_WINDOW_SECONDS;
}

/** The pool: candidates only, newest version per address. */
export function buildPool(events: RelayEvent[], now: number): RelayEvent[] {
  const byAddr = new Map<string, RelayEvent>();
  for (const e of events) {
    if (!isBoxCandidate(e, now)) continue;
    const a = recipeAddress(e);
    const cur = byAddr.get(a);
    if (!cur || e.created_at > cur.created_at) byAddr.set(a, e);
  }
  return [...byAddr.values()];
}

/**
 * A random recipe not shown on this device and not already picked this
 * session; null when the pool is used up. `random` in [0, 1).
 */
export function pickRandom(
  pool: RelayEvent[],
  seen: Map<string, number>,
  taken: Set<string>,
  random: () => number = Math.random
): RelayEvent | null {
  const open = pool.filter((e) => {
    const a = recipeAddress(e);
    return !seen.has(a) && !taken.has(a);
  });
  if (open.length === 0) return null;
  return open[Math.min(open.length - 1, Math.floor(random() * open.length))];
}

// --- The device-local "already shown" list ---

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Keep entries younger than 90 days, at most the 1,000 newest. */
export function pruneSeen(seen: Map<string, number>, now: number): Map<string, number> {
  const fresh = [...seen.entries()].filter(([, t]) => t > now - SEEN_TTL_SECONDS);
  fresh.sort((a, b) => b[1] - a[1]);
  return new Map(fresh.slice(0, SEEN_MAX));
}

export function loadSeen(now: number, s: StorageLike | null = storage()): Map<string, number> {
  if (!s) return new Map();
  try {
    const raw = JSON.parse(s.getItem(SEEN_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number') m.set(k, v);
    return pruneSeen(m, now);
  } catch {
    return new Map();
  }
}

export function markSeen(
  seen: Map<string, number>,
  address: string,
  now: number,
  s: StorageLike | null = storage()
): Map<string, number> {
  const next = pruneSeen(new Map(seen).set(address, now), now);
  if (s) {
    try {
      s.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(next)));
    } catch {
      // Private mode or a full quota: this session still remembers.
    }
  }
  return next;
}
