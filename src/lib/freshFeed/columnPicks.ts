/**
 * What the /feed discovery column's lower panels show ("Cooks to follow",
 * "Fresh reads"; FeedDiscoveryRail). Pure, so the rules are testable: each
 * panel shows at most a few items, nothing it already shows elsewhere on
 * screen, and [] — the panel hidden — when nothing good is left.
 */

/** "Cooks to follow" shows this many. */
export const COOKS_SHOWN = 3;
/** "Fresh reads" shows this many. */
export const READS_SHOWN = 3;
/** Authors of this many of the feed's first posts are on screen at load: not suggested as cooks. */
export const FEED_AUTHORS_EXCLUDED = 10;

export interface CookLike {
  pubkey: string;
  name: string;
}

/**
 * Cooks to suggest, in the list's (daily rotated) order: never the reader,
 * someone they already follow, or anyone in `exclude` (people already on
 * screen: the feed's first authors, the "Around the table" author).
 * `following` null: the reader's follows couldn't be read; nobody is left
 * out for it (the Follow button still hides for a known follow).
 */
export function pickCooks<C extends CookLike>(
  cooks: C[],
  o: { viewer: string; following: ReadonlySet<string> | null; exclude: ReadonlySet<string> },
  n = COOKS_SHOWN
): C[] {
  const out: C[] = [];
  const seen = new Set<string>();
  for (const c of cooks) {
    const pk = c.pubkey.toLowerCase();
    if (!pk || !c.name || seen.has(pk)) continue;
    if (pk === o.viewer.toLowerCase() || o.following?.has(pk) || o.exclude.has(pk)) continue;
    seen.add(pk);
    out.push(c);
    if (out.length === n) break;
  }
  return out;
}

export interface ReadLike {
  id: string;
  author: { pubkey: string };
  imageUrl: string | null;
  publishedAt: number;
}

/**
 * The newest articles for "Fresh reads": the Reads section's curated
 * articles (already filtered as /reads filters them: `keep`), with a cover
 * image, not flagged by the spam rules, one per author, never by someone
 * already on screen in the column (`exclude`).
 */
export function pickReads<A extends ReadLike>(
  articles: A[],
  o: {
    keep: (a: A) => boolean;
    spam: ReadonlyMap<string, unknown>;
    exclude: ReadonlySet<string>;
  },
  n = READS_SHOWN
): A[] {
  const authors = new Set<string>();
  const out: A[] = [];
  for (const a of [...articles].sort((x, y) => y.publishedAt - x.publishedAt)) {
    const pk = a.author.pubkey.toLowerCase();
    if (!a.imageUrl || o.spam.has(a.id) || authors.has(pk) || o.exclude.has(pk)) continue;
    if (!o.keep(a)) continue;
    authors.add(pk);
    out.push(a);
    if (out.length === n) break;
  }
  return out;
}

/** The people on screen at load the column shouldn't repeat: the feed's first authors. */
export function feedAuthors(posts: { pubkey: string }[], n = FEED_AUTHORS_EXCLUDED): Set<string> {
  return new Set(posts.slice(0, n).map((p) => p.pubkey.toLowerCase()));
}
