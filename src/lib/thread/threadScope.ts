/**
 * Splits the events a mixed-thread fetch returned into the two halves the
 * thread page renders: the ancestor chain above the focused note (context
 * rows) and everything else (the subtree below it).
 *
 * The fetch targets the re-rooted conversation (`#e`/`#E` sibling filters
 * keyed on the root AND the focal id), so it returns the whole thread —
 * including the focused comment's own ancestors, which match `#E` just
 * like any other comment. Left unseparated, an ancestor would fall into
 * `buildReplyTree`'s unknown-parent bucket and render as a *child* of the
 * note it answers.
 */

import { getReplyParentId, type ParentableEvent } from './replyParent';

export interface ThreadScope<E> {
  /** Events on the focus's parent chain, oldest-context material. */
  ancestors: E[];
  /** Everything else — feeds the subtree under the focused note. */
  subtree: E[];
}

/**
 * Walks up from `focus` as far as the fetched events allow, and partitions
 * them: the parent chain becomes `ancestors`, the rest stays `subtree`.
 *
 * Orphans whose parent never arrived stay in `subtree` on purpose — that
 * is `buildReplyTree`'s "visible out of place beats invisible" bucket. The
 * focus itself, if the subscription also delivered it, lands in neither.
 */
export function splitThreadByFocus<E extends ParentableEvent>(
  focus: E,
  events: E[]
): ThreadScope<E> {
  const byId = new Map<string, E>();
  for (const e of events) {
    if (e.id && !byId.has(e.id)) byId.set(e.id, e);
  }

  const ancestorIds = new Set<string>();
  const seen = new Set<string>([focus.id]);
  let cursor: ParentableEvent | undefined = focus;
  while (cursor) {
    const parentId = getReplyParentId(cursor);
    if (!parentId || seen.has(parentId)) break;
    const parent = byId.get(parentId);
    if (!parent) break;
    seen.add(parentId);
    ancestorIds.add(parentId);
    cursor = parent;
  }

  const ancestors: E[] = [];
  const subtree: E[] = [];
  for (const e of events) {
    if (!e.id || e.id === focus.id) continue;
    if (ancestorIds.has(e.id)) ancestors.push(e);
    else subtree.push(e);
  }
  return { ancestors, subtree };
}
