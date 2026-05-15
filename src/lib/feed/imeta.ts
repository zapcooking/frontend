/**
 * NIP-92 `imeta` tag parser.
 *
 * NIP-92 attaches inline-media metadata to a note via repeated `imeta`
 * tags whose remaining slots are space-separated `key value` pairs:
 *
 *   ["imeta",
 *     "url https://nostr.build/i/x.jpg",
 *     "m image/jpeg",
 *     "dim 1920x1080",
 *     "blurhash LkO~xq...",
 *     "alt A bowl of soup",
 *     "x <sha256>",
 *     "fallback https://other.host/x.jpg"]
 *
 * Each tag describes ONE media URL. The `url` field is mandatory; the
 * rest are best-effort.
 *
 * When a note has no `imeta` tags we fall back to extracting raw URLs
 * from `event.content` and classifying them with the same heuristics
 * `NoteContent.svelte` uses today (extension + known-host list). The
 * fallback never produces `dim`, `blurhash`, or `alt` — those only come
 * from `imeta` tags or, in future phases, from a side-channel HEAD
 * probe (out of scope here).
 *
 * This module is framework-free and synchronous; safe to import in any
 * context (SSR or client).
 */

import type { MediaItem } from './types';

interface RawEventLike {
  content?: string;
  tags?: string[][];
}

// Extension regexes — mirror NoteContent.svelte so behavior matches the
// pre-overhaul feed exactly.
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv|m4v)(\?.*)?$/i;

// URL extraction regex. Matches http/https URLs anywhere in plain text;
// trailing punctuation (period, comma, paren, etc.) is trimmed below.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

// Trailing punctuation chars commonly attached to URLs in note text.
const TRAILING_PUNCT = /[.,;:!?)\]}>"'`]+$/;

/** Best-effort image-URL classifier. Mirrors `NoteContent.svelte`'s
 * `isImageUrl` so the fallback path produces the same media list the
 * old feed did. */
export function isImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (IMAGE_EXT.test(u.pathname)) return true;
    const host = u.hostname.toLowerCase();
    if (host.includes('image.nostr.build')) return true;
    if (host.includes('nostr.build') && u.pathname.includes('/i/')) return true;
    if (host.includes('imgur.com')) return true;
    if (host.includes('imgproxy')) return true;
    if (host.includes('primal.b-cdn.net')) return true;
    if (host.includes('media.tenor.com')) return true;
    if (host.includes('i.ibb.co')) return true;
    return false;
  } catch {
    return false;
  }
}

/** Best-effort video-URL classifier. */
export function isVideoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return VIDEO_EXT.test(u.pathname);
  } catch {
    return false;
  }
}

/** Parse the `dim` value from an imeta entry. Returns `undefined` for
 * malformed input rather than throwing. */
function parseDim(raw: string | undefined): { w: number; h: number } | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined;
  return { w, h };
}

/** Coarse MIME inference from URL extension when imeta `m` is absent. */
function inferMime(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.gif')) return 'image/gif';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.avif')) return 'image/avif';
    if (path.endsWith('.svg')) return 'image/svg+xml';
    if (path.endsWith('.bmp')) return 'image/bmp';
    if (path.endsWith('.mp4') || path.endsWith('.m4v')) return 'video/mp4';
    if (path.endsWith('.webm')) return 'video/webm';
    if (path.endsWith('.mov')) return 'video/quicktime';
    if (path.endsWith('.mkv')) return 'video/x-matroska';
  } catch {
    /* fall through */
  }
  // Coarse fallback: classify, but mark as wildcard so downstream code
  // knows the exact type is unknown.
  if (isVideoUrl(url)) return 'video/*';
  return 'image/*';
}

/** Walk an imeta tag's remaining slots and collect `key value` pairs
 * into a map. Per NIP-92 each slot has a single space separating the
 * key from the (possibly space-containing) value. */
function parseImetaSlots(tag: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  // Slot 0 is the literal "imeta"; skip.
  for (let i = 1; i < tag.length; i++) {
    const slot = tag[i];
    if (typeof slot !== 'string') continue;
    const sep = slot.indexOf(' ');
    if (sep === -1) continue;
    const key = slot.slice(0, sep).toLowerCase();
    const value = slot.slice(sep + 1).trim();
    if (!key || !value) continue;
    // `fallback` may appear multiple times within a single imeta tag —
    // collect them into a comma-separated holding string and split out
    // below. Other keys are last-write-wins, matching common practice.
    if (key === 'fallback' && out.fallback) {
      out.fallback = `${out.fallback}\n${value}`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Build a `MediaItem` from one imeta tag. Returns `null` if the tag
 * lacks a usable URL. */
function imetaToMediaItem(tag: string[]): MediaItem | null {
  const slots = parseImetaSlots(tag);
  const url = slots.url;
  if (!url) return null;
  const item: MediaItem = {
    url,
    mime: slots.m || inferMime(url)
  };
  const dim = parseDim(slots.dim);
  if (dim) item.dim = dim;
  if (slots.blurhash) item.blurhash = slots.blurhash;
  if (slots.alt) item.alt = slots.alt;
  if (slots.x) item.hash = slots.x;
  if (slots.fallback) {
    item.fallback = slots.fallback
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return item;
}

/** Extract bare image/video URLs from note content. Used as the fallback
 * when no `imeta` tags are present. Preserves source order and dedupes
 * — if the same URL appears twice in the body we only render once. */
function extractMediaUrls(content: string): MediaItem[] {
  if (!content) return [];
  const out: MediaItem[] = [];
  const seen = new Set<string>();
  const matches = content.match(URL_RE) || [];
  for (const raw of matches) {
    const cleaned = raw.replace(TRAILING_PUNCT, '');
    if (!cleaned || seen.has(cleaned)) continue;
    if (!isImageUrl(cleaned) && !isVideoUrl(cleaned)) continue;
    seen.add(cleaned);
    out.push({ url: cleaned, mime: inferMime(cleaned) });
  }
  return out;
}

/**
 * Parse media items from a Nostr event.
 *
 * Strategy:
 *   1. Collect all `imeta` tags. Each yields one MediaItem with the
 *      richest metadata available.
 *   2. If the event has zero usable imeta tags, fall back to scanning
 *      the content for bare URLs.
 *   3. The two paths are intentionally exclusive: an event that
 *      provides imeta is trusted to declare its full media set, so we
 *      do NOT merge imeta with content-extracted URLs (matches the
 *      behavior of Damus, Amethyst, and Jumble — and prevents
 *      double-rendering when a note links to its own imeta'd image).
 */
export function parseImeta(event: RawEventLike): MediaItem[] {
  const tags = event.tags || [];
  const imeta: MediaItem[] = [];
  for (const t of tags) {
    if (!Array.isArray(t) || t.length < 2 || t[0] !== 'imeta') continue;
    const item = imetaToMediaItem(t);
    if (item) imeta.push(item);
  }
  if (imeta.length > 0) return imeta;
  return extractMediaUrls(event.content || '');
}
