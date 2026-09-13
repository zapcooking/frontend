/**
 * Resolves which note an event is replying to, and assembles the
 * parent→children map the flattener renders.
 *
 * Parentage is derived here and nowhere else. The thread view used to
 * answer "who is this a reply to?" three separate ways — one walk for the
 * ancestors above the note, one predicate for its direct replies, another
 * for nested ones — and they disagreed on old threads, which is how a
 * conversation ends up looking shorter than it is.
 *
 * The subtlety is NIP-10's deprecated positional form, which most of the
 * pre-2023 archive is written in: unmarked `e` tags where the *first* is
 * the thread root and the *last* is the note being answered. Reading the
 * first tag as the parent walks straight from any reply to the root and
 * skips every note in between.
 */

/** Minimal event shape: tags decide parentage, content never does. */
export interface ParentableEvent {
  id: string;
  kind?: number;
  created_at?: number;
  tags: string[][];
}

/**
 * The id of the note this event replies to, or null if it opens a thread.
 *
 * Marked tags win when present, since a client that writes markers is
 * telling us directly. `mention` tags are excluded throughout — quoting
 * someone is not replying to them.
 */
export function getReplyParentId(event: ParentableEvent): string | null {
  const tags = (event.tags || []).filter((t) => Array.isArray(t) && t.length > 1 && t[1]);

  // NIP-22 comments: lowercase `e` is the immediate parent, uppercase `E`
  // the thread root. A top-level comment carries only the root.
  if (event.kind === 1111) {
    const parent = tags.find((t) => t[0] === 'e' && t[3] !== 'mention');
    if (parent) return parent[1];
    const root = tags.find((t) => t[0] === 'E');
    return root ? root[1] : null;
  }

  const eTags = tags.filter((t) => t[0] === 'e' && t[3] !== 'mention');
  if (eTags.length === 0) return null;

  const reply = eTags.find((t) => t[3] === 'reply');
  if (reply) return reply[1];

  // Deprecated positional form — last unmarked tag is the parent. Clients
  // that mark the root but leave the parent unmarked land here too, and
  // the unmarked tag is still the parent.
  const unmarked = eTags.filter((t) => !t[3]);
  if (unmarked.length > 0) return unmarked[unmarked.length - 1][1];

  const root = eTags.find((t) => t[3] === 'root');
  return root ? root[1] : eTags[eTags.length - 1][1];
}

/**
 * Groups replies under their parents, chronologically.
 *
 * A relay answering `#e: <focus>` returns the whole subtree, not just
 * direct replies, so most of these events name a parent that is another
 * reply. Anything whose parent isn't in the set — a deeper descendant
 * whose intermediate note never arrived, or a reply to an ancestor of the
 * note being viewed — is attached to the focused note rather than
 * dropped. A note the reader can see out of place beats one that silently
 * isn't there.
 *
 * The one thing that is dropped: a kind-1 note with no parent at all. It
 * matched the `#e` filter, so its only `e` tags are `mention`s — it quotes
 * the note rather than replying to it. NIP-22 comments are exempt because
 * they quote with `q`, never `e`; a kind-1111 without `e`/`E` is a
 * top-level comment on the focused event and belongs under it.
 */
export function buildReplyTree<E extends ParentableEvent>(
  focusId: string,
  replies: E[]
): Map<string, E[]> {
  const map = new Map<string, E[]>();
  if (!focusId) return map;

  const known = new Set<string>([focusId]);
  for (const reply of replies) known.add(reply.id);

  for (const reply of replies) {
    if (reply.id === focusId) continue;
    const parentId = getReplyParentId(reply);
    if (parentId === null && reply.kind !== 1111) continue;
    const bucket = parentId && known.has(parentId) ? parentId : focusId;
    const existing = map.get(bucket);
    if (existing) existing.push(reply);
    else map.set(bucket, [reply]);
  }

  for (const children of map.values()) {
    children.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  }

  return map;
}
