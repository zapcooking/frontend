/**
 * Server-only: probe an image's pixel dimensions and MIME type from its own
 * header bytes, without a full decode or a dependency like `sharp` (keeps
 * the worker bundle small — same constraint as the rest of the OG code).
 *
 * WHY this exists: Facebook's and LinkedIn's crawlers are known to silently
 * drop the image from a link preview when `og:image:width`/`height` aren't
 * supplied, even when `og:image` itself is a valid, reachable URL — see
 * docs/plans/og-missing-images-fix.md. This lets `recipeOgHtml.server.ts`
 * emit those tags for every card (recipe, note, profile, reads) from one
 * shared fetch-and-probe helper.
 *
 * Supports JPEG, PNG, and WebP (lossy VP8, lossless VP8L, extended VP8X) —
 * covers every host observed in the investigation (blossom.primal.net,
 * image.nostr.build, and arbitrary note-embedded URLs). Never throws; any
 * failure (network, timeout, unrecognized format) resolves to `null` so the
 * caller can omit the dimension tags and fall back to today's behavior.
 */

export interface ImageDimensions {
  width: number;
  height: number;
  /** MIME type inferred from the parsed format, e.g. "image/jpeg". */
  mime: string;
}

const FETCH_TIMEOUT_MS = 2500;
// Enough header bytes for any JPEG SOF marker in practice (large EXIF/ICC
// profiles before SOF are rare but do happen), while staying small.
const MAX_PROBE_BYTES = 256 * 1024;

const cache = new Map<string, ImageDimensions | null>();
// Cap so a long-running worker instance can't grow this unboundedly across
// many distinct images shared over time.
const CACHE_MAX_ENTRIES = 500;

function cacheSet(url: string, value: ImageDimensions | null): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, value);
}

/** JPEG: scan markers for the first SOF (Start Of Frame) segment. */
function parseJpeg(buf: Uint8Array): ImageDimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    // Fill byte, or a marker with no length-prefixed segment.
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buf.length) return null;
    const segLen = (buf[offset + 2] << 8) | buf[offset + 3];
    // SOF0–SOF15 except DHT(C4)/JPG(C8)/DAC(CC), which share the C0-CF range
    // but aren't frame headers.
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (offset + 9 > buf.length) return null;
      const height = (buf[offset + 5] << 8) | buf[offset + 6];
      const width = (buf[offset + 7] << 8) | buf[offset + 8];
      if (width <= 0 || height <= 0) return null;
      return { width, height, mime: 'image/jpeg' };
    }
    // Start Of Scan — dimensions should have appeared before this; bail.
    if (marker === 0xda) return null;
    if (segLen < 2) return null;
    offset += 2 + segLen;
  }
  return null;
}

/** PNG: fixed-offset IHDR chunk (always the first chunk after the signature). */
function parsePng(buf: Uint8Array): ImageDimensions | null {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24) return null;
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) return null;
  // Bytes 12-15 must be "IHDR".
  if (!(buf[12] === 0x49 && buf[13] === 0x48 && buf[14] === 0x44 && buf[15] === 0x52)) return null;
  const width = ((buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19]) >>> 0;
  const height = ((buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23]) >>> 0;
  if (width <= 0 || height <= 0) return null;
  return { width, height, mime: 'image/png' };
}

/** WebP: RIFF container, dispatch on the VP8/VP8L/VP8X sub-chunk. */
function parseWebp(buf: Uint8Array): ImageDimensions | null {
  if (buf.length < 30) return null;
  if (!(buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46)) return null; // "RIFF"
  if (!(buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50)) return null; // "WEBP"
  const fourcc = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
  const mime = 'image/webp';

  if (fourcc === 'VP8 ') {
    // Lossy: 14-bit width/height with 2-bit scale flags in the high bits.
    const w16 = buf[26] | (buf[27] << 8);
    const h16 = buf[28] | (buf[29] << 8);
    const width = w16 & 0x3fff;
    const height = h16 & 0x3fff;
    if (width <= 0 || height <= 0) return null;
    return { width, height, mime };
  }
  if (fourcc === 'VP8L') {
    // Lossless: a single 0x2f signature byte, then a 28-bit packed field:
    // 14 bits (width-1), 14 bits (height-1).
    if (buf[20] !== 0x2f) return null;
    const bits = buf[21] | (buf[22] << 8) | (buf[23] << 16) | (buf[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return { width, height, mime };
  }
  if (fourcc === 'VP8X') {
    // Extended format: 24-bit (width-1) and (height-1), little-endian.
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    if (width <= 0 || height <= 0) return null;
    return { width, height, mime };
  }
  return null;
}

function probeBuffer(buf: Uint8Array): ImageDimensions | null {
  return parseJpeg(buf) || parsePng(buf) || parseWebp(buf);
}

/**
 * Fetch just enough of `url` to read its dimensions, and cache the result
 * (including negative/null results, so a broken or unparseable image isn't
 * re-fetched on every subsequent card render). Never throws.
 */
export async function probeImageDimensions(url: string): Promise<ImageDimensions | null> {
  const cached = cache.get(url);
  if (cached !== undefined) return cached;

  let result: ImageDimensions | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          // Range keeps this to a header-sized fetch even for a multi-MB
          // photo; servers that ignore Range (206) just return the whole
          // body, which the SOF/IHDR scans below still find quickly.
          Range: `bytes=0-${MAX_PROBE_BYTES - 1}`
        }
      });
      if (res.ok || res.status === 206) {
        const buf = new Uint8Array(await res.arrayBuffer());
        result = probeBuffer(buf);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* network error, abort, or malformed response — result stays null */
  }

  cacheSet(url, result);
  return result;
}
