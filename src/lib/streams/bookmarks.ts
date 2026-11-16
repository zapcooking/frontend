/**
 * Saved-stream backup encode/decode and merge (ported from Sidecar stream-core.js).
 * Local-first: merging never deletes local saves, and every restored item is re-validated.
 */

import { streamBookmark } from './parse';
import type { StreamBookmark } from './types';

/** Merge remote and local saves by key; local wins on collision, remote entries keep their place. */
export function mergeBookmarks(
  local: StreamBookmark[],
  remote: StreamBookmark[]
): StreamBookmark[] {
  return [
    ...new Map(
      [...remote, ...local]
        .map((item) => streamBookmark(item))
        .filter((item): item is StreamBookmark => !!item)
        .map((item) => [item.key, item])
    ).values()
  ];
}

export function encodeBookmarks(items: StreamBookmark[]): string {
  const clean = mergeBookmarks(items, []);
  const result = JSON.stringify({ version: 1, streams: clean });
  if (clean.length > 200 || result.length > 40000) throw new Error('Too many stream bookmarks');
  return result;
}

export function decodeBookmarks(text: string): StreamBookmark[] {
  if (typeof text !== 'string' || text.length > 40000) throw new Error('Invalid stream backup');
  const data = JSON.parse(text);
  if (data.version !== 1 || !Array.isArray(data.streams) || data.streams.length > 200) {
    throw new Error('Invalid stream backup');
  }
  if (data.streams.some((item: unknown) => !streamBookmark(item as StreamBookmark))) {
    throw new Error('Invalid stream bookmark');
  }
  return mergeBookmarks(data.streams, []);
}

/**
 * Salvage decode for localStorage reads: keep the valid entries and drop
 * the rest, so one bad row (hand edits, a stricter future validator)
 * cannot lose the whole saved list.
 */
export function decodeBookmarksSoft(text: string): StreamBookmark[] {
  if (typeof text !== 'string' || text.length > 40000) return [];
  try {
    const data = JSON.parse(text);
    if (data.version !== 1 || !Array.isArray(data.streams)) return [];
    const valid = data.streams.filter((item: unknown) => streamBookmark(item as StreamBookmark));
    return mergeBookmarks(valid, []);
  } catch {
    return [];
  }
}
