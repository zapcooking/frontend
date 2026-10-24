import { scanNostrRefs } from '$lib/nostrRefScan';

/**
 * Truncate a note's collapsed preview at a word boundary so the cut never
 * slices through a word. If anything the scanner linkifies — an explicit
 * URL, a bare domain, a nostr reference — straddles the limit, the cut is
 * extended past it instead: a linkable token with its path half-cut doesn't
 * match the scanner at all, so the preview would silently lose the link the
 * expanded note has (and a half-cut media URL loses the extension that
 * isImageUrl() classifies by).
 */
export function truncateAtUrlBoundary(text: string, limit: number): string {
  let hardLimit = limit;
  let extended = false;
  for (const ref of scanNostrRefs(text)) {
    if (ref.index < limit && ref.index + ref.content.length > limit) {
      hardLimit = ref.index + ref.content.length;
      extended = true;
      break;
    }
  }
  const cut = text.substring(0, hardLimit);
  // Already ending on a complete line (the next character is a newline, or
  // the text itself ends here) — nothing to back up.
  if (text[hardLimit] === '\n' || hardLimit >= text.length) return cut.trimEnd();
  // The collapsed preview ends on a COMPLETE line whenever one fits: a
  // half-line above "View more" reads as broken rendering, not as an
  // intentional cut. Only when the lines before the limit add up to almost
  // nothing (a near-single-line note) does a fallback run instead.
  const lastNewline = cut.lastIndexOf('\n');
  if (lastNewline > 0) {
    const lineCut = cut.substring(0, lastNewline).trimEnd();
    if (lineCut.length >= MIN_LINE_PREVIEW) return lineCut;
  }
  // A link already forced the cut past the limit — it ends on a whole token,
  // so return it as is (backing up to a space here would slice the link off).
  if (extended) return cut;
  // Back up to the last whitespace before the limit so the cut lands between
  // words, not mid-word.
  const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return (boundary > 0 ? cut.substring(0, boundary) : cut).trimEnd();
}

/** Shortest complete-line preview worth showing; below this the word-boundary
 *  fallback gives a better hint of what's ahead. */
const MIN_LINE_PREVIEW = 40;
