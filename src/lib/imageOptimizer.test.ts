/**
 * Host-aware image sizing: the three-way routing table in $lib/imageOptimizer.
 *
 *   cloudflare  exactly the 9 origins allowlisted on the zap.cooking zone
 *   native      image.nostr.build, i.nostr.build, *.blossom.band
 *   weserv      everything else (the tail; code default, no env var)
 *
 * The old optimizer appended ?w=&q=&f=webp to every host, which only
 * nostr.build and blossom.band honour (nostr.build then served 360p for
 * w=640); the audit measured a 6 MB LCP image on /feed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '$env/dynamic/public';
import { optimizeImageUrl, avatarUrl, imageRoute, imageResizer, CF_ORIGINS, __setImageResizerForTests } from './imageOptimizer';
import { retryOriginal } from './imageRetry';

const PRIMAL = 'https://blossom.primal.net/df6e6a0b1c2d3e4f.jpg';
const IMGUR = 'https://i.imgur.com/abc123.jpg?x=1';
const NB = 'https://image.nostr.build/7f3a.jpg';
const BAND = 'https://cdn.blossom.band/sha256.png';
const TAIL = 'https://file.nostrmedia.com/p/abc/def.jpeg'; // today's /feed LCP host, below 1 % of posts

// The dashboard list (Images → Transformations → zap.cooking → Sources), 2026-10-09.
const DASHBOARD_ORIGINS = [
  'blossom.primal.net',
  'r2a.primal.net',
  'i.imgur.com',
  'share.yabu.me',
  'files.peakd.com',
  'live.staticflickr.com',
  'files.catbox.moe',
  'cdn.nostrcheck.me',
  'blossom.ditto.pub'
];

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

beforeEach(() => __setImageResizerForTests('cloudflare'));
afterEach(() => __setImageResizerForTests(null));

describe('routing table', () => {
  it('cloudflare: exactly the 9 dashboard origins (10-origin cap incl. zap.cooking), no more', () => {
    expect([...CF_ORIGINS].sort()).toEqual([...DASHBOARD_ORIGINS].sort());
    expect(CF_ORIGINS.size).toBe(9);
    for (const h of DASHBOARD_ORIGINS) expect(imageRoute(`https://${h}/x.jpg`)).toBe('cloudflare');
  });

  it('cloudflare origins match exactly: subdomains and look-alikes are not allowlisted', () => {
    expect(imageRoute('https://evil.blossom.primal.net/x.jpg')).toBe('weserv');
    expect(imageRoute('https://i.imgur.com.evil.example/x.jpg')).toBe('weserv');
    expect(imageRoute('https://imgur.com/x.jpg')).toBe('weserv');
    expect(imageRoute('https://BLOSSOM.PRIMAL.NET/x.jpg')).toBe('cloudflare'); // hostnames are case-insensitive
  });

  it('native: image.nostr.build, i.nostr.build and *.blossom.band only', () => {
    expect(imageRoute(NB)).toBe('native');
    expect(imageRoute('https://i.nostr.build/7f3a.jpg')).toBe('native');
    expect(imageRoute(BAND)).toBe('native');
    expect(imageRoute('https://npub1abc.blossom.band/sha256')).toBe('native');
    expect(imageRoute('https://nostr.build/i/7f3a.jpg')).toBe('weserv');
    expect(imageRoute('https://blossom.band.evil.example/x')).toBe('weserv');
  });

  it('tail: everything else goes to weserv, including hosts that used to get ?w= appended', () => {
    for (const u of [TAIL, 'https://relay.utxo.one/abc.jpg', 'https://upload.wikimedia.org/a.png', 'https://yosuke4061.com/a.jpg']) {
      expect(imageRoute(u)).toBe('weserv');
    }
  });

  it('skip: data:, blob:, relative, SVG and already-resized URLs', () => {
    for (const u of ['data:image/png;base64,AAAA', 'blob:https://x/1', '/local.png', 'https://x.test/a.svg', 'https://images.weserv.nl/?url=x', `/cdn-cgi/image/width=1/${PRIMAL}`]) {
      expect(imageRoute(u)).toBe('skip');
      expect(optimizeImageUrl(u, { width: 640 })).toBe(u);
    }
  });
});

describe('tail default needs no env var', () => {
  it('with no override and no PUBLIC_IMAGE_* in the environment, the tail is weserv', () => {
    __setImageResizerForTests(null);
    expect('PUBLIC_IMAGE_TAIL' in env).toBe(false);
    expect('PUBLIC_IMAGE_RESIZER' in env).toBe(false);
    const out = new URL(optimizeImageUrl(TAIL, { width: 800 }));
    expect(out.hostname).toBe('images.weserv.nl');
    expect(out.searchParams.get('url')).toBe(TAIL);
    expect(out.searchParams.get('w')).toBe('800');
    expect(out.searchParams.get('output')).toBe('webp');
    expect(out.searchParams.has('we')).toBe(true); // never enlarge
    // and class 1 defaults to the zone
    expect(imageResizer()).toBe('cloudflare');
  });

  it('PUBLIC_IMAGE_RESIZER only affects the cloudflare class (preview has no /cdn-cgi/image/)', () => {
    __setImageResizerForTests('weserv');
    expect(new URL(optimizeImageUrl(PRIMAL, { width: 640 })).hostname).toBe('images.weserv.nl');
    expect(new URL(optimizeImageUrl(NB, { width: 640 })).hostname).toBe('image.nostr.build');
    __setImageResizerForTests('off');
    expect(optimizeImageUrl(PRIMAL, { width: 640 })).toBe(PRIMAL);
    expect(new URL(optimizeImageUrl(TAIL, { width: 640 })).hostname).toBe('images.weserv.nl');
    expect(new URL(optimizeImageUrl(NB, { width: 640 })).hostname).toBe('image.nostr.build');
  });
});

describe('per-class URL shape', () => {
  it('cloudflare: /cdn-cgi/image/ on our zone, scale-down, format negotiated', () => {
    const out = optimizeImageUrl(PRIMAL, { width: 800, quality: 85 });
    expect(out).toBe(`/cdn-cgi/image/width=800,quality=85,fit=scale-down,format=auto/${PRIMAL}`);
    expect(optimizeImageUrl(IMGUR, { width: 640 })).toMatch(/^\/cdn-cgi\/image\//);
  });

  it('nostr.build: asks for the 720p rendition for tile sizes (w=640 meant 360p)', () => {
    const out = new URL(optimizeImageUrl(NB, { width: 640, quality: 85 }));
    expect(out.searchParams.get('w')).toBe('1280');
    expect(out.searchParams.get('f')).toBe('webp');
    expect(new URL(optimizeImageUrl(NB, { width: 160 })).searchParams.get('w')).toBe('640');
  });

  it('blossom.band: w/q/f on the original host', () => {
    const out = new URL(optimizeImageUrl(BAND, { width: 640, quality: 80 }));
    expect(out.hostname).toBe('cdn.blossom.band');
    expect(out.searchParams.get('w')).toBe('640');
    expect(out.searchParams.get('q')).toBe('80');
  });

  it('never wraps a resizer URL twice', () => {
    for (const r of ['cloudflare', 'weserv'] as const) {
      __setImageResizerForTests(r);
      const once = optimizeImageUrl(PRIMAL, { width: 640 });
      expect(optimizeImageUrl(once, { width: 640 })).toBe(once);
      const tail = optimizeImageUrl(TAIL, { width: 640 });
      expect(optimizeImageUrl(tail, { width: 640 })).toBe(tail);
    }
  });

  it('a URL without a requested width is left alone on resizer classes', () => {
    expect(optimizeImageUrl(PRIMAL, {})).toBe(PRIMAL);
    expect(optimizeImageUrl(TAIL, {})).toBe(TAIL);
  });
});

describe('avatars follow the same table', () => {
  it('one route per class, square crop at the requested device pixels', () => {
    expect(avatarUrl(PRIMAL, 80)).toBe(`/cdn-cgi/image/width=80,height=80,fit=cover,quality=80,format=auto/${PRIMAL}`);
    const tail = new URL(avatarUrl(TAIL, 80)!);
    expect(tail.hostname).toBe('images.weserv.nl');
    expect(tail.searchParams.get('url')).toBe(TAIL);
    expect(tail.searchParams.get('fit')).toBe('cover');
    const band = new URL(avatarUrl(BAND, 80)!);
    expect(band.hostname).toBe('cdn.blossom.band');
    expect(band.searchParams.get('w')).toBe('80');
    expect(new URL(avatarUrl(NB, 80)!).hostname).toBe('image.nostr.build');
    expect(avatarUrl('data:image/png;base64,AAAA', 80)).toBeNull();
    __setImageResizerForTests('weserv');
    expect(new URL(avatarUrl(PRIMAL, 80)!).hostname).toBe('images.weserv.nl');
  });

  it('CustomAvatar tries the routed candidate first and keeps the raw URL as a fallback', () => {
    const src = read('components', 'CustomAvatar.svelte');
    expect(src).toMatch(/import \{ avatarUrl \} from '\$lib\/imageOptimizer'/);
    expect(src).toMatch(/return avatarUrl\(url, size \* 2\)/);
    const resized = src.indexOf('const resized = toResized(raw)');
    const raw = src.indexOf('candidates.push(raw)');
    expect(resized).toBeGreaterThan(0);
    expect(raw).toBeGreaterThan(resized);
    expect(src).not.toMatch(/cdn-cgi\/image/); // the zone URL is built in one place only
  });
});

describe('B1 fallback to the original stays for every class', () => {
  it('each class produces a different URL to fall back from, and the fallback fires exactly once', () => {
    for (const [u, cls] of [[PRIMAL, 'cloudflare'], [NB, 'native'], [BAND, 'native'], [TAIL, 'weserv']] as const) {
      const rewritten = optimizeImageUrl(u, { width: 640 });
      expect(imageRoute(u)).toBe(cls);
      expect(rewritten).not.toBe(u);
      const fallback = new Set<string>();
      expect(retryOriginal(fallback, rewritten, u)).toBe(true); // rewritten failed → load original
      expect(retryOriginal(fallback, u, u)).toBe(false); // original failed → real failure
    }
  });

  it('every tile renderer routes its image through the optimizer AND retries the original on error', () => {
    const carousel = read('components', 'MediaCarousel.svelte');
    expect(carousel).toMatch(/retryOriginal\(/);
    expect(carousel).toMatch(/on:error=\{\(e\) => handleImageError\(e, /);
    for (const f of ['FreshMiniPost.svelte', 'FreshRecipeBoxHero.svelte']) {
      const s = read('components', f);
      // B1: one `useOriginal` flip on error, kept as state so Svelte re-renders keep it
      expect(s, f).toMatch(/optimizeImageUrl\(/);
      expect(s, f).toMatch(/if \(!useOriginal && \w+ !== \w+\) useOriginal = true;/);
      expect(s, f).toMatch(/on:error=\{onImageError\}/);
    }
  });
});
