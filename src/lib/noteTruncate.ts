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
  for (const ref of scanNostrRefs(text)) {
    if (ref.index < limit && ref.index + ref.content.length > limit) {
      return text.substring(0, ref.index + ref.content.length);
    }
  }
  // Back up to the last whitespace before the limit so the cut lands between
  // words, not mid-word.
  const cut = text.substring(0, limit);
  const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return (boundary > 0 ? cut.substring(0, boundary) : cut).trimEnd();
}
