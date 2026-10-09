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

/**
 * Author spacing for a page that streams in (the first page): each post is
 * appended as it arrives, unless it would sit within `gap` of its author's
 * last post — then it is held until another author's post makes room. The
 * page's end (EOSE) adds the held posts and whatever the final page has
 * that didn't stream, spaced the same way, at the end. Nothing that was
 * placed ever moves or is reordered: what the reader sees mid-stream is
 * what stays. (Before this, the streamed list was replaced at EOSE by the
 * spaced page, and rows on screen jumped.)
 */
export class StreamSpacer<T extends { raw: { id: string; pubkey: string } }> {
  /** Placed so far, in order (a new array whenever it changes). */
  placed: T[] = [];
  private held: T[] = [];
  private ids = new Set<string>();

  constructor(private gap = AUTHOR_GAP) {}

  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** A streamed post: placed now if it fits, else held. Returns `placed`. */
  push(p: T): T[] {
    if (this.ids.has(p.raw.id)) return this.placed;
    this.ids.add(p.raw.id);
    this.held.push(p);
    this.drain();
    return this.placed;
  }

  /** Place every held post that is far enough from its author's last one, in arrival order. */
  private drain(): void {
    let changed = false;
    for (;;) {
      const window = this.placed.slice(-(this.gap - 1)).map((x) => x.raw.pubkey);
      const i = this.held.findIndex((x) => !window.includes(x.raw.pubkey));
      if (i === -1) break;
      const [p] = this.held.splice(i, 1);
      if (!changed) {
        this.placed = [...this.placed];
        changed = true;
      }
      this.placed.push(p);
    }
  }

  /**
   * The page ended: the held posts and the final page's posts not seen yet
   * are spaced after what is placed, and appended. Returns what was added.
   */
  finish(final: T[]): T[] {
    const rest = final.filter((p) => !this.ids.has(p.raw.id));
    for (const p of rest) this.ids.add(p.raw.id);
    const added = spaceAuthors(this.placed, [...this.held, ...rest], this.gap);
    this.held = [];
    if (added.length) this.placed = [...this.placed, ...added];
    return added;
  }
}
