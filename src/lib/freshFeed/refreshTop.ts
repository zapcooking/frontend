import type { RelayEvent } from './relay';

/**
 * Refresh without jumps: pull-to-refresh asks only for posts newer than the
 * top of the feed and adds them above it, leaving everything the reader has
 * loaded where it is. A full reload is only needed when the newer posts
 * don't reach back to the current top (a full page of them, all newer than
 * it): there'd be a hole in the middle of the feed.
 */
export function needsFullReload(
  fresh: Pick<RelayEvent, 'created_at'>[],
  pageSize: number,
  topCreatedAt: number | null
): boolean {
  if (topCreatedAt === null) return true;
  if (fresh.length < pageSize) return false;
  return Math.min(...fresh.map((e) => e.created_at)) > topCreatedAt;
}
