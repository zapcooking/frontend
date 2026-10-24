/**
 * Feed images get one fallback to the original URL before they are hidden.
 *
 * The audit's render census found every missing image came from a host that
 * rejected the rewritten (resize-parameter) URL while the original loaded;
 * the tile was hidden permanently with no retry, although the lightbox (which
 * uses the original URL) opened the same image. The fallback lives in
 * component state so Svelte's re-renders keep it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { retryOriginal } from './imageRetry';

const ORIGINAL = 'https://relay.utxo.one/abc.jpg';
const REWRITTEN = `${ORIGINAL}?w=640&q=85&f=webp`;

describe('retryOriginal', () => {
  it('falls back once, then reports a real failure', () => {
    const fb = new Set<string>();
    expect(retryOriginal(fb, REWRITTEN, ORIGINAL)).toBe(true);
    expect(fb.has(ORIGINAL)).toBe(true);
    expect(retryOriginal(fb, ORIGINAL, ORIGINAL)).toBe(false);
  });

  it('does nothing when the src already is the original (nothing to fall back to)', () => {
    expect(retryOriginal(new Set(), ORIGINAL, ORIGINAL)).toBe(false);
  });

  it('ignores a missing original', () => {
    expect(retryOriginal(new Set(), REWRITTEN, '')).toBe(false);
  });
});

describe('every tile that loads a rewritten URL keeps its fallback as state', () => {
  it('MediaCarousel renders src from the fallback set', () => {
    const src = readFileSync(join(__dirname, '..', 'components', 'MediaCarousel.svelte'), 'utf8');
    expect(src).toMatch(/retryOriginal\(/);
    expect(src).toMatch(/src=\{srcFor\(/);
    expect(src).not.toMatch(/target\.src\s*=/);
  });
  for (const file of ['FreshMiniPost.svelte', 'FreshRecipeBoxHero.svelte']) {
    it(`${file} switches to the original through state`, () => {
      const src = readFileSync(join(__dirname, '..', 'components', file), 'utf8');
      expect(src).toMatch(/useOriginal/);
    });
  }
});
