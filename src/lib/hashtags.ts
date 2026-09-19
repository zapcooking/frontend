/**
 * Hashtags in a kind-1 note body: the one pattern the feed and the composer
 * share, and the `t` tags derived from it at publish time.
 *
 * Before this module existed the composer published kind-1 notes with zero
 * `t` tags. Typed hashtags stayed in the body only. On web that went unnoticed
 * because the food feed's client-side content-word scan compensated, but every
 * relay-side `#t` filter (web's own Following/load-more queries, and the iOS
 * and Android OnlyFood feeds, which query kind-1 with `#t` over the food set)
 * could never match a web-authored note.
 *
 * The pattern is the food feed's hashtag pattern, unchanged: `#` at the start
 * of the text or after whitespace, followed by anything that is not whitespace
 * or another `#`. Keeping one pattern here means the feed's spam count and the
 * composer's derived tags cannot disagree about what a hashtag is.
 */

/** A hashtag token as the feed counts it. Group 2 is the raw tag text. */
export const HASHTAG_PATTERN = /(^|\s)#([^\s#]+)/g;

/**
 * Punctuation that ends a sentence but cannot end a hashtag. "Loving this
 * #foodstr." is the tag `foodstr`, not `foodstr.`. Trimmed from the derived
 * tag value only; the count is untouched.
 */
const TRAILING_PUNCTUATION = /[.,!?;:)\]}'"…]+$/;

/**
 * Every hashtag in `content`, in order of first appearance, lowercased and
 * de-duplicated, with trailing punctuation dropped. This is the value that goes
 * on the wire as `["t", tag]`, and the set a pill checks itself against.
 */
export function extractHashtags(content: string): string[] {
  if (!content) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  HASHTAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HASHTAG_PATTERN.exec(content)) !== null) {
    const tag = match[2].replace(TRAILING_PUNCTUATION, '').toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** The `t` tags for a note body: `extractHashtags` shaped for `event.tags`. */
export function buildHashtagTags(content: string): string[][] {
  return extractHashtags(content).map((tag) => ['t', tag]);
}
