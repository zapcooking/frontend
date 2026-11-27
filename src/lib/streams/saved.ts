/**
 * Saved streams in localStorage. Entries are validated through streamBookmark
 * on both write and read, so a corrupted or hand-edited list can never feed
 * an unsafe URL to the player.
 */

import { browser } from '$app/environment';
import { decodeBookmarksSoft, encodeBookmarks } from './bookmarks';
import { streamBookmark } from './parse';
import type { StreamBookmark, StreamItem } from './types';

const SAVED_KEY = 'zap-stream-saved';

export function loadSaved(): StreamBookmark[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    // Soft decode: one bad entry is dropped, the saved list survives.
    return decodeBookmarksSoft(raw);
  } catch {
    return [];
  }
}

/** Returns false when storage refused the write (quota, private mode). */
export function storeSaved(items: StreamBookmark[]): boolean {
  if (!browser) return false;
  try {
    localStorage.setItem(SAVED_KEY, encodeBookmarks(items));
    return true;
  } catch {
    return false;
  }
}

export function isSaved(item: Pick<StreamBookmark, 'key'>, saved: StreamBookmark[]): boolean {
  return saved.some((row) => row.key === item.key);
}

export function toggleSavedItem(
  item: StreamItem | StreamBookmark,
  saved: StreamBookmark[]
): { saved: boolean; items: StreamBookmark[] } {
  const entry = streamBookmark(item);
  if (!entry) return { saved: false, items: saved };
  // Reconcile against what is currently stored, not the caller's snapshot:
  // another tab may have saved or removed entries since it loaded, and a
  // write from a stale snapshot would drop those.
  const current = loadSaved();
  const exists = current.some((row) => row.key === entry.key);
  // Newest first: a fresh save leads the Saved tab.
  const next = exists ? current.filter((row) => row.key !== entry.key) : [entry, ...current];
  const ok = storeSaved(next);
  return { saved: ok ? !exists : exists, items: ok ? next : saved };
}
