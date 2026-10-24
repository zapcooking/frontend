import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { truncateAtUrlBoundary } from './noteTruncate';

/**
 * The collapsed note preview must never cut through a token the scanner
 * would linkify — a half-cut URL or bare domain matches nothing, so the
 * preview silently loses the link the expanded note shows.
 */

const pad = (n: number, char = 'x') => char.repeat(n);

describe('truncateAtUrlBoundary', () => {
  it('extends the cut past a straddling bare domain and keeps its path', () => {
    const text = `${pad(60)} see ${'zap.cooking/pow'.padStart(20, 'y')} ${pad(60)}`;
    const domainStart = text.indexOf('zap.cooking');
    const limit = domainStart + 6; // cut lands mid-domain

    const truncated = truncateAtUrlBoundary(text, limit);
    expect(truncated.endsWith('zap.cooking/pow')).toBe(true);
    expect(truncated.length).toBeLessThan(text.length);
  });

  it('extends the cut past a straddling explicit URL (existing behavior)', () => {
    const url = 'https://example.com/photo.jpg';
    const text = `${pad(60)} ${url} ${pad(60)}`;
    const limit = text.indexOf(url) + 10;

    expect(truncateAtUrlBoundary(text, limit).endsWith(url)).toBe(true);
  });

  it('extends the cut past a straddling nostr reference', () => {
    const npub = nip19.npubEncode('a'.repeat(64));
    const text = `${pad(60)} ${npub} ${pad(60)}`;
    const limit = text.indexOf(npub) + 12;

    expect(truncateAtUrlBoundary(text, limit).endsWith(npub)).toBe(true);
  });

  it('cuts at the previous word when the limit lands inside a plain word', () => {
    const text = 'see zap.cooking/pow for more details';
    const limit = text.indexOf('more') + 2;

    expect(truncateAtUrlBoundary(text, limit)).toBe('see zap.cooking/pow for');
  });

  it('falls back to a word-boundary cut behind the limit with no links at all', () => {
    expect(truncateAtUrlBoundary('just some words here', 4)).toBe('just');
  });
});

describe('truncateAtUrlBoundary — complete-line previews', () => {
  const pad = (n: number, char = 'x') => char.repeat(n);

  it('ends the preview on the last full line before the limit', () => {
    const line1 = 'First line of the note.';
    const line2 = 'Second line, complete.';
    const line3 = 'Third line that the limit lands inside';
    const text = `${line1}\n${line2}\n${line3}\n${pad(60)}`;
    const limit = line1.length + 1 + line2.length + 10; // inside line3

    expect(truncateAtUrlBoundary(text, limit)).toBe(`${line1}\n${line2}`);
  });

  it('still ends on a full line when a link pushed the cut past the limit', () => {
    const url = 'https://example.com/photo.jpg';
    const line1 = pad(50);
    const line2 = `photo ${url}`;
    const line3 = 'a later line the extended cut lands inside';
    const text = `${line1}\n${line2}\n${line3}\n${pad(40)}`;
    const limit = line1.length + 8; // mid-"photo", before the url

    const truncated = truncateAtUrlBoundary(text, limit);
    // The url is preserved AND the preview still ends after line2.
    expect(truncated.endsWith(line2)).toBe(true);
    expect(truncated.includes(url)).toBe(true);
  });

  it('falls back to a word cut when the first line is nearly the whole budget', () => {
    // One short line, then a wall — a 2-char "line preview" would be worse
    // than a word cut.
    const text = `hi\n${pad(120)}`;
    const truncated = truncateAtUrlBoundary(text, 60);
    expect(truncated).toBe('hi');
    // 'hi' is under MIN_LINE_PREVIEW, so the fallback ran... and its last
    // whitespace is right after "hi" — same result, but never a partial word.
    expect(truncated.endsWith('x')).toBe(false);
  });

  it('keeps the single-paragraph word-boundary behavior unchanged', () => {
    const text = 'one two three four five six seven eight nine ten';
    expect(truncateAtUrlBoundary(text, 27)).toBe('one two three four five');
  });
});
