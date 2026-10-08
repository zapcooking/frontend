import { writable, type Readable } from 'svelte/store';
import { SPECIALS, type SpecialType } from './specialsConfig';

/**
 * The reader's choices about special cards, and what this device has
 * already shown. Everything lives in localStorage on this device and is
 * never sent anywhere.
 *
 * - `fewer`: "Show fewer like this", per card type.
 * - `hiddenTopics`: "Hide this topic" (spotlight slugs).
 * - `off`: special cards turned off entirely (Settings → Fresh).
 * - Shown posts: ids shown in spotlight / memory cards (never shown twice),
 *   pruned after 90 days, capped.
 * - Topic history: when each spotlight topic was last shown, so later
 *   sessions favor topics not seen recently.
 */

export const PREFS_KEY = 'zapcooking_fresh_specials_prefs';
export const SHOWN_KEY = 'zapcooking_fresh_specials_shown';
export const TOPICS_KEY = 'zapcooking_fresh_spotlight_topics';

export interface SpecialsPrefs {
  fewer: Record<SpecialType, boolean>;
  hiddenTopics: string[];
  off: boolean;
}

export function defaultPrefs(): SpecialsPrefs {
  return {
    fewer: { recipe: false, spotlight: false, memory: false },
    hiddenTopics: [],
    off: false
  };
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem?(k: string): void;
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readJson(s: StorageLike | null, key: string): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeJson(s: StorageLike | null, key: string, value: unknown): void {
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: this session still remembers.
  }
}

export function loadPrefs(s: StorageLike | null = storage()): SpecialsPrefs {
  const raw = readJson(s, PREFS_KEY) as Partial<SpecialsPrefs> | null;
  const p = defaultPrefs();
  if (!raw || typeof raw !== 'object') return p;
  for (const t of Object.keys(p.fewer) as SpecialType[]) p.fewer[t] = raw.fewer?.[t] === true;
  if (Array.isArray(raw.hiddenTopics))
    p.hiddenTopics = [...new Set(raw.hiddenTopics.filter((x) => typeof x === 'string'))];
  p.off = raw.off === true;
  return p;
}

const prefsStore = writable<SpecialsPrefs>(defaultPrefs());
let prefsLoaded = false;

/** The reader's choices (loaded from this device on first use). */
export function specialsPrefs(s: StorageLike | null = storage()): Readable<SpecialsPrefs> {
  if (!prefsLoaded) {
    prefsLoaded = true;
    prefsStore.set(loadPrefs(s));
  }
  return { subscribe: prefsStore.subscribe };
}

function update(fn: (p: SpecialsPrefs) => void, s: StorageLike | null = storage()): void {
  specialsPrefs(s);
  prefsStore.update((cur) => {
    const next: SpecialsPrefs = {
      fewer: { ...cur.fewer },
      hiddenTopics: [...cur.hiddenTopics],
      off: cur.off
    };
    fn(next);
    writeJson(s, PREFS_KEY, next);
    return next;
  });
}

export function showFewer(type: SpecialType, s?: StorageLike | null): void {
  update((p) => (p.fewer[type] = true), s);
}

export function hideTopic(slug: string, s?: StorageLike | null): void {
  update((p) => {
    if (!p.hiddenTopics.includes(slug)) p.hiddenTopics.push(slug);
  }, s);
}

export function unhideTopic(slug: string, s?: StorageLike | null): void {
  update((p) => (p.hiddenTopics = p.hiddenTopics.filter((x) => x !== slug)), s);
}

export function resetFewer(type: SpecialType, s?: StorageLike | null): void {
  update((p) => (p.fewer[type] = false), s);
}

export function setSpecialsOff(off: boolean, s?: StorageLike | null): void {
  update((p) => (p.off = off), s);
}

/** Settings → Fresh "Reset": every choice back to the default. */
export function resetPrefs(s: StorageLike | null = storage()): void {
  specialsPrefs(s);
  prefsStore.set(defaultPrefs());
  writeJson(s, PREFS_KEY, defaultPrefs());
}

/** Tests only. */
export function resetPrefsForTests(): void {
  prefsLoaded = false;
  prefsStore.set(defaultPrefs());
}

// --- Shown posts: id → when shown (seconds) ---

export function pruneShown(m: Map<string, number>, now: number): Map<string, number> {
  const fresh = [...m.entries()].filter(([, t]) => t > now - SPECIALS.shownTtlSeconds);
  fresh.sort((a, b) => b[1] - a[1]);
  return new Map(fresh.slice(0, SPECIALS.shownMax));
}

export function loadShown(now: number, s: StorageLike | null = storage()): Map<string, number> {
  const raw = readJson(s, SHOWN_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
  const m = new Map<string, number>();
  for (const [k, v] of Object.entries(raw as Record<string, unknown>))
    if (typeof v === 'number') m.set(k, v);
  return pruneShown(m, now);
}

export function markShown(
  shown: Map<string, number>,
  ids: string[],
  now: number,
  s: StorageLike | null = storage()
): Map<string, number> {
  const next = new Map(shown);
  for (const id of ids) next.set(id, now);
  const pruned = pruneShown(next, now);
  writeJson(s, SHOWN_KEY, Object.fromEntries(pruned));
  return pruned;
}

// --- Spotlight topic history: slug → when last shown (seconds) ---

export function loadTopicHistory(s: StorageLike | null = storage()): Map<string, number> {
  const raw = readJson(s, TOPICS_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
  const m = new Map<string, number>();
  for (const [k, v] of Object.entries(raw as Record<string, unknown>))
    if (typeof v === 'number') m.set(k, v);
  return m;
}

export function markTopicShown(
  history: Map<string, number>,
  slug: string,
  now: number,
  s: StorageLike | null = storage()
): Map<string, number> {
  const next = new Map(history).set(slug, now);
  const kept = [...next.entries()].sort((a, b) => b[1] - a[1]).slice(0, SPECIALS.topicHistoryMax);
  const out = new Map(kept);
  writeJson(s, TOPICS_KEY, Object.fromEntries(out));
  return out;
}
