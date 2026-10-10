import { describe, it, expect } from 'vitest';
import {
  isValidImageUrl,
  isNostrBuildImageUrl,
  isNostrBuildDeadUrl,
  getImageOrPlaceholder
} from './placeholderImages';

describe('isValidImageUrl', () => {
  it('accepts ordinary https URLs', () => {
    expect(isValidImageUrl('https://example.com/soup.jpg')).toBe(true);
  });

  it('rejects empty and whitespace-only values', () => {
    expect(isValidImageUrl(null)).toBe(false);
    expect(isValidImageUrl(undefined)).toBe(false);
    expect(isValidImageUrl('')).toBe(false);
    expect(isValidImageUrl('   ')).toBe(false);
  });

  it('rejects known-broken error-page URLs', () => {
    expect(isValidImageUrl('https://example.com/Ooops/404.png')).toBe(false);
    expect(isValidImageUrl('https://placeholder.com/600/400')).toBe(false);
    expect(isValidImageUrl('https://via.placeholder.com/300')).toBe(false);
  });
});

describe('nostr.build dead-image detection', () => {
  it('flags nostr.build hosts for verification', () => {
    expect(isNostrBuildImageUrl('https://image.nostr.build/abc.jpg')).toBe(true);
    expect(isNostrBuildImageUrl('https://cdn.nostr.build/abc.jpg')).toBe(true);
    expect(isNostrBuildImageUrl('https://example.com/abc.jpg')).toBe(false);
  });

  it('recognizes the CDN 404-art redirect target', () => {
    // Dead uploads 302 here with HTTP 200 — the browser happily renders the lion.
    expect(
      isNostrBuildDeadUrl('https://cdn.nostr.build/404/v2/nb404_v2_06_lion.jpg')
    ).toBe(true);
    expect(isNostrBuildDeadUrl('https://cdn.nostr.build/abc.jpg')).toBe(false);
    expect(isNostrBuildDeadUrl('https://image.nostr.build/abc.jpg')).toBe(false);
  });
});

describe('getImageOrPlaceholder', () => {
  it('falls back to a placeholder for known-broken URLs, not the broken URL', () => {
    const result = getImageOrPlaceholder('https://example.com/Ooops/sorry.png', 'seed');
    expect(result).toMatch(/^https:\/\/image\.nostr\.build\//);
  });

  it('returns a working URL untouched', () => {
    expect(getImageOrPlaceholder('https://example.com/soup.jpg', 'seed')).toBe(
      'https://example.com/soup.jpg'
    );
  });
});
