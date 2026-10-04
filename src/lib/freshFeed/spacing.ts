/**
 * Author spacing: one cook posting several times in a row shouldn't fill the
 * screen. Each newly loaded page is reordered so the same author doesn't
 * appear twice within `gap` consecutive posts, where that's possible: a
 * post that would be too close is held back and placed at the earliest slot
 * that's far enough from the author's last post. Posts already on screen
 * never move; only the incoming page is reordered, and only by deferring
 * (a post is never moved up). If a page is all one author, the order stays
 * as it was.
 */

export const AUTHOR_GAP = 3;

export function spaceAuthors<T extends { raw: { pubkey: string } }>(
  before: T[],
  incoming: T[],
  gap = AUTHOR_GAP
): T[] {
  const recent = before.slice(-(gap - 1)).map((p) => p.raw.pubkey);
  const queue = [...incoming];
  const out: T[] = [];
  while (queue.length) {
    const window = [...recent, ...out.map((p) => p.raw.pubkey)].slice(-(gap - 1));
    const i = queue.findIndex((p) => !window.includes(p.raw.pubkey));
    out.push(queue.splice(i === -1 ? 0 : i, 1)[0]);
  }
  return out;
}
