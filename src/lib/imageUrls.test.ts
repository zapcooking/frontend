import { describe, it, expect } from 'vitest';
import { isImageUrl, extractImageUrls } from './imageUrls';

describe('isImageUrl', () => {
  it('accepts extension-bearing image URLs', () => {
    expect(isImageUrl('https://example.com/dish.jpg')).toBe(true);
    expect(isImageUrl('https://example.com/dish.jpeg?w=800')).toBe(true);
    expect(isImageUrl('https://example.com/a/b/dish.WEBP')).toBe(true);
    expect(isImageUrl('https://example.com/dish.avif')).toBe(true);
  });

  it('accepts known image hosts without an extension', () => {
    expect(isImageUrl('https://image.nostr.build/abc123')).toBe(true);
    expect(isImageUrl('https://nostr.build/i/abc123')).toBe(true);
    expect(isImageUrl('https://i.ibb.co/xyz/photo')).toBe(true);
    expect(isImageUrl('https://primal.b-cdn.net/media-cache?u=foo')).toBe(true);
  });

  it('rejects non-image URLs', () => {
    expect(isImageUrl('https://example.com/recipe.html')).toBe(false);
    expect(isImageUrl('https://example.com/video.mp4')).toBe(false);
    expect(isImageUrl('https://nostr.build/blog/post')).toBe(false);
    // extension in query only — pathname is what counts
    expect(isImageUrl('https://example.com/page?img=x.jpg')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isImageUrl('not a url')).toBe(false);
    expect(isImageUrl('')).toBe(false);
  });

  it('rejects lookalike hosts that only contain a trusted domain as a substring', () => {
    expect(isImageUrl('https://imgur.com.evil.example/abc')).toBe(false);
    expect(isImageUrl('https://image.nostr.build.evil.example/abc')).toBe(false);
    expect(isImageUrl('https://notimgur.com/abc')).toBe(false);
    expect(isImageUrl('https://evil.example/imgur.com/abc')).toBe(false);
    expect(isImageUrl('https://myimgproxyish.com/abc')).toBe(false);
  });

  it('still accepts real subdomains and imgproxy instances', () => {
    expect(isImageUrl('https://i.imgur.com/abc')).toBe(true);
    expect(isImageUrl('https://imgproxy.iris.to/foo/bar')).toBe(true);
  });
});

describe('extractImageUrls', () => {
  it('extracts image URLs from raw note content in order', () => {
    const content =
      'made this tonight https://image.nostr.build/aaa.jpg and plated it https://example.com/b.png';
    expect(extractImageUrls(content)).toEqual([
      'https://image.nostr.build/aaa.jpg',
      'https://example.com/b.png'
    ]);
  });

  it('ignores non-image URLs', () => {
    expect(extractImageUrls('see https://zap.cooking/recipe/123 for the recipe')).toEqual([]);
  });

  it('deduplicates repeated URLs', () => {
    const u = 'https://example.com/x.jpg';
    expect(extractImageUrls(`${u} again ${u}`)).toEqual([u]);
  });

  it('strips trailing prose punctuation', () => {
    expect(extractImageUrls('look: https://example.com/x.jpg!')).toEqual([
      'https://example.com/x.jpg'
    ]);
  });

  it('handles empty and image-free content', () => {
    expect(extractImageUrls('')).toEqual([]);
    expect(extractImageUrls('no links here')).toEqual([]);
  });
});
