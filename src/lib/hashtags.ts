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
 * The food feed's hashtag spam cap. A note with more hashtags than this is
 * dropped wherever the food filter is active, counted as `hashtagCount`
 * counts: the greater of content hashtags and `t` tags. The composer shows
 * the same number as "n/5 tags" and disables its suggestion pills at it.
 *
 * 5 is under review. A live sample of 100 raw events rejected 69 on this cap.
 * About 61 of those were 100+ tag aggregators, correctly blocked, but the
 * 6–20 band was mostly genuine food posts, so the natural break is near 20.
 *
 * iOS and Android carry their own copies of this cap with no shared package.
 * A change here must be made in all three:
 *   - zapcooking/frontend:            src/lib/hashtags.ts (this file)
 *   - zapcooking/zapcooking_ios:      OnlyFoodFilter.swift  (`maxHashtags`)
 *   - zapcooking/zap_cooking_android: app/src/main/kotlin/cooking/zap/app/repo/OnlyFoodFilter.kt (`MAX_HASHTAGS`)
 */
export const MAX_HASHTAGS = 5;

/** How many hashtag tokens the body carries, as the feed counts them. */
export function countContentHashtags(content: string): number {
  if (!content) return 0;
  const matches = content.match(HASHTAG_PATTERN);
  return matches ? matches.length : 0;
}

/**
 * The hashtag count the cap is judged against: the greater of the tokens in
 * the body and the `t` tags on the event. Either one alone can carry spam.
 */
export function hashtagCount(content: string, tags: ReadonlyArray<ReadonlyArray<string>>): number {
  const contentHashtags = countContentHashtags(content);
  const tagHashtags = Array.isArray(tags)
    ? tags.filter((tag) => Array.isArray(tag) && tag[0] === 't').length
    : 0;
  return Math.max(contentHashtags, tagHashtags);
}

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
