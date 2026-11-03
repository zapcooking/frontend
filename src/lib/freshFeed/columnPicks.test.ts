import { describe, it, expect } from 'vitest';
import {
  pickCooks,
  pickReads,
  feedAuthors,
  COOKS_SHOWN,
  READS_SHOWN,
  FEED_AUTHORS_EXCLUDED
} from './columnPicks';
import { decideFollowEdit, PURPLEPAGES } from '$lib/followSafety';

const cook = (pubkey: string, name = pubkey.toUpperCase()) => ({ pubkey, name });

describe('pickCooks', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f'].map((p) => cook(p));

  it(`shows ${COOKS_SHOWN} in the list's order`, () => {
    expect(
      pickCooks(list, { viewer: '', following: null, exclude: new Set() }).map((c) => c.pubkey)
    ).toEqual(['a', 'b', 'c']);
  });

  it('never the reader, someone they follow, or a person already on screen', () => {
    const picked = pickCooks(list, {
      viewer: 'A',
      following: new Set(['b']),
      exclude: new Set(['c', 'd'])
    });
    expect(picked.map((c) => c.pubkey)).toEqual(['e', 'f']);
  });

  it('is empty (the panel hides) when nobody is left, or the list is empty', () => {
    expect(
      pickCooks(list, {
        viewer: '',
        following: new Set(['a', 'b', 'c']),
        exclude: new Set(['d', 'e', 'f'])
      })
    ).toEqual([]);
    expect(pickCooks([], { viewer: '', following: null, exclude: new Set() })).toEqual([]);
  });

  it('skips nameless and repeated entries', () => {
    expect(
      pickCooks([cook('a', ''), cook('b'), cook('B')], {
        viewer: '',
        following: null,
        exclude: new Set()
      }).map((c) => c.pubkey)
    ).toEqual(['b']);
  });
});

const read = (
  id: string,
  pubkey: string,
  publishedAt: number,
  imageUrl: string | null = 'x.jpg'
) => ({
  id,
  author: { pubkey },
  imageUrl,
  publishedAt
});

describe('pickReads', () => {
  const keep = () => true;
  const none = new Map<string, unknown>();

  it(`shows the ${READS_SHOWN} newest, one per author`, () => {
    // a's second article (45) is newer than c's and d's: one per author leaves it out.
    const list = [
      read('1', 'a', 50),
      read('2', 'a', 45),
      read('3', 'b', 40),
      read('4', 'c', 30),
      read('5', 'd', 20)
    ];
    expect(pickReads(list, { keep, spam: none, exclude: new Set() }).map((a) => a.id)).toEqual([
      '1',
      '3',
      '4'
    ]);
  });

  it('needs a cover image, passes the spam rules and the Reads filter, and skips people on screen', () => {
    const list = [
      read('nocover', 'a', 60, null),
      read('spam', 'b', 50),
      read('hidden', 'c', 40),
      read('cook', 'd', 30),
      read('ok', 'e', 20)
    ];
    expect(
      pickReads(list, {
        keep: (a) => a.id !== 'hidden',
        spam: new Map([['spam', 'links']]),
        exclude: new Set(['d'])
      }).map((a) => a.id)
    ).toEqual(['ok']);
  });

  it('de-duplicates previews only among covered articles that pass the Reads filter', () => {
    // A preview names its full article (as a "full" tag does); the stand-in
    // drops a preview whose full article is in the list it is given.
    const withFull = (a: ReturnType<typeof read>, full?: string) => ({ ...a, full });
    const dedupe = <T extends { id: string; full?: string }>(list: T[]) =>
      list.filter((a) => !a.full || !list.some((b) => b.id === a.full));
    const list = [
      withFull(read('preview', 'a', 50), 'full'), // covered
      withFull(read('full', 'a', 40, null)), // no cover: not eligible
      withFull(read('preview2', 'b', 30), 'full2'),
      withFull(read('full2', 'b', 20)) // hidden by the Reads filter
    ];
    expect(
      pickReads(list, {
        keep: (a) => a.id !== 'full2',
        spam: none,
        exclude: new Set(),
        dedupe
      }).map((a) => a.id)
    ).toEqual(['preview', 'preview2']);
  });

  it('is empty (the panel hides) when nothing qualifies', () => {
    expect(pickReads([], { keep, spam: none, exclude: new Set() })).toEqual([]);
    expect(pickReads([read('1', 'a', 1, null)], { keep, spam: none, exclude: new Set() })).toEqual(
      []
    );
  });
});

describe('feedAuthors', () => {
  it(`takes the authors of the feed's first ${FEED_AUTHORS_EXCLUDED} posts`, () => {
    const posts = Array.from({ length: 12 }, (_, i) => ({ pubkey: `P${i}` }));
    const s = feedAuthors(posts);
    expect(s.size).toBe(FEED_AUTHORS_EXCLUDED);
    expect(s.has('p0') && s.has('p9') && !s.has('p10')).toBe(true);
  });
});

describe("Follow from the column (updateFollows' rule)", () => {
  it('adds the cook and keeps every existing follow, petname, relay hint, other tag and the content', () => {
    const existing = {
      id: 'list',
      created_at: 100,
      content: '{"wss://relay.example":{"read":true,"write":true}}',
      tags: [
        ['p', 'f1', 'wss://hint.example', 'Auntie'],
        ['p', 'f2'],
        ['t', 'sourdough']
      ]
    };
    const d = decideFollowEdit({
      answers: [{ url: PURPLEPAGES, ok: true, list: existing }],
      ownWrite: [],
      seen: null,
      add: ['cook']
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.tags).toEqual([
      ['t', 'sourdough'],
      ['p', 'f1', 'wss://hint.example', 'Auntie'],
      ['p', 'f2'],
      ['p', 'cook']
    ]);
    expect(d.content).toBe(existing.content);
    expect(d.count).toBe(3);
  });
});
