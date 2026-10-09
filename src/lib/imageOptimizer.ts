/**
 * Image sizing for feed tiles.
 *
 * Posts link full-size photos (the audit measured a 6 MB JPEG as /feed's
 * LCP image and a 3.7 MB JPEG behind a 40 px avatar). This used to append
 * `?w=&q=&f=webp` to every host, which only nostr.build and blossom.band
 * honour — and nostr.build answered `w=640` with its 360p rendition, softer
 * than the screen. Everyone else (primal, imgur, nostrcheck, satellite,
 * self-hosted Blossom servers…) ignored the parameters and served originals.
 *
 * Now each host gets what it understands:
 *   - nostr.build family: its own renditions (`w=` picks the one at or below
 *     the requested width, so 720p for anything a feed tile shows);
 *   - blossom.band: honours `w`/`q`/`f`, kept as is;
 *   - allowlisted hosts (RESIZABLE_HOSTS): a resizer — Cloudflare Image
 *     Transformations on our own zone (`/cdn-cgi/image/…`, first-party,
 *     edge-cached, format negotiated by the browser) or images.weserv.nl —
 *     chosen by PUBLIC_IMAGE_RESIZER ('cloudflare' | 'weserv' | 'off');
 *   - any other host: the original URL (the zone only resizes from the
 *     allowlisted origins, so zap.cooking is not an open image proxy).
 *
 * A tile whose resized URL fails falls back to the original once
 * ($lib/imageRetry), so a host that is down for the resizer still renders.
 */
import { env } from '$env/dynamic/public';

export interface ImageOptimizationOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png' | 'auto';
  blur?: boolean;
}

export type ImageResizer = 'cloudflare' | 'weserv' | 'off';

let resizerOverride: ImageResizer | null = null;

/** Which resizer serves hosts without native sizing. Env wins; tests may override. */
export function imageResizer(): ImageResizer {
  if (resizerOverride) return resizerOverride;
  const v = String(env.PUBLIC_IMAGE_RESIZER || '').toLowerCase();
  if (v === 'weserv' || v === 'off') return v;
  return 'cloudflare';
}

export type ImageTail = 'original' | 'weserv';
let tailOverride: ImageTail | null = null;

/**
 * What a host OUTSIDE the allowlist gets: the original image (default — the
 * zone must never become an open proxy, and the long tail of hosts is
 * ~14 % of feed image URLs) or images.weserv.nl, a third-party resizer that
 * is not billed to us. PUBLIC_IMAGE_TAIL ('original' | 'weserv').
 */
export function imageTail(): ImageTail {
  if (tailOverride) return tailOverride;
  return String(env.PUBLIC_IMAGE_TAIL || '').toLowerCase() === 'weserv' ? 'weserv' : 'original';
}

/** Tests only. */
export function __setImageResizerForTests(r: ImageResizer | null, tail: ImageTail | null = null): void {
  resizerOverride = r;
  tailOverride = tail;
}

/** Hosts that implement nostr.build's rendition parameters. */
const NOSTR_BUILD = /(^|\.)nostr\.build$/i;
/** Hosts that honour `w`/`q`/`f` query parameters themselves. */
const QUERY_NATIVE = [/(^|\.)blossom\.band$/i];
/** Already a resizer URL: never wrap twice. */
const RESIZER_HOST = /(^|\.)images\.weserv\.nl$/i;
const CF_PATH = /^\/cdn-cgi\/image\//;

/**
 * Hosts the resizer may fetch from. The Cloudflare zone is configured for
 * these origins only (Images → Transformations → Sources), so a URL for any
 * other host would be refused there; the client therefore sends such images
 * un-resized rather than paying a failed request plus a fallback. The list
 * is the audit census: every host above ~1 % of image posts in the Fresh and
 * Global feeds (2026-10-08, 571 image URLs in 383 posts) plus redirect
 * targets. Together with the native-sizing hosts above it covers ~86 % of
 * feed image URLs.
 */
export const RESIZABLE_HOSTS: ReadonlyArray<string | RegExp> = [
  'blossom.primal.net',
  'r2a.primal.net', // where blossom.primal.net redirects
  'i.imgur.com',
  'image.nostr.build', // (served natively; listed for completeness)
  'i.nostr.build',
  /(^|\.)blossom\.band$/i, // per-user subdomains
  'share.yabu.me',
  'files.peakd.com',
  'live.staticflickr.com',
  'files.catbox.moe',
  'relay.utxo.one',
  'cdn.nostrcheck.me',
  'blossom.mypathtofire.de',
  'yosuke4061.com',
  'blossom.ditto.pub',
  'upload.wikimedia.org',
  'spatia-arcana.com'
];

export function isResizableHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return RESIZABLE_HOSTS.some((m) => (typeof m === 'string' ? h === m : m.test(h)));
}

function isSkippable(url: string): boolean {
  return (
    !url ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('/') ||
    /\.svg(\?|#|$)/i.test(url)
  );
}

/**
 * The URL a tile should load for `url` at roughly `options.width` device
 * pixels. Returns `url` unchanged for data/blob/relative/SVG and when
 * nothing applies.
 */
export function optimizeImageUrl(url: string, options: ImageOptimizationOptions = {}): string {
  if (isSkippable(url)) return url;

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return url;
  if (RESIZER_HOST.test(u.hostname) || CF_PATH.test(u.pathname)) return url;

  const width = options.width;
  const quality = options.quality ?? 85;

  if (NOSTR_BUILD.test(u.hostname)) {
    // nostr.build serves the rendition at or below `w` (640 → 360p, which
    // is too soft on a 2x screen); ask for 720p for anything tile-sized.
    const w = width !== undefined && width <= 480 ? 640 : 1280;
    u.searchParams.set('w', String(w));
    u.searchParams.set('q', String(quality));
    u.searchParams.set('f', 'webp');
    return u.toString();
  }

  if (QUERY_NATIVE.some((re) => re.test(u.hostname))) {
    if (width) u.searchParams.set('w', String(width));
    if (options.height) u.searchParams.set('h', String(options.height));
    u.searchParams.set('q', String(quality));
    u.searchParams.set('f', 'webp');
    return u.toString();
  }

  const resizer = imageResizer();
  if (resizer === 'off' || !width) return url;
  // Not an allowlisted origin: the zone would refuse it. Load the original,
  // or go through weserv when the tail is configured that way.
  const useWeserv = resizer === 'weserv' || (!isResizableHost(u.hostname) && imageTail() === 'weserv');
  if (!isResizableHost(u.hostname) && !useWeserv) return url;

  if (useWeserv) {
    const q = new URLSearchParams({
      url: url,
      w: String(width),
      q: String(quality),
      output: 'webp',
      fit: 'inside',
      we: '' // without enlargement
    });
    if (options.height) q.set('h', String(options.height));
    return `https://images.weserv.nl/?${q.toString()}`;
  }

  // Cloudflare Image Transformations on our zone. fit=scale-down never
  // enlarges; format=auto lets the browser's Accept pick AVIF/WebP.
  const opts = [
    `width=${width}`,
    options.height ? `height=${options.height}` : '',
    `quality=${quality}`,
    'format=auto',
    'fit=scale-down'
  ]
    .filter(Boolean)
    .join(',');
  return `/cdn-cgi/image/${opts}/${url}`;
}

/**
 * Create a progressive image loader
 */
export function createProgressiveImage(
  src: string,
  options: ImageOptimizationOptions = {}
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = optimizeImageUrl(src, options);
  });
}

/**
 * Check if browser supports WebP (cached after first call)
 */
let webPSupported: boolean | null = null;
export function supportsWebP(): boolean {
  if (webPSupported !== null) return webPSupported;
  if (typeof window === 'undefined') return false;

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;

  webPSupported = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  return webPSupported;
}

/**
 * Get optimal image format based on browser support. (The resizers negotiate
 * the format themselves; kept for callers that still pass it.)
 */
export function getOptimalFormat(): 'webp' | 'jpeg' {
  return supportsWebP() ? 'webp' : 'jpeg';
}

/**
 * Generate responsive image URLs for different screen sizes
 */
export function generateResponsiveImageUrls(
  baseUrl: string,
  sizes: number[] = [160, 320, 640, 1280]
): string[] {
  return sizes.map((size) =>
    optimizeImageUrl(baseUrl, {
      width: size,
      quality: size <= 320 ? 80 : 90,
      format: 'auto'
    })
  );
}

/**
 * Preload critical images
 */
export function preloadImage(src: string, options: ImageOptimizationOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = optimizeImageUrl(src, options);
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to preload image: ${src}`));
    document.head.appendChild(link);
  });
}
