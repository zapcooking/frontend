import { describe, expect, it } from 'vitest';
import {
  GIF_PAGE_SIZE,
  gifErrorMessage,
  gifFromItem,
  gifSearchUrl,
  gifSuggestUrl,
  gifTopicsFor,
  pageAdvanced,
  parseGifPage,
  parseGifSuggestions,
  shouldLoadMore
} from './gifSearch';

// Ported from Sidecar's test/gif-picker.test.js, the reference implementation.
// What matters is what a bad answer must not do: put a non-https link or an
// unknown format into a published note, or ask for an offset the API rejects.

const preview = (animated: string | null, still: string | null) => ({
  width: 240,
  height: 135,
  animated,
  still
});

function item(over: Record<string, unknown> = {}) {
  return {
    id: 'aa.gif',
    url: 'https://image.nostr.build/aa.gif',
    width: 480,
    height: 270,
    bytes: 123456,
    format: 'gif',
    title: ' Good morning ',
    previews: {
      small: preview(null, 'https://p/aa-s.png'),
      medium: preview(null, 'https://p/aa-m.png'),
      w240: preview('https://p/aa-240.webp', 'https://p/aa-240.png')
    },
    ...over
  };
}

describe('gifSearchUrl / gifSuggestUrl', () => {
  it('asks for safe results, one page at a time, through the proxy', () => {
    const u = new URL(gifSearchUrl('  good morning  ', 24), 'https://zap.cooking');
    expect(u.pathname).toBe('/api/gif-search');
    expect(u.searchParams.get('q')).toBe('good morning');
    expect(u.searchParams.get('offset')).toBe('24');
    expect(u.searchParams.get('limit')).toBe(String(GIF_PAGE_SIZE));
    expect(u.searchParams.get('safe')).toBe('1');
  });

  it('caps the query at 500 characters', () => {
    const u = new URL(gifSearchUrl('x'.repeat(900), 0), 'https://zap.cooking');
    expect(u.searchParams.get('q')).toHaveLength(500);
  });

  it('points suggestions at the suggest endpoint', () => {
    const u = new URL(gifSuggestUrl('gm'), 'https://zap.cooking');
    expect(u.pathname).toBe('/api/gif-suggest');
    expect(u.searchParams.get('limit')).toBe('6');
    expect(u.searchParams.get('safe')).toBe('1');
  });
});

describe('gifFromItem', () => {
  it('carries its link, its size and the animated w240 preview', () => {
    expect(gifFromItem(item())).toEqual({
      url: 'https://image.nostr.build/aa.gif',
      preview: 'https://p/aa-240.webp',
      width: 480,
      height: 270,
      title: 'Good morning'
    });
  });

  it('falls back to the first frame when the GIF is too big to animate', () => {
    const still = gifFromItem(item({ previews: { w240: preview(null, 'https://p/bb.png') } }));
    expect(still?.preview).toBe('https://p/bb.png');
  });

  it('falls back to the medium preview when there is no w240', () => {
    const medium = gifFromItem(item({ previews: { medium: preview(null, 'https://p/m.png') } }));
    expect(medium?.preview).toBe('https://p/m.png');
  });

  it('rejects anything that cannot go into a note as it is', () => {
    for (const bad of [
      item({ url: 'http://image.nostr.build/aa.gif' }),
      item({ url: 'javascript:alert(1)' }),
      item({ url: undefined }),
      item({ format: 'mp4' }),
      item({ width: 0 }),
      item({ height: 'tall' }),
      item({ previews: null }),
      item({ previews: { w240: preview('http://p/x.webp', null) } }),
      null,
      'aa.gif'
    ]) {
      expect(gifFromItem(bad)).toBeNull();
    }
  });
});

describe('parseGifPage', () => {
  it('drops what it cannot show and says where the next one starts', () => {
    const page = parseGifPage({ count: 3, offset: 0, items: [item(), item({ format: 'mp4' })] });
    expect(page.gifs).toHaveLength(1);
    // The offset counts every item the API sent, shown or not.
    expect(page.next).toBe(2);
    expect(parseGifPage({ count: 3, offset: 2, items: [item()] }).next).toBeNull();
  });

  it('stops paging at the list and at the last offset the API accepts', () => {
    expect(parseGifPage({ count: 200, offset: 192, items: Array(8).fill(item()) }).next).toBeNull();
    expect(parseGifPage({ count: 500, offset: 168, items: Array(24).fill(item()) }).next).toBe(192);
    expect(
      parseGifPage({ count: 500, offset: 192, items: Array(24).fill(item()) }).next
    ).toBeNull();
    // An empty page ends the list whatever count claims.
    expect(parseGifPage({ count: 50, offset: 0, items: [] }).next).toBeNull();
  });

  it('answers junk with an empty page', () => {
    expect(parseGifPage(null)).toEqual({ gifs: [], next: null });
    expect(parseGifPage({ items: 'nope' })).toEqual({ gifs: [], next: null });
  });
});

describe('parseGifSuggestions', () => {
  it('trims, dedupes and caps the terms', () => {
    const terms = parseGifSuggestions({
      terms: [
        { term: ' gm ' },
        { term: 'gm' },
        { term: '' },
        { nope: 1 },
        null,
        { term: 'gn' },
        { term: 'good' },
        { term: 'great' },
        { term: 'gg' },
        { term: 'go' },
        { term: 'gl' }
      ]
    });
    expect(terms).toEqual(['gm', 'gn', 'good', 'great', 'gg', 'go']);
    expect(parseGifSuggestions({})).toEqual([]);
  });
});

describe('gifErrorMessage', () => {
  it('reads a refused key or a down service as unavailable, not retryable', () => {
    expect(gifErrorMessage(403)).toBe('GIF search isn’t available right now.');
    expect(gifErrorMessage(401)).toBe('GIF search isn’t available right now.');
    expect(gifErrorMessage(503)).toBe('GIF search isn’t available right now.');
  });

  it('asks for patience on the rate limit', () => {
    expect(gifErrorMessage(429)).toBe('Too many searches. Try again in a minute.');
  });

  it('blames the connection for everything else', () => {
    expect(gifErrorMessage(500)).toMatch(/Couldn’t load GIFs/);
    expect(gifErrorMessage(0)).toMatch(/Couldn’t load GIFs/);
  });
});

describe('gifTopicsFor', () => {
  // gm leads 04:00–17:59 local; gn takes the evening and overnight.
  const at = (hh: number) => new Date(2026, 9, 2, hh, 30);

  it('opens on gm through the day', () => {
    expect(gifTopicsFor(at(4))[0]).toBe('gm');
    expect(gifTopicsFor(at(9))[0]).toBe('gm');
    expect(gifTopicsFor(at(17))[0]).toBe('gm');
  });

  it('opens on gn in the evening and overnight', () => {
    expect(gifTopicsFor(at(18))[0]).toBe('gn');
    expect(gifTopicsFor(at(21))[0]).toBe('gn');
    expect(gifTopicsFor(at(3))[0]).toBe('gn');
  });

  it('reorders without dropping a topic', () => {
    expect(gifTopicsFor(at(21))).toHaveLength(gifTopicsFor(at(9)).length);
  });
});

describe('paging', () => {
	const at = (o: Partial<Parameters<typeof shouldLoadMore>[0]>) =>
		shouldLoadMore({ loading: false, nextOffset: 24, scrollTop: 0, clientHeight: 600, scrollHeight: 700, ...o });

	it('loads the next page near the bottom, not while loading or after the last page', () => {
		expect(at({})).toBe(true); // 0 + 600 >= 700 − 160
		expect(at({ scrollHeight: 2000 })).toBe(false);
		expect(at({ loading: true })).toBe(false);
		expect(at({ nextOffset: null })).toBe(false);
	});

	it('re-checks only when the cursor moved forward (a duplicates-only page can not stall or loop)', () => {
		expect(pageAdvanced(0, 24)).toBe(true);
		expect(pageAdvanced(24, 24)).toBe(false);
		expect(pageAdvanced(48, 24)).toBe(false);
		expect(pageAdvanced(176, null)).toBe(false);
	});
});
