import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseTopics, nip11Url, loadTopics, resetTopicsForTests } from './topicList';

const DOC = {
  name: 'feed.zap.cooking',
  topics: {
    namespace: 'cooking.zap.topic',
    parents: [
      {
        slug: 'baking',
        name: 'Baking',
        topics: [
          { slug: 'sourdough', name: 'Sourdough' },
          { slug: 'bread', name: 'Bread' }
        ]
      },
      { slug: 'drinks', name: 'Drinks', topics: [{ slug: 'coffee', name: 'Coffee' }] }
    ]
  }
};

beforeEach(() => resetTopicsForTests());

describe('parseTopics', () => {
  it('reads groups and topics in order', () => {
    expect(parseTopics(DOC)).toEqual(DOC.topics.parents);
  });

  it('is empty without a topics field, or with a malformed one', () => {
    expect(parseTopics({ name: 'x' })).toEqual([]);
    expect(parseTopics(null)).toEqual([]);
    expect(parseTopics({ topics: { parents: 'nope' } })).toEqual([]);
  });

  it('drops bad slugs, missing names, empty groups and extra fields', () => {
    const doc = {
      topics: {
        parents: [
          { slug: 'Bad Slug', name: 'x', topics: [{ slug: 'a', name: 'A' }] },
          { slug: 'empty', name: 'Empty', topics: [] },
          {
            slug: 'ok',
            name: 'OK',
            synonyms: ['x'],
            topics: [
              { slug: 'fine', name: 'Fine', synonyms: ['y'] },
              { slug: 'noname' },
              { slug: 'x;drop', name: 'X' }
            ]
          }
        ]
      }
    };
    expect(parseTopics(doc)).toEqual([
      { slug: 'ok', name: 'OK', topics: [{ slug: 'fine', name: 'Fine' }] }
    ]);
  });
});

describe('loadTopics', () => {
  it('asks the feed relay for NIP-11 over HTTPS, once per session', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(DOC), { status: 200 }));
    expect(nip11Url()).toBe('https://feed.zap.cooking');
    const a = await loadTopics(fetchFn as unknown as typeof fetch);
    await loadTopics(fetchFn as unknown as typeof fetch);
    expect(a).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('https://feed.zap.cooking', {
      headers: { Accept: 'application/nostr+json' }
    });
  });

  it('returns [] on failure and tries again next time', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await loadTopics(failing as unknown as typeof fetch)).toEqual([]);
    const ok = vi.fn(async () => new Response(JSON.stringify(DOC), { status: 200 }));
    expect(await loadTopics(ok as unknown as typeof fetch)).toHaveLength(2);
  });
});
