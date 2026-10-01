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
