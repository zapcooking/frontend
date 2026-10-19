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
 * The newest articles for "Fresh reads", in /reads' order of operations
 * (table/FeedSection): first the articles with a cover that pass the Reads
 * filter (`keep`: relevance, curated hides), then preview de-duplication
 * (`dedupe`: a preview whose full article is listed drops out — so a full
 * article without a cover can't remove its covered preview), then the spam
 * rules, one per author, and never someone already on screen (`exclude`).
 */
export function pickReads<A extends ReadLike>(
  articles: A[],
  o: {
    keep: (a: A) => boolean;
    spam: ReadonlyMap<string, unknown>;
    exclude: ReadonlySet<string>;
    dedupe?: (list: A[]) => A[];
  },
  n = READS_SHOWN
): A[] {
  const eligible = articles.filter((a) => !!a.imageUrl && o.keep(a));
  const deduped = o.dedupe ? o.dedupe(eligible) : eligible;
  const authors = new Set<string>();
  const out: A[] = [];
  for (const a of [...deduped].sort((x, y) => y.publishedAt - x.publishedAt)) {
    const pk = a.author.pubkey.toLowerCase();
    if (o.spam.has(a.id) || authors.has(pk) || o.exclude.has(pk)) continue;
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
