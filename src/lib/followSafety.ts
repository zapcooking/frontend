/**
 * Safe edits to the reader's follow list (kind 3).
 *
 * A kind-3 event replaces the whole list, so a follow built on a stale,
 * partial or missing read publishes a smaller list and silently drops
 * follows. Every follow and unfollow in the app goes through
 * `updateFollows`, which:
 *
 * 1. reads the list from the reader's own write relays, purplepag.es and
 *    the app's relays, waiting for each answer (READ_TIMEOUT_MS each);
 * 2. decides with `decideFollowEdit` (pure, tested) whether the edit is
 *    safe, refusing with a reason (nothing published) when:
 *    - no relay answered, or neither purplepag.es nor all of the reader's
 *      own write relays answered (the newest list may be on one that didn't);
 *    - no list was found (except a brand-new account: see below);
 *    - the newest list found is older, or has fewer follows, than a list
 *      already seen this session;
 *    - the edited list would have fewer follows than the largest list seen
 *      (a follow only adds; an unfollow removes exactly the one);
 * 3. publishes to the reader's write relays and the app's relays, and
 *    remembers the result as seen.
 *
 * Brand-new account: "no list found" is allowed only when purplepag.es and
 * every other relay asked answered with nothing, and no list was ever seen
 * this session — otherwise a first follow (onboarding) could never happen.
 */

export const PURPLEPAGES = 'wss://purplepag.es';
export const READ_TIMEOUT_MS = 5000;

export interface ContactList {
  id: string;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface RelayAnswer {
  url: string;
  /** Answered (EOSE), with or without a list. */
  ok: boolean;
  list: ContactList | null;
}

export interface Seen {
  /** created_at of the newest list seen this session. */
  newestAt: number;
  /** Most follows in any list seen this session. */
  maxCount: number;
}

export type Refusal =
  | 'no-answer'
  | 'incomplete'
  | 'not-found'
  | 'stale'
  | 'smaller'
  | 'would-shrink';

export type Decision =
  | { ok: true; tags: string[][]; content: string; count: number; changed: boolean }
  | { ok: false; reason: Refusal };

const key = (u: string) => u.trim().toLowerCase().replace(/\/+$/, '');

export function followCount(tags: string[][]): number {
  return new Set(tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1])).size;
}

/** The newest list among the answers (ties: the larger). */
export function newestList(answers: RelayAnswer[]): ContactList | null {
  let best: ContactList | null = null;
  for (const a of answers) {
    const l = a.list;
    if (!l) continue;
    if (
      !best ||
      l.created_at > best.created_at ||
      (l.created_at === best.created_at && followCount(l.tags) > followCount(best.tags))
    )
      best = l;
  }
  return best;
}

export function decideFollowEdit(o: {
  answers: RelayAnswer[];
  /** The reader's own write relays (kind 10002). */
  ownWrite: string[];
  seen: Seen | null;
  add?: string[];
  remove?: string[];
}): Decision {
  const answered = new Set(o.answers.filter((a) => a.ok).map((a) => key(a.url)));
  if (answered.size === 0) return { ok: false, reason: 'no-answer' };
  const purple = answered.has(key(PURPLEPAGES));
  const allOwn = o.ownWrite.length > 0 && o.ownWrite.every((u) => answered.has(key(u)));
  if (!purple && !allOwn) return { ok: false, reason: 'incomplete' };

  const found = newestList(o.answers);
  if (!found) {
    const everyoneAnswered = o.answers.every((a) => a.ok);
    if (o.seen || !purple || !everyoneAnswered) return { ok: false, reason: 'not-found' };
  }
  const foundCount = found ? followCount(found.tags) : 0;
  if (o.seen && found) {
    if (found.created_at < o.seen.newestAt) return { ok: false, reason: 'stale' };
    if (foundCount < o.seen.maxCount) return { ok: false, reason: 'smaller' };
  }

  const tags = found?.tags ?? [];
  const others = tags.filter((t) => t[0] !== 'p');
  const ps: string[][] = [];
  const have = new Set<string>();
  for (const t of tags) {
    if (t[0] !== 'p' || !t[1] || have.has(t[1])) continue;
    have.add(t[1]);
    ps.push(t);
  }
  const remove = new Set(o.remove ?? []);
  const kept = ps.filter((t) => !remove.has(t[1]));
  const added = (o.add ?? []).filter((pk) => pk && !have.has(pk)).map((pk) => ['p', pk]);
  const next = [...kept, ...added];
  const removed = ps.length - kept.length;

  // A follow only adds, an unfollow removes exactly the asked-for entries:
  // never fewer than the largest list seen, less what was asked to remove.
  const largest = Math.max(foundCount, o.seen?.maxCount ?? 0);
  if (next.length < largest - removed) return { ok: false, reason: 'would-shrink' };
  // The old unfollow safeguard: never empty a list that had more than one.
  if (next.length === 0 && ps.length > 1) return { ok: false, reason: 'would-shrink' };

  return {
    ok: true,
    tags: [...others, ...next],
    content: found?.content ?? '',
    count: next.length,
    changed: added.length > 0 || removed > 0
  };
}

export function refusalMessage(r: Refusal): string {
  switch (r) {
    case 'no-answer':
    case 'incomplete':
      return "Couldn't load your follow list from your relays, so nothing was changed. Please try again in a moment.";
    case 'not-found':
      return "Couldn't find your follow list, so nothing was changed (saving now could erase it). Please try again.";
    case 'stale':
    case 'smaller':
      return 'Your relays returned an older or shorter follow list than one seen earlier, so nothing was changed. Please try again.';
    case 'would-shrink':
      return 'This change would have removed other follows, so nothing was changed.';
  }
}

/** Session memory, per account. */
const seenBy = new Map<string, Seen>();

export function getSeen(pubkey: string): Seen | null {
  return seenBy.get(pubkey) ?? null;
}

/** Remember a list as seen (raises newestAt / maxCount, never lowers them). */
export function noteSeen(pubkey: string, list: { created_at: number; tags: string[][] } | null) {
  if (!pubkey || !list) return;
  const cur = seenBy.get(pubkey);
  const count = followCount(list.tags);
  seenBy.set(pubkey, {
    newestAt: Math.max(cur?.newestAt ?? 0, list.created_at),
    maxCount: Math.max(cur?.maxCount ?? 0, count)
  });
}

/** Tests only. */
export function resetSeenForTests() {
  seenBy.clear();
}

/**
 * After this app publishes a list: it is now the newest, and its size is the
 * new baseline (an unfollow legitimately lowers it).
 */
export function notePublished(pubkey: string, list: { created_at: number; tags: string[][] }) {
  if (!pubkey) return;
  seenBy.set(pubkey, { newestAt: list.created_at, maxCount: followCount(list.tags) });
}
