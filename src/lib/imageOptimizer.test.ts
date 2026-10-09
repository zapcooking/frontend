/**
 * Host-aware image sizing.
 *
 * The old optimizer appended ?w=&q=&f=webp to every host. Only nostr.build
 * and blossom.band honour that; nostr.build then served its 360p rendition
 * for w=640, and everyone else (primal, imgur, nostrcheck, Blossom servers)
 * served the original — the audit measured a 6 MB LCP image on /feed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { optimizeImageUrl, __setImageResizerForTests, isResizableHost } from './imageOptimizer';

const PRIMAL = 'https://blossom.primal.net/df6e6a0b1c2d3e4f.jpg';
const IMGUR = 'https://i.imgur.com/abc123.jpg?x=1';
const NB = 'https://image.nostr.build/7f3a.jpg';
const BAND = 'https://cdn.blossom.band/sha256.png';

beforeEach(() => __setImageResizerForTests('cloudflare', 'original'));
afterEach(() => __setImageResizerForTests(null, null));

describe('hosts that ignore query parameters go through a resizer', () => {
  it('cloudflare: /cdn-cgi/image/ on our zone, scale-down, format negotiated', () => {
    const out = optimizeImageUrl(PRIMAL, { width: 800, quality: 85 });
    expect(out).toBe(`/cdn-cgi/image/width=800,quality=85,format=auto,fit=scale-down/${PRIMAL}`);
    expect(out).not.toMatch(/[?&]w=640/);
  });

  it('weserv: images.weserv.nl with the original as `url`, no enlargement', () => {
    __setImageResizerForTests('weserv');
    const out = new URL(optimizeImageUrl(IMGUR, { width: 640, quality: 85 }));
    expect(out.hostname).toBe('images.weserv.nl');
    expect(out.searchParams.get('url')).toBe(IMGUR);
    expect(out.searchParams.get('w')).toBe('640');
    expect(out.searchParams.get('output')).toBe('webp');
    expect(out.searchParams.has('we')).toBe(true);
  });

  it('off: the original URL, untouched (no ?w= that the host would ignore)', () => {
    __setImageResizerForTests('off');
    expect(optimizeImageUrl(PRIMAL, { width: 640 })).toBe(PRIMAL);
    expect(optimizeImageUrl(IMGUR, { width: 640 })).toBe(IMGUR);
  });

  it('never wraps a resizer URL twice', () => {
    const once = optimizeImageUrl(PRIMAL, { width: 640 });
    expect(optimizeImageUrl(once, { width: 640 })).toBe(once);
    __setImageResizerForTests('weserv');
    const w = optimizeImageUrl(PRIMAL, { width: 640 });
    expect(optimizeImageUrl(w, { width: 640 })).toBe(w);
  });
});

describe('hosts with native sizing keep their own parameters', () => {
  it('nostr.build: asks for the 720p rendition for tile sizes (w=640 meant 360p)', () => {
    const out = new URL(optimizeImageUrl(NB, { width: 640, quality: 85 }));
    expect(out.hostname).toBe('image.nostr.build');
    expect(out.searchParams.get('w')).toBe('1280');
    expect(out.searchParams.get('f')).toBe('webp');
    const small = new URL(optimizeImageUrl(NB, { width: 160 }));
    expect(small.searchParams.get('w')).toBe('640');
  });

  it('blossom.band: w/q/f on the original host', () => {
    const out = new URL(optimizeImageUrl(BAND, { width: 640, quality: 80 }));
    expect(out.hostname).toBe('cdn.blossom.band');
    expect(out.searchParams.get('w')).toBe('640');
    expect(out.searchParams.get('q')).toBe('80');
  });
});

describe('untouchable inputs', () => {
  it('data:, blob:, relative and SVG URLs pass through', () => {
    for (const u of ['data:image/png;base64,AAAA', 'blob:https://x/1', '/local.png', 'https://x.test/a.svg']) {
      expect(optimizeImageUrl(u, { width: 640 })).toBe(u);
    }
  });

  it('a URL without a requested width is left alone on resizer hosts', () => {
    expect(optimizeImageUrl(PRIMAL, {})).toBe(PRIMAL);
  });
});

describe('avatars load a resized source first', () => {
  it('CustomAvatar puts the resized candidate before the raw URL', () => {
    const src = readFileSync(join(__dirname, '..', 'components', 'CustomAvatar.svelte'), 'utf8');
    const resized = src.indexOf('const resized = toResized(raw)');
    const raw = src.indexOf('candidates.push(raw)');
    expect(resized).toBeGreaterThan(0);
    expect(raw).toBeGreaterThan(resized);
    expect(src).toMatch(/if \(resized\) candidates\.push\(resized\)/);
  });
});

describe('origin allowlist', () => {
  it('cloudflare: only allowlisted hosts get a zone URL; others load the original (default tail)', () => {
    const other = 'https://cdn.dribbble.com/userupload/19678798/file/original.jpg';
    expect(optimizeImageUrl(other, { width: 800 })).toBe(other);
    // weserv is not billed to our zone, so the allowlist does not apply there
    __setImageResizerForTests('weserv', 'original');
    expect(new URL(optimizeImageUrl(other, { width: 800 })).hostname).toBe('images.weserv.nl');
    expect(isResizableHost('npub1abc.blossom.band')).toBe(true);
    expect(isResizableHost('files.peakd.com')).toBe(true);
    expect(isResizableHost('evil.example')).toBe(false);
  });

  it('PUBLIC_IMAGE_TAIL=weserv sends non-allowlisted hosts through weserv instead of the original', () => {
    __setImageResizerForTests('cloudflare', 'weserv');
    const other = 'https://file.nostrmedia.com/p/abc/def.jpeg';
    const out = new URL(optimizeImageUrl(other, { width: 800 }));
    expect(out.hostname).toBe('images.weserv.nl');
    expect(out.searchParams.get('url')).toBe(other);
    // allowlisted hosts still go to Cloudflare
    expect(optimizeImageUrl(PRIMAL, { width: 800 })).toMatch(/^\/cdn-cgi\/image\//);
  });
});
