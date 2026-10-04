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
 * The id of the conversation root for an event, or null if it opens one.
 *
 * For a NIP-22 comment this is its uppercase `E` — read BEFORE any
 * lowercase `e`, because a nested comment's `e` names its immediate
 * parent, which is another comment mid-thread, not the root. Callers use
 * this to target the thread fetch: sibling `#e`/`#E` filters keyed on the
 * root reach the whole mixed kind-1/kind-1111 tree, where the focal id
 * alone would only see direct replies.
 *
 * Kind-1 notes fall back to NIP-10: the marked `root` tag when present,
 * else the first `e` (the deprecated positional form names the root first).
 */
export function getThreadRootId(event: ParentableEvent): string | null {
  const tags = (event.tags || []).filter((t) => Array.isArray(t) && t.length > 1 && t[1]);

  if (event.kind === 1111) {
    const root = tags.find((t) => t[0] === 'E');
    if (root) return root[1];
  }

  const eTags = tags.filter((t) => t[0] === 'e' && t[3] !== 'mention');
  if (eTags.length === 0) return null;

  const marked = eTags.find((t) => t[3] === 'root');
  if (marked) return marked[1];

  return eTags[0][1];
}


/**
 * True when `event` is a kind-1 note replying to a kind-1111 comment.
 *
 * Comment threads are a 1111-only namespace: a kind 1 whose reply target
 * is a comment belongs to the main feed, not the comment subtree, so the
 * thread tree hides it and it must not count as a reply (the same rule as
 * barrydeen/wisp#667 on Android and wisp-ios#481). Detection reads the
 * `k` tag when the replying client emitted one, and otherwise resolves
 * the reply target's kind through `parentKindOf` (the caller's id→kind
 * map). An unresolvable parent returns false — an unknown parent counts
 * as a normal reply rather than a dropped one.
 */
export function isStrayKind1OnComment(
  event: ParentableEvent,
  parentKindOf: (id: string) => number | undefined
): boolean {
  if (event.kind !== 1) return false;
  const tags = (event.tags || []).filter((t) => Array.isArray(t) && t.length > 1 && t[1]);
  if (tags.some((t) => t[0] === 'k' && t[1] === '1111')) return true;
  const parentId = getReplyParentId(event);
  if (parentId === null) return false;
  return parentKindOf(parentId) === 1111;
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
 *
 * Also dropped: a stray kind-1 whose reply target is a kind-1111 comment
 * (see `isStrayKind1OnComment`) — comment threads are a 1111-only
 * namespace, so a kind 1 there is a main-feed note, not a reply.
 */
export function buildReplyTree<E extends ParentableEvent>(
  focusId: string,
  replies: E[],
  focus?: ParentableEvent
): Map<string, E[]> {
  const map = new Map<string, E[]>();
  if (!focusId) return map;

  const known = new Set<string>([focusId]);
  for (const reply of replies) known.add(reply.id);

  // Kind resolution for the stray check: every event in the set, plus the
  // focused event when the caller passed it (a kind-1 directly answering
  // the focused comment is as much a stray as one answering a nested one).
  const kindById = new Map<string, number | undefined>();
  for (const reply of replies) if (reply.kind) kindById.set(reply.id, reply.kind);
  if (focus?.kind) kindById.set(focusId, focus.kind);

  for (const reply of replies) {
    if (reply.id === focusId) continue;
    if (isStrayKind1OnComment(reply, (id) => kindById.get(id))) continue;
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
