/**
 * Site moderation for a recipe's comment thread: the one rule the thread
 * and the Plated row both follow.
 *
 * A comment is removed when its event id or author is on the Reads
 * moderation lists (seed + admin overlay) — a pointer check only, never the
 * keyword denylist, which would scan casual comment text. Replies under a
 * removed comment go with it: CommentCard resolves a missing parent from
 * relays, so a surviving reply would re-surface the removed author as
 * "Replying to …" and hang off a gap in the thread.
 *
 * Pure (the block predicate and its version store are injected), so it is
 * unit-tested without the browser-only moderation client.
 */
import { derived, type Readable } from 'svelte/store';
import { getReplyParentId } from '$lib/thread/replyParent';
import type { CommentSubscription } from './subscription';

export interface ModeratablePointer {
  eventId: string;
  pubkey: string;
}

export type IsBlocked = (pointer: ModeratablePointer) => boolean;

interface CommentLike {
  id?: string;
  pubkey?: string;
  kind?: number;
  tags?: string[][];
}

function parentOf(event: CommentLike): string | null {
  if (!event.id) return null;
  try {
    return getReplyParentId({ id: event.id, kind: event.kind, tags: event.tags ?? [] });
  } catch {
    return null; // malformed tags: treat as top-level
  }
}

/**
 * `events` minus blocked comments and every reply beneath them. Returns the
 * same array when nothing is blocked. Events without an id or pubkey can't
 * be matched and pass through unchanged.
 */
export function withoutBlockedComments<T extends CommentLike>(events: T[], isBlocked: IsBlocked): T[] {
  const removed = new Set<string>();
  for (const e of events) {
    if (e.id && e.pubkey && isBlocked({ eventId: e.id, pubkey: e.pubkey })) removed.add(e.id);
  }
  if (removed.size === 0) return events;

  // Cascade to a fixpoint: order-independent, so a reply that arrives
  // before its parent is still caught.
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of events) {
      if (!e.id || removed.has(e.id)) continue;
      const parent = parentOf(e);
      if (parent && removed.has(parent)) {
        removed.add(e.id);
        grew = true;
      }
    }
  }
  return events.filter((e) => !e.id || !removed.has(e.id));
}

/**
 * The same subscription with moderation applied to `events`, re-filtered
 * whenever `version` changes (the admin overlay arriving). `addLocal` and
 * `eosed` pass through; `stop` stays the owner's to call on the original.
 */
export function moderatedSubscription(
  sub: CommentSubscription,
  version: Readable<unknown>,
  isBlocked: IsBlocked
): CommentSubscription {
  return {
    events: derived([sub.events, version], ([$events]) => withoutBlockedComments($events, isBlocked)),
    eosed: sub.eosed,
    addLocal: (ev) => sub.addLocal(ev),
    stop: () => sub.stop()
  };
}
