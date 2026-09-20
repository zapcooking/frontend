/**
 * Tests for the NIP-92 imeta parser and the URL-fallback path.
 */

import { describe, it, expect } from 'vitest';
import { parseImeta, isImageUrl, isVideoUrl, imetaAltByUrl, buildImetaTagWithAlt } from './imeta';
import { scanNostrRefs } from '../nostrRefScan';
import { filterImageUrls } from '../imageUrls';

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

describe('imetaAltByUrl', () => {
  it('maps imeta urls to their alt text', () => {
    const event = {
      content: '',
      tags: [
        ['imeta', 'url https://x/a.jpg', 'm image/jpeg', 'alt A bowl of soup'],
        ['imeta', 'url https://x/b.jpg', 'alt A plate of noodles']
      ]
    };
    const map = imetaAltByUrl(event);
    expect(map.get('https://x/a.jpg')).toBe('A bowl of soup');
    expect(map.get('https://x/b.jpg')).toBe('A plate of noodles');
    expect(map.size).toBe(2);
  });

  it('omits imeta entries without url or without alt', () => {
    const event = {
      content: '',
      tags: [
        ['imeta', 'm image/jpeg'],
        ['imeta', 'url https://x/a.jpg', 'dim 10x10'],
        ['imeta', 'url https://x/b.jpg', 'alt has alt']
      ]
    };
    const map = imetaAltByUrl(event);
    expect(map.size).toBe(1);
    expect(map.get('https://x/b.jpg')).toBe('has alt');
  });

  it('returns an empty map when there are no imeta tags', () => {
    expect(imetaAltByUrl({ content: 'hi', tags: [] }).size).toBe(0);
    expect(imetaAltByUrl({}).size).toBe(0);
  });
});

describe('buildImetaTagWithAlt', () => {
  it('emits url and alt slots per NIP-92', () => {
    expect(buildImetaTagWithAlt('https://x/a.jpg', 'A bowl of soup')).toEqual([
      'imeta',
      'url https://x/a.jpg',
      'alt A bowl of soup'
    ]);
  });

  it('flattens newlines in alt so the value stays one slot', () => {
    const tag = buildImetaTagWithAlt('https://x/a.jpg', 'two\nlines');
    expect(tag[2]).toBe('alt two lines');
  });

  it('round-trips through parseImeta', () => {
    const tag = buildImetaTagWithAlt('https://x/a.jpg', 'A bowl of soup');
    const items = parseImeta({ content: `https://x/a.jpg`, tags: [tag] });
    expect(items[0].alt).toBe('A bowl of soup');
    expect(items[0].url).toBe('https://x/a.jpg');
  });

  // Real note, published from Amethyst, fetched live from relay.damus.io
  // (id 3957043a41de5c28…). Regression test for reading another client's
  // imeta: blossom URL + x/size/m/dim/blurhash/ox/alt slots.
  it('reads alt from a real Amethyst note (interop)', () => {
    const url =
      'https://npub1sjvt6lzmhj66gc3tjc5l4g3uhxz5lhaf4tqe2c0n5m92a0amffxq7veejj.blossom.band/ae8469f64b830b6eed6b1040cbfc4aaedb463c05cb2535fde0a062b652f2bd8f.jpg';
    const event = {
      content: `test image with alt text\n${url}`,
      tags: [
        ['r', url],
        ['p', '8498bd7c5bbcb5a4622b9629faa23cb9854fdfa9aac19561f3a6caaebfbb4a4c'],
        [
          'imeta',
          `url ${url}`,
          'x ae8469f64b830b6eed6b1040cbfc4aaedb463c05cb2535fde0a062b652f2bd8f',
          'size 78925',
          'm image/jpeg',
          'dim 1080x2340',
          'blurhash [57nB:~l=#m-~Xtb$lnh044oNfXf4q9FNfJz~Xx.%3M{~V.2-Ww4Mybpt8sp9HE3NeI.E3IDNbI:',
          'ox ae8469f64b830b6eed6b1040cbfc4aaedb463c05cb2535fde0a062b652f2bd8f',
          'alt TV test pattern'
        ],
        ['client', 'Amethyst']
      ]
    };

    // parseImeta carries the full NIP-92 field set.
    const items = parseImeta(event);
    expect(items).toEqual([
      {
        url,
        mime: 'image/jpeg',
        dim: { w: 1080, h: 2340 },
        blurhash: '[57nB:~l=#m-~Xtb$lnh044oNfXf4q9FNfJz~Xx.%3M{~V.2-Ww4Mybpt8sp9HE3NeI.E3IDNbI:',
        alt: 'TV test pattern',
        hash: 'ae8469f64b830b6eed6b1040cbfc4aaedb463c05cb2535fde0a062b652f2bd8f'
      }
    ]);

    // The render path's lookup: URLs extracted from the note body must
    // string-match the imeta `url` slot exactly, so the alt map hits.
    const bodyUrls = scanNostrRefs(event.content)
      .filter((ref) => ref.type === 'url' && ref.url)
      .map((ref) => ref.url as string);
    const imageUrls = filterImageUrls(bodyUrls);
    expect(imageUrls).toEqual([url]);

    const altMap = imetaAltByUrl(event);
    expect(altMap.get(imageUrls[0])).toBe('TV test pattern');
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
