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
 * See the ROUTING TABLE below for how each host is sized.
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

/** Tests only. */
export function __setImageResizerForTests(r: ImageResizer | null): void {
  resizerOverride = r;
}

/**
 * ROUTING TABLE — the single place that decides how a feed image is sized.
 * Keep in sync with the Cloudflare dashboard (Images → Transformations →
 * zap.cooking → Sources, mode "Specified origins"). The dashboard caps the
 * list at 10 origins INCLUDING zap.cooking itself, so exactly 9 external
 * origins fit; a host that is in the code list but not in the dashboard is
 * refused by the zone (403) and costs a failed request before the fallback.
 * The code list and the dashboard list must change together.
 * Last synced: 2026-10-09 (Seth configured the dashboard; this list copies it).
 *
 *   1. CF_ORIGINS  → Cloudflare Image Transformations on our zone
 *                    (/cdn-cgi/image/…; first-party, edge-cached, billed to us,
 *                    bounded by this allowlist). Exact hostname match.
 *   2. native      → the host's own sizing parameters, no zone URL
 *                    (image.nostr.build, i.nostr.build renditions; *.blossom.band w/q/f).
 *   3. tail        → everything else through images.weserv.nl (third party,
 *                    not billed to us). This is the code default; no env needed.
 * PUBLIC_IMAGE_RESIZER ('cloudflare' | 'weserv' | 'off') is a kill switch for
 * class 1 only: 'weserv' sends CF_ORIGINS through weserv too (used on the
 * pages.dev preview, where the zone's /cdn-cgi/image/ does not exist), 'off'
 * loads them raw. Avatars (CustomAvatar) use the same table via avatarUrl().
 */
export const CF_ORIGINS: ReadonlySet<string> = new Set([
  'blossom.primal.net',
  'r2a.primal.net', // where blossom.primal.net redirects; the zone follows redirects
  'i.imgur.com',
  'share.yabu.me',
  'files.peakd.com',
  'live.staticflickr.com',
  'files.catbox.moe',
  'cdn.nostrcheck.me',
  'blossom.ditto.pub'
]);

/** nostr.build hosts that serve renditions via `w=` (and accept q/f). */
const NOSTR_BUILD_NATIVE: ReadonlySet<string> = new Set(['image.nostr.build', 'i.nostr.build']);
/** Hosts that honour `w`/`h`/`q`/`f` themselves. */
const QUERY_NATIVE = [/(^|\.)blossom\.band$/i];
/** Already a resizer URL: never wrap twice. */
const RESIZER_HOST = /(^|\.)images\.weserv\.nl$/i;
const CF_PATH = /^\/cdn-cgi\/image\//;

export type ImageRoute = 'cloudflare' | 'native' | 'weserv' | 'skip';

/** Which class a URL's host falls in (see the routing table above). */
export function imageRoute(url: string): ImageRoute {
  if (isSkippable(url)) return 'skip';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'skip';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'skip';
  if (RESIZER_HOST.test(u.hostname) || CF_PATH.test(u.pathname)) return 'skip';
  const h = u.hostname.toLowerCase();
  if (NOSTR_BUILD_NATIVE.has(h) || QUERY_NATIVE.some((re) => re.test(h))) return 'native';
  if (CF_ORIGINS.has(h)) return 'cloudflare';
  return 'weserv';
}

function weservUrl(url: string, q: Record<string, string>): string {
  const params = new URLSearchParams({ url, ...q, output: 'webp' });
  return `https://images.weserv.nl/?${params.toString()}`;
}

function cloudflareUrl(url: string, opts: string[]): string {
  return `/cdn-cgi/image/${[...opts, 'format=auto'].join(',')}/${url}`;
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
  const route = imageRoute(url);
  if (route === 'skip') return url;
  const u = new URL(url);
  const width = options.width;
  const quality = options.quality ?? 85;

  if (route === 'native') {
    if (NOSTR_BUILD_NATIVE.has(u.hostname.toLowerCase())) {
      // nostr.build serves the rendition at or below `w` (640 → 360p, too
      // soft on a 2x screen); ask for 720p for anything tile-sized.
      u.searchParams.set('w', String(width !== undefined && width <= 480 ? 640 : 1280));
    } else {
      if (width) u.searchParams.set('w', String(width));
      if (options.height) u.searchParams.set('h', String(options.height));
    }
    u.searchParams.set('q', String(quality));
    u.searchParams.set('f', 'webp');
    return u.toString();
  }

  if (!width) return url;
  const viaCloudflare = route === 'cloudflare' && imageResizer() === 'cloudflare';
  if (route === 'cloudflare' && imageResizer() === 'off') return url;
  if (!viaCloudflare) {
    const q: Record<string, string> = { w: String(width), q: String(quality), fit: 'inside', we: '' };
    if (options.height) q.h = String(options.height);
    return weservUrl(url, q);
  }
  // fit=scale-down never enlarges; format=auto lets the browser's Accept pick AVIF/WebP.
  const opts = [`width=${width}`, options.height ? `height=${options.height}` : '', `quality=${quality}`, 'fit=scale-down'].filter(Boolean);
  return cloudflareUrl(url, opts);
}

/**
 * An avatar at `px` device pixels, cropped square, by the same routing table:
 * CF origins → zone; native hosts → their parameters; everything else → weserv.
 * Returns null when nothing applies (data:, blob:, resizer URLs) so the
 * caller loads the raw URL.
 */
export function avatarUrl(url: string, px: number): string | null {
  const route = imageRoute(url);
  if (route === 'skip') return null;
  const size = Math.max(16, Math.round(px));
  if (route === 'native') {
    const u = new URL(url);
    if (NOSTR_BUILD_NATIVE.has(u.hostname.toLowerCase())) u.searchParams.set('w', '640');
    else {
      u.searchParams.set('w', String(size));
      u.searchParams.set('h', String(size));
    }
    u.searchParams.set('q', '80');
    u.searchParams.set('f', 'webp');
    return u.toString();
  }
  if (route === 'cloudflare' && imageResizer() === 'off') return null;
  if (route === 'cloudflare' && imageResizer() === 'cloudflare') {
    return cloudflareUrl(url, [`width=${size}`, `height=${size}`, 'fit=cover', 'quality=80']);
  }
  return weservUrl(url, { w: String(size), h: String(size), fit: 'cover', a: 'attention', q: '80' });
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
