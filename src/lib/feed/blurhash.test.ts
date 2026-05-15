/**
 * Tests for the hand-ported blurhash decoder.
 *
 * Note: `blurhashToDataUrl` depends on a canvas implementation that
 * doesn't exist in the vitest jsdom environment, so it is tested
 * indirectly via `decodeBlurhash` (the pixel-buffer step) and through
 * `isValidBlurhash` (validation). The data-URL wrapping is exercised
 * by manual QA against the dev demo route in Phase 1.
 */

import { describe, it, expect } from 'vitest';
import { decodeBlurhash, isValidBlurhash, blurhashToDataUrl } from './blurhash';

// A canonical reference hash from the woltapp/blurhash README. Encodes
// a 1920x1080 photo with 4x3 components.
const REFERENCE_HASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

describe('isValidBlurhash', () => {
  it('accepts the canonical reference hash', () => {
    expect(isValidBlurhash(REFERENCE_HASH)).toBe(true);
  });
  it('rejects hashes that are too short', () => {
    expect(isValidBlurhash('L')).toBe(false);
    expect(isValidBlurhash('')).toBe(false);
    expect(isValidBlurhash(undefined)).toBe(false);
    expect(isValidBlurhash(null)).toBe(false);
  });
  it('rejects hashes whose declared component count mismatches the body length', () => {
    // Truncate one trailing char off a known-good hash.
    expect(isValidBlurhash(REFERENCE_HASH.slice(0, -1))).toBe(false);
  });
  it('rejects non-string inputs', () => {
    // @ts-expect-error testing runtime guard against wrong type
    expect(isValidBlurhash(42)).toBe(false);
  });
});

describe('decodeBlurhash', () => {
  it('returns an RGBA buffer of the requested size', () => {
    const pixels = decodeBlurhash(REFERENCE_HASH, 4, 3);
    expect(pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(pixels.length).toBe(4 * 3 * 4); // RGBA, 4 bytes per pixel
  });

  it('fills the alpha channel with 255', () => {
    const pixels = decodeBlurhash(REFERENCE_HASH, 8, 8);
    for (let i = 3; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(255);
    }
  });

  it('produces pixel values within the 0-255 range', () => {
    const pixels = decodeBlurhash(REFERENCE_HASH, 16, 16);
    for (let i = 0; i < pixels.length; i++) {
      expect(pixels[i]).toBeGreaterThanOrEqual(0);
      expect(pixels[i]).toBeLessThanOrEqual(255);
    }
  });

  it('produces a non-uniform image (real DC + AC components decoded)', () => {
    const pixels = decodeBlurhash(REFERENCE_HASH, 16, 16);
    const first = [pixels[0], pixels[1], pixels[2]];
    // The reference encodes a photo, not a flat color — at least one
    // pixel somewhere in the buffer must differ from the top-left.
    let differ = false;
    for (let i = 4; i < pixels.length; i += 4) {
      if (
        pixels[i] !== first[0] ||
        pixels[i + 1] !== first[1] ||
        pixels[i + 2] !== first[2]
      ) {
        differ = true;
        break;
      }
    }
    expect(differ).toBe(true);
  });

  it('throws on malformed input', () => {
    expect(() => decodeBlurhash('!!!', 4, 4)).toThrow();
    expect(() => decodeBlurhash('', 4, 4)).toThrow();
  });
});

describe('blurhashToDataUrl', () => {
  it('returns null for invalid input', () => {
    expect(blurhashToDataUrl(undefined)).toBeNull();
    expect(blurhashToDataUrl('')).toBeNull();
    expect(blurhashToDataUrl('!!!')).toBeNull();
  });

  it('returns null when no canvas implementation is available (SSR / jsdom)', () => {
    // jsdom's HTMLCanvasElement.getContext returns null without the
    // node-canvas peer dep, so this path exercises the safe-fail
    // contract: callers receive null and paint the bg-secondary
    // fallback tile.
    const out = blurhashToDataUrl(REFERENCE_HASH);
    // Accept either null (no canvas) or a data: URL (if a future env
    // provides one) — the contract is "never throws".
    expect(out === null || (typeof out === 'string' && out.startsWith('data:image/'))).toBe(true);
  });
});
