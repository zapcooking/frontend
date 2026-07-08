/**
 * Shared image-URL detection.
 *
 * Single source of truth for "does this URL point at an image?" and
 * "which image URLs does this raw note content contain?". The host-aware
 * heuristic originated in NoteContent.svelte; a weaker extension-only
 * copy existed in shareNoteImage.ts. New consumers (server-side URL
 * validation for /api/zappy/note-review, the note-review entry point)
 * must use this module; the older private copies should migrate here
 * rather than growing a fourth variant.
 *
 * Pure and environment-agnostic — safe to import from both client
 * components and server endpoints.
 */

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;

// Bare https?:// URL matcher for raw note content. Trailing punctuation
// that commonly follows a pasted URL in prose is stripped after the match.
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

/**
 * True when the URL plausibly points at an image: the pathname carries an
 * image extension, or the host is a known image CDN whose URLs often
 * omit one (nostr.build, imgur, primal's proxy, etc.). Invalid URLs are
 * never images.
 */
export function isImageUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    if (IMAGE_EXTENSIONS.test(urlObj.pathname)) return true;
    // Common image hosts that serve images without an extension.
    if (urlObj.hostname.includes('image.nostr.build')) return true;
    if (urlObj.hostname.includes('nostr.build') && urlObj.pathname.includes('/i/')) return true;
    if (urlObj.hostname.includes('imgur.com')) return true;
    if (urlObj.hostname.includes('imgproxy')) return true;
    if (urlObj.hostname.includes('primal.b-cdn.net')) return true;
    if (urlObj.hostname.includes('media.tenor.com')) return true;
    if (urlObj.hostname.includes('i.ibb.co')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Extract image URLs from raw note content (kind-1 text), in order of
 * appearance, deduplicated. Works on the raw string — unlike
 * NoteContent's internal parts-based extraction, this needs no parser
 * and is usable anywhere an NDKEvent's `content` is at hand.
 */
export function extractImageUrls(content: string): string[] {
  if (!content) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of content.match(URL_REGEX) ?? []) {
    // Strip punctuation that trails a URL embedded in prose.
    const url = raw.replace(/[.,;:!?]+$/, '');
    if (!seen.has(url) && isImageUrl(url)) {
      seen.add(url);
      result.push(url);
    }
  }
  return result;
}
