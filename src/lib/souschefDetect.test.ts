/**
 * Tests for the unified Sous Chef input auto-detection.
 *
 * The contract is narrow on purpose — we want false-positive URL
 * detection to be impossible (a recipe pasted with a source link at
 * the top must NOT be routed to the rate-limited URL path), and we
 * want short partial input to stay in `null` state so the submit
 * button doesn't enable while the user is mid-keystroke.
 */

import { describe, it, expect } from 'vitest';
import { detectMode } from './souschefDetect';

const SAMPLE_URL = 'https://example.com/recipes/sheet-pan-chicken';
// A 30+ char string is the threshold for text mode. This sample is
// well above to make tests resilient to small phrasing tweaks.
const SAMPLE_RECIPE_TEXT =
  'Heat 2 tbsp olive oil in a large skillet over medium heat until shimmering.';

describe('detectMode', () => {
  describe('empty / whitespace input', () => {
    it('returns null for an empty string', () => {
      expect(detectMode('', false)).toBe(null);
    });

    it('returns null for whitespace-only input', () => {
      expect(detectMode('   ', false)).toBe(null);
      expect(detectMode('\n\n\t  ', false)).toBe(null);
    });
  });

  describe('URL detection', () => {
    it("returns 'url' for a single trimmed URL", () => {
      expect(detectMode(SAMPLE_URL, false)).toBe('url');
    });

    it("returns 'url' for a URL with leading/trailing whitespace", () => {
      expect(detectMode(`  ${SAMPLE_URL}  `, false)).toBe('url');
      expect(detectMode(`\n${SAMPLE_URL}\n`, false)).toBe('url');
    });

    it("accepts http:// in addition to https://", () => {
      expect(detectMode('http://example.com/recipe', false)).toBe('url');
    });

    it("is case-insensitive on the scheme", () => {
      expect(detectMode('HTTPS://Example.com/Recipe', false)).toBe('url');
    });
  });

  describe('text-mode false-positive guards', () => {
    it("routes a URL on line 1 with recipe text below to 'text'", () => {
      const input = `${SAMPLE_URL}\n\nIngredients:\n- 2 tbsp olive oil\n- 1 chicken breast`;
      expect(detectMode(input, false)).toBe('text');
    });

    it("routes a URL with trailing text on the same line to 'text'", () => {
      const input = `${SAMPLE_URL} this looks great`;
      expect(detectMode(input, false)).toBe('text');
    });

    it("routes 'see <url>' style citations to 'text'", () => {
      const input = `Sheet pan chicken — see ${SAMPLE_URL} for the original`;
      expect(detectMode(input, false)).toBe('text');
    });
  });

  describe('text detection', () => {
    it("returns 'text' for multi-line recipe text with no URL", () => {
      const input = 'Ingredients:\n- 2 cups flour\n- 1 tsp salt\n- 1 egg\n\nDirections:\n1. Mix dry ingredients.';
      expect(detectMode(input, false)).toBe('text');
    });

    it("returns 'text' for the sample recipe sentence (well over 30 chars)", () => {
      expect(detectMode(SAMPLE_RECIPE_TEXT, false)).toBe('text');
    });
  });

  describe('short-input threshold', () => {
    it('returns null for text under 30 chars with no URL', () => {
      expect(detectMode('chicken with rice', false)).toBe(null);
      expect(detectMode('quick recipe', false)).toBe(null);
    });

    it('returns null for text exactly at 29 chars', () => {
      const twentyNine = 'a'.repeat(29);
      expect(twentyNine.length).toBe(29); // sanity check
      expect(detectMode(twentyNine, false)).toBe(null);
    });

    it("returns 'text' for text exactly at the 30-char threshold", () => {
      const thirty = 'a'.repeat(30);
      expect(thirty.length).toBe(30); // sanity check
      expect(detectMode(thirty, false)).toBe('text');
    });
  });

  describe('image precedence', () => {
    it("returns 'image' when hasImage is true regardless of text", () => {
      expect(detectMode('', true)).toBe('image');
      expect(detectMode('   ', true)).toBe('image');
      expect(detectMode(SAMPLE_URL, true)).toBe('image');
      expect(detectMode(SAMPLE_RECIPE_TEXT, true)).toBe('image');
    });

    it("returns 'image' even when text would otherwise be a clean URL", () => {
      // Image always wins — we don't support multi-modal input in
      // Phase 1, so this is the intentional contract: a staged image
      // ignores any URL the user may have started pasting.
      expect(detectMode(SAMPLE_URL, true)).toBe('image');
    });
  });
});
