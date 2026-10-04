/**
 * "New since your last visit": where the previous visit left off, kept on
 * this device only (localStorage), never sent anywhere.
 *
 * The stored value is the newest post time the reader was shown last time.
 * A visit reads it once (`beginVisit`) and keeps that value for the whole
 * session, so refreshes and tab switches don't move the divider; the
 * newest post seen now is stored for next time (`recordNewest`).
 */

export const LAST_VISIT_KEY = 'zapcooking_fresh_last_visit';

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

let sessionMark: number | null | undefined;

/** The previous visit's mark for this session (null on a first visit). */
export function beginVisit(s: StorageLike | null = storage()): number | null {
  if (sessionMark !== undefined) return sessionMark;
  let mark: number | null = null;
  try {
    const n = Number(s?.getItem(LAST_VISIT_KEY));
    if (Number.isFinite(n) && n > 0) mark = n;
  } catch {
    mark = null;
  }
  sessionMark = mark;
  return mark;
}

/** Remember the newest post shown, for the next visit (never moves back). */
export function recordNewest(createdAt: number, s: StorageLike | null = storage()): void {
  if (!s || !Number.isFinite(createdAt) || createdAt <= 0) return;
  try {
    const cur = Number(s.getItem(LAST_VISIT_KEY));
    if (Number.isFinite(cur) && cur >= createdAt) return;
    s.setItem(LAST_VISIT_KEY, String(Math.floor(createdAt)));
  } catch {
    // Private mode or a full quota: no divider next time, nothing else.
  }
}

/** Tests: forget this session's mark. */
export function resetVisitForTests(): void {
  sessionMark = undefined;
}

export type Row<T> =
  | { key: string; item: T; box: boolean; divider?: false }
  | { key: string; divider: true; newCount: number };

/**
 * Put the "caught up" divider before the first post (not recipe-box pick)
 * the reader already saw, with the number of new posts above it. No divider
 * on a first visit, or when every post shown is new (the reader hasn't
 * reached the old ones yet) or none is.
 */
export function withDivider<T extends { raw: { created_at: number } }>(
  rows: { key: string; item: T; box: boolean }[],
  mark: number | null
): Row<T>[] {
  if (mark === null) return rows;
  const at = rows.findIndex((r) => !r.box && r.item.raw.created_at <= mark);
  if (at <= 0) return rows;
  const newCount = rows.slice(0, at).filter((r) => !r.box).length;
  return [...rows.slice(0, at), { key: 'divider', divider: true, newCount }, ...rows.slice(at)];
}
