import { describe, expect, it } from 'vitest';
import { isHumanReadablePostContent, postSnippet } from './postContentReadability';

describe('isHumanReadablePostContent', () => {
  it('accepts normal prose', () => {
    expect(isHumanReadablePostContent('Four sourdoughs today. Same three ingredients every time!')).toBe(true);
    expect(isHumanReadablePostContent('grilled cheeeeese #food #sourdough')).toBe(true);
  });

  it('rejects JSON payloads', () => {
    expect(isHumanReadablePostContent('{"kind":1068,"question":"lunch?","options":["a","b"]}')).toBe(false);
    expect(isHumanReadablePostContent('[1,2,3,{"x":"y"}]')).toBe(false);
  });

  it('rejects hex/base64 data walls', () => {
    expect(
      isHumanReadablePostContent(
        'aGVsbG8gd29ybGQgdGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgYmxvYiBvZiBkYXRh'
      )
    ).toBe(false);
    expect(
      isHumanReadablePostContent('0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9')
    ).toBe(false);
  });

  it('keeps prose that merely contains an identifier or URL', () => {
    expect(isHumanReadablePostContent('check this out npub1abc123 note1xyz this is great')).toBe(true);
    expect(isHumanReadablePostContent('my site is https://example.com and it rules')).toBe(true);
  });

  it('rejects a bare bech32 identifier', () => {
    expect(isHumanReadablePostContent('npub1c8l7xs9ztq7uty9xe3x8kfnnzx9fqwm5q2sq3q')).toBe(false);
    expect(isHumanReadablePostContent('nostr:note1qqs8x8vnycyha73grv380gmvlury4wtm')).toBe(false);
  });

  it('rejects empty and whitespace content', () => {
    expect(isHumanReadablePostContent('')).toBe(false);
    expect(isHumanReadablePostContent('   \n  ')).toBe(false);
    expect(isHumanReadablePostContent(undefined)).toBe(false);
  });

  it('allows German-style long words (short runs are fine)', () => {
    expect(isHumanReadablePostContent('Donaudampfschifffahrtsgesellschaftskapitän says hi')).toBe(true);
  });
});

describe('postSnippet', () => {
  it('normalizes whitespace and truncates', () => {
    expect(postSnippet('  a\n\nb   c  ')).toBe('a b c');
    expect(postSnippet('x'.repeat(200), 90)).toHaveLength(90);
  });

  it('returns empty string for missing content', () => {
    expect(postSnippet(null)).toBe('');
  });
});
