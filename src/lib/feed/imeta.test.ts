/**
 * Tests for the NIP-92 imeta parser and the URL-fallback path.
 */

import { describe, it, expect } from 'vitest';
import { parseImeta, isImageUrl, isVideoUrl } from './imeta';

describe('parseImeta', () => {
  it('returns empty for events with no media', () => {
    expect(parseImeta({ content: 'just text', tags: [] })).toEqual([]);
    expect(parseImeta({ content: '', tags: [] })).toEqual([]);
    expect(parseImeta({})).toEqual([]);
  });

  it('parses a single imeta tag with url + mime + dim + blurhash + alt', () => {
    const event = {
      content: '',
      tags: [
        [
          'imeta',
          'url https://nostr.build/i/x.jpg',
          'm image/jpeg',
          'dim 1920x1080',
          'blurhash LkO~xqj[ofa#fkj[ayj[~qfQayj[',
          'alt A bowl of soup'
        ]
      ]
    };
    const items = parseImeta(event);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      url: 'https://nostr.build/i/x.jpg',
      mime: 'image/jpeg',
      dim: { w: 1920, h: 1080 },
      blurhash: 'LkO~xqj[ofa#fkj[ayj[~qfQayj[',
      alt: 'A bowl of soup'
    });
  });

  it('parses multiple imeta tags in order', () => {
    const event = {
      content: '',
      tags: [
        ['imeta', 'url https://nostr.build/i/a.jpg', 'm image/jpeg'],
        ['imeta', 'url https://nostr.build/i/b.png', 'm image/png'],
        ['imeta', 'url https://nostr.build/i/c.gif', 'm image/gif']
      ]
    };
    const items = parseImeta(event);
    expect(items.map((i) => i.url)).toEqual([
      'https://nostr.build/i/a.jpg',
      'https://nostr.build/i/b.png',
      'https://nostr.build/i/c.gif'
    ]);
  });

  it('infers mime from extension when imeta omits `m`', () => {
    const event = {
      content: '',
      tags: [['imeta', 'url https://example.com/x.webp']]
    };
    expect(parseImeta(event)[0].mime).toBe('image/webp');
  });

  it('collects multiple `fallback` slots on a single tag', () => {
    const event = {
      content: '',
      tags: [
        [
          'imeta',
          'url https://primary/x.jpg',
          'fallback https://mirror1/x.jpg',
          'fallback https://mirror2/x.jpg'
        ]
      ]
    };
    const item = parseImeta(event)[0];
    expect(item.fallback).toEqual(['https://mirror1/x.jpg', 'https://mirror2/x.jpg']);
  });

  it('rejects imeta tags with no `url` slot', () => {
    const event = {
      content: '',
      tags: [
        ['imeta', 'm image/jpeg', 'dim 100x100'],
        ['imeta', 'url https://ok.example/x.jpg']
      ]
    };
    const items = parseImeta(event);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://ok.example/x.jpg');
  });

  it('ignores malformed `dim` values', () => {
    const event = {
      content: '',
      tags: [
        ['imeta', 'url https://example.com/x.jpg', 'dim not-a-dimension'],
        ['imeta', 'url https://example.com/y.jpg', 'dim 0x0'],
        ['imeta', 'url https://example.com/z.jpg', 'dim 800x600']
      ]
    };
    const items = parseImeta(event);
    expect(items[0].dim).toBeUndefined();
    expect(items[1].dim).toBeUndefined();
    expect(items[2].dim).toEqual({ w: 800, h: 600 });
  });

  it('preserves spaces inside the alt value', () => {
    const event = {
      content: '',
      tags: [['imeta', 'url https://x/a.jpg', 'alt A long alt with multiple words']]
    };
    expect(parseImeta(event)[0].alt).toBe('A long alt with multiple words');
  });

  it('captures the sha256 hash from `x`', () => {
    const event = {
      content: '',
      tags: [['imeta', 'url https://x/a.jpg', 'x abc123def456']]
    };
    expect(parseImeta(event)[0].hash).toBe('abc123def456');
  });

  it('falls back to URL extraction when no imeta tags are present', () => {
    const event = {
      content: 'check out https://nostr.build/i/photo.jpg and https://example.com/movie.mp4',
      tags: []
    };
    const items = parseImeta(event);
    expect(items.map((i) => i.url)).toEqual([
      'https://nostr.build/i/photo.jpg',
      'https://example.com/movie.mp4'
    ]);
    expect(items[0].mime).toBe('image/jpeg');
    expect(items[1].mime).toBe('video/mp4');
  });

  it('dedupes repeated URLs in the fallback path', () => {
    const event = {
      content: 'a https://x.com/a.png b https://x.com/a.png c',
      tags: []
    };
    expect(parseImeta(event)).toHaveLength(1);
  });

  it('does NOT merge imeta with content URLs when imeta is present', () => {
    // Damus/Amethyst/Jumble all behave this way — an event that
    // provides imeta is trusted to declare its full media set.
    const event = {
      content: 'https://content/in-body.jpg',
      tags: [['imeta', 'url https://imeta-only.jpg']]
    };
    const items = parseImeta(event);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://imeta-only.jpg');
  });

  it('strips trailing punctuation from content URLs', () => {
    const event = {
      content: 'See https://x.com/a.jpg, also https://y.com/b.png.',
      tags: []
    };
    const urls = parseImeta(event).map((i) => i.url);
    expect(urls).toContain('https://x.com/a.jpg');
    expect(urls).toContain('https://y.com/b.png');
  });

  it('skips non-image, non-video URLs in fallback extraction', () => {
    const event = {
      content: 'https://example.com/article and https://example.com/photo.jpg',
      tags: []
    };
    const items = parseImeta(event);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://example.com/photo.jpg');
  });

  it('classifies known image hosts without an extension', () => {
    const event = {
      content: 'https://image.nostr.build/abc123',
      tags: []
    };
    expect(parseImeta(event)).toHaveLength(1);
  });
});

describe('isImageUrl', () => {
  it('accepts common image extensions', () => {
    expect(isImageUrl('https://x.com/a.jpg')).toBe(true);
    expect(isImageUrl('https://x.com/a.JPEG')).toBe(true);
    expect(isImageUrl('https://x.com/a.png?cache=1')).toBe(true);
    expect(isImageUrl('https://x.com/a.webp')).toBe(true);
    expect(isImageUrl('https://x.com/a.avif')).toBe(true);
  });
  it('accepts known image hosts', () => {
    expect(isImageUrl('https://image.nostr.build/abc')).toBe(true);
    expect(isImageUrl('https://primal.b-cdn.net/foo')).toBe(true);
    expect(isImageUrl('https://i.ibb.co/bar')).toBe(true);
  });
  it('rejects malformed URLs and non-images', () => {
    expect(isImageUrl('not a url')).toBe(false);
    expect(isImageUrl('https://example.com/page')).toBe(false);
  });
});

describe('isVideoUrl', () => {
  it('accepts common video extensions', () => {
    expect(isVideoUrl('https://x.com/a.mp4')).toBe(true);
    expect(isVideoUrl('https://x.com/a.webm')).toBe(true);
    expect(isVideoUrl('https://x.com/a.MOV')).toBe(true);
  });
  it('rejects non-video URLs', () => {
    expect(isVideoUrl('https://x.com/a.jpg')).toBe(false);
    expect(isVideoUrl('not a url')).toBe(false);
  });
});
