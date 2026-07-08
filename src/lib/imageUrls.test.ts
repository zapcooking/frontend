import { describe, it, expect } from 'vitest';
import { isImageUrl, extractImageUrls, filterImageUrls } from './imageUrls';

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

describe('filterImageUrls', () => {
  it('filters, dedupes, and preserves first-occurrence order', () => {
    const A = 'https://example.com/a.jpg';
    const B = 'https://example.com/b.png';
    expect(filterImageUrls([A, 'https://example.com/page.html', B, A, ''])).toEqual([A, B]);
  });

  it('duplicate image URLs keep lightbox prev/next navigation correct after dedup', () => {
    // Mirrors NoteContent.svelte's exact index math: allImageUrls feeds
    // MediaLightbox positionally, and every open site resolves the pane
    // via allImageUrls.indexOf(url) (clamped to 0). A note posting the
    // same photo twice must not create a duplicate pane, and BOTH
    // rendered occurrences must open the single pane that shows it.
    const A = 'https://image.nostr.build/dish.jpg';
    const B = 'https://example.com/plated.png';
    const partsUrls = [A, A, B]; // note content: A appears twice

    const allImageUrls = filterImageUrls(partsUrls);
    expect(allImageUrls).toEqual([A, B]); // one pane per distinct image

    // Clicking either rendered occurrence of A resolves to pane 0.
    for (const clicked of [partsUrls[0], partsUrls[1]]) {
      const index = allImageUrls.indexOf(clicked);
      expect(index >= 0 ? index : 0).toBe(0);
    }
    // Clicking B resolves to pane 1; next from A is B, prev from B is A.
    expect(allImageUrls.indexOf(B)).toBe(1);
    expect(allImageUrls[allImageUrls.indexOf(A) + 1]).toBe(B);
    expect(allImageUrls[allImageUrls.indexOf(B) - 1]).toBe(A);
    // The counter shows the distinct-image count, not occurrence count.
    expect(allImageUrls).toHaveLength(2);
  });
});
