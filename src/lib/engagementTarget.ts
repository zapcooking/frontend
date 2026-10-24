/**
 * NIP-10 engagement-target resolution.
 *
 * Some clients (e.g. Damus) publish reactions, reposts and zaps with full
 * thread context in their `e` tags — [root, intermediary, target] — instead
 * of the single target tag NIP-25/18/57 prescribe. A relay `#e` filter
 * matches an event when the id appears in ANY tag position, so counting
 * everything a `#e` subscription returns attributes context-tagged events
 * to every note they mention: a reaction to one reply shows up as a
 * reaction on its root and on every intermediary reply. To attribute an
 * engagement event to a note, the note must be the event's effective
 * target, resolved here:
 *
 *   1. the first `e` tag marked `reply` (NIP-10 marker form)
 *   2. else the last positional (unmarked) `e` tag — NIP-10's deprecated
 *      positional form, where the last tag is the replied-to event
 *   3. else the last `e` tag overall (degenerate single `root`-marked tag)
 *
 * `root`- and `mention`-marked tags are never targets.
 */

type Tag = string[];

export function getEngagementTargetId(tags: Tag[] | undefined): string | null {
  if (!tags) return null;

  let lastPositional: string | null = null;
  let lastAny: string | null = null;

  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== 'e' || typeof tag[1] !== 'string') continue;
    lastAny = tag[1];
    if (tag[3] === 'reply') return tag[1];
    if (tag[3] === undefined || tag[3] === '') lastPositional = tag[1];
  }

  return lastPositional ?? lastAny;
}

/**
 * True when `eventTags` make `noteId` the effective engagement target —
 * i.e. the event is a reaction/repost/zap/comment ON this note, not merely
 * one that mentions it as thread context.
 *
 * Zap receipts (kind 9735) are exempt: NIP-57 documents no ordering for
 * multi-e receipts, so any e-tag match counts for them exactly as it did
 * before this helper existed.
 */
export function engagementTargetsNote(
  tags: Tag[] | undefined,
  kind: number | undefined,
  noteId: string
): boolean {
  if (kind === 9735) {
    return !!tags?.some((tag) => Array.isArray(tag) && tag[0] === 'e' && tag[1] === noteId);
  }
  return getEngagementTargetId(tags) === noteId;
}

/**
 * Strict form used where the kind is already known to be a reaction or
 * repost: the note must be the effective NIP-10/NIP-25 target.
 */
export function targetsEvent(tags: Tag[] | undefined, noteId: string): boolean {
  return getEngagementTargetId(tags) === noteId;
}
