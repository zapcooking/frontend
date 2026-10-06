import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseTopics, parseFeatured, nip11Url, loadTopics, resetTopicsForTests } from './topicList';

const DOC = {
  name: 'feed.zap.cooking',
  topics: {
    namespace: 'cooking.zap.topic',
    featured_topics: [
      { slug: 'meat-seafood', label: 'Meat' },
      { slug: 'cakes', label: ' Cakes ' }
    ],
    parents: [
      {
        slug: 'baking',
        name: 'Baking',
        count_14d: 27,
        topics: [
          { slug: 'sourdough', name: 'Sourdough', count_14d: 6 },
          { slug: 'bread', name: 'Bread', count_14d: 11 }
        ]
      },
      { slug: 'drinks', name: 'Drinks', topics: [{ slug: 'coffee', name: 'Coffee' }] }
    ]
  }
};

beforeEach(() => resetTopicsForTests());

describe('parseTopics', () => {
  it('reads groups and topics in order, with their 14-day counts', () => {
    expect(parseTopics(DOC)).toEqual([
      {
        slug: 'baking',
        name: 'Baking',
        count14d: 27,
        topics: [
          { slug: 'sourdough', name: 'Sourdough', count14d: 6 },
          { slug: 'bread', name: 'Bread', count14d: 11 }
        ]
      },
      {
        slug: 'drinks',
        name: 'Drinks',
        count14d: 0,
        topics: [{ slug: 'coffee', name: 'Coffee', count14d: 0 }]
      }
    ]);
  });

  it('is empty without a topics field, or with a malformed one', () => {
    expect(parseTopics({ name: 'x' })).toEqual([]);
    expect(parseTopics(null)).toEqual([]);
    expect(parseTopics({ topics: { parents: 'nope' } })).toEqual([]);
  });

  it('drops bad slugs, missing names, empty groups; bad counts read as 0', () => {
    const doc = {
      topics: {
        parents: [
          { slug: 'Bad Slug', name: 'x', topics: [{ slug: 'a', name: 'A' }] },
          { slug: 'empty', name: 'Empty', topics: [] },
          {
            slug: 'ok',
            name: 'OK',
            count_14d: -3,
            topics: [
              { slug: 'fine', name: 'Fine', count_14d: 'many' },
              { slug: 'noname' },
              { slug: 'x;drop', name: 'X' }
            ]
          }
        ]
      }
    };
    expect(parseTopics(doc)).toEqual([
      { slug: 'ok', name: 'OK', count14d: 0, topics: [{ slug: 'fine', name: 'Fine', count14d: 0 }] }
    ]);
  });
});

describe('parseFeatured', () => {
  it('reads slugs and trimmed short labels in order', () => {
    expect(parseFeatured(DOC)).toEqual([
      { slug: 'meat-seafood', label: 'Meat' },
      { slug: 'cakes', label: 'Cakes' }
    ]);
  });
  it('null when absent (the caller falls back), bad entries dropped', () => {
    expect(parseFeatured({ topics: { parents: [] } })).toBeNull();
    expect(
      parseFeatured({
        topics: {
          featured_topics: [
            { slug: 'ok', label: 'OK' },
            { slug: 'Bad', label: 'x' },
            { slug: 'nolabel' }
          ]
        }
      })
    ).toEqual([{ slug: 'ok', label: 'OK' }]);
  });
});

describe('loadTopics', () => {
  it('asks the feed relay for NIP-11 over HTTPS, once per session', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(DOC), { status: 200 }));
    expect(nip11Url()).toBe('https://feed.zap.cooking');
    const a = await loadTopics(fetchFn as unknown as typeof fetch);
    await loadTopics(fetchFn as unknown as typeof fetch);
    expect(a.groups).toHaveLength(2);
    expect(a.featured).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('https://feed.zap.cooking', {
      headers: { Accept: 'application/nostr+json' }
    });
  });

  it('is empty on failure and tries again next time', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await loadTopics(failing as unknown as typeof fetch)).toEqual({
      groups: [],
      featured: null
    });
    const ok = vi.fn(async () => new Response(JSON.stringify(DOC), { status: 200 }));
    expect((await loadTopics(ok as unknown as typeof fetch)).groups).toHaveLength(2);
  });
});
