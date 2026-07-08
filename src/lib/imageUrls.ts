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

// Hosts that commonly serve images WITHOUT a file extension. This list
// only rescues extensionless URLs — the extension test already admits
// any host, so it is a detection heuristic, not a trust boundary (per
// D2 our infra never fetches these URLs; OpenAI does).
const EXTENSIONLESS_IMAGE_HOSTS = [
  'image.nostr.build',
  'imgur.com',
  'primal.b-cdn.net',
  'media.tenor.com',
  'i.ibb.co'
];

// Exact domain or subdomain-of match. Never substring — 'imgur.com'
// must not match 'imgur.com.evil.example' or 'notimgur.com'.
function matchesHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * True when the URL plausibly points at an image: the pathname carries an
 * image extension, or the host is a known image CDN whose URLs often
 * omit one (nostr.build, imgur, primal's proxy, etc.). Invalid URLs are
 * never images.
 */
export function isImageUrl(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    if (IMAGE_EXTENSIONS.test(pathname)) return true;
    if (EXTENSIONLESS_IMAGE_HOSTS.some((d) => matchesHost(hostname, d))) return true;
    if (matchesHost(hostname, 'nostr.build') && pathname.includes('/i/')) return true;
    // Nostr clients run imgproxy instances under their own domains
    // (imgproxy.iris.to, imgproxy.snort.social, …) — match the host
    // label, not a substring.
    if (hostname.split('.').includes('imgproxy')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Filter candidate URLs down to image URLs, preserving first-occurrence
 * order and deduplicating. Dedup is load-bearing for lightbox
 * navigation: NoteContent resolves the pane index via
 * `allImageUrls.indexOf(url)`, so every occurrence of a repeated URL
 * must resolve to the single pane that renders it.
 */
export function filterImageUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    if (url && !seen.has(url) && isImageUrl(url)) {
      seen.add(url);
      result.push(url);
    }
  }
  return result;
}

/**
 * Extract image URLs from raw note content (kind-1 text), in order of
 * appearance, deduplicated. Works on the raw string — unlike
 * NoteContent's internal parts-based extraction, this needs no parser
 * and is usable anywhere an NDKEvent's `content` is at hand.
 */
export function extractImageUrls(content: string): string[] {
  if (!content) return [];
  // Strip punctuation that trails a URL embedded in prose.
  const candidates = (content.match(URL_REGEX) ?? []).map((raw) => raw.replace(/[.,;:!?]+$/, ''));
  return filterImageUrls(candidates);
}
