import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildLandingData,
  emptyLandingData,
  FEED_RELAY,
  LIST_RELAYS,
  PROFILE_RELAYS,
  mergeWithLastGood,
  moderateLandingData,
  getLandingData,
  __resetLandingMemo,
  FRESH_FOR_MS,
  type LandingData
} from './landingData.server';
import { ev, pk, relay, relays, FakeWebSocket, testVerify } from './fakeRelay.testutil';
import { ORG_PUBKEY } from './curation';
import { freshNote, JUST_SERVED_MAX_AGE_SECONDS, PUBLIC_FRESH_MAX_AGE_SECONDS } from './fresh';
import { EDITORIAL_EDITION_SECONDS, editionBucket } from './editorialConfig';
const NOW = 1_800_000_000;
const noBlocks = {
  blockedPubkeys: [] as string[],
  blockedEventIds: [] as string[],
  blockedNaddrs: [] as string[],
  denylist: [] as string[]
};
const catalog = {
  topics: {
    featured_topics: [
      { slug: 'japanese', label: 'Japanese food' },
      { slug: 'desserts', label: 'Desserts' },
      { slug: 'cheese', label: 'Cheese' }
    ],
    parents: [
      {
        slug: 'food',
        name: 'Food',
        topics: [
          { slug: 'japanese', name: 'Japanese food' },
          { slug: 'desserts', name: 'Desserts' },
          { slug: 'cheese', name: 'Cheese' }
        ]
      }
    ]
  }
};
const note = (id: string, text: string, slug: string, age = 60) =>
  ev({
    kind: 1,
    pubkey: pk(id),
    created_at: NOW - age,
    content: text,
    tags: [
      ['image', `https://example.com/${id}.jpg`],
      ['topic', slug]
    ]
  });
const deps = { now: () => NOW, verify: testVerify, fetchNip11: async () => catalog, timeoutMs: 20 };
beforeEach(() => {
  relays.clear();
  __resetLandingMemo();
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
});
afterEach(() => {
  delete (globalThis as { WebSocket?: unknown }).WebSocket;
});

describe('cached Fresh magazine discovery', () => {
  it('fetches bounded supported topics with source posts and profiles, excluding unrelated trusted-author posts', async () => {
    const japanese = note('a', 'Sushi for lunch', 'japanese');
    const dessert = note('b', 'Cookies cooling down', 'desserts');
    const cheese = note('c', 'Cheese from the market', 'cheese');
    const unrelated = note('d', 'Bitcoin price is up', 'cheese');
    const feed = relay(FEED_RELAY, [japanese, dessert, cheese, unrelated]);
    relay(LIST_RELAYS[0], [
      ev({
        kind: 30015,
        pubkey: ORG_PUBKEY,
        tags: [
          ['d', 'explore-topics'],
          ['t', 'japanese'],
          ['t', 'desserts'],
          ['t', 'cheese'],
          ['t', 'not-supported']
        ]
      })
    ]);
    relay(PROFILE_RELAYS[0], [
      ev({ kind: 0, pubkey: pk('a'), content: JSON.stringify({ name: 'Actual cook' }) })
    ]);
    const result = await buildLandingData(deps);
    expect(result.fresh.map((post) => post.id)).not.toContain(unrelated.id);
    expect(result.freshTopics?.map((topic) => topic.href)).toContain(
      '/feed?tab=fresh&topic=japanese'
    );
    expect(result.freshTopics?.find((topic) => topic.slug === 'japanese')?.post).toMatchObject({
      id: japanese.id,
      author: { name: 'Actual cook' }
    });
    expect(feed.reqs.some((filter) => filter.search === 'topic:not-supported')).toBe(false);
    expect(feed.reqs.filter((filter) => filter.search).every((filter) => filter.limit === 8)).toBe(
      true
    );
  });
  it('honors a signed empty topic list even when NIP-11 is unavailable', async () => {
    relay(LIST_RELAYS[0], [
      ev({
        kind: 30015,
        pubkey: ORG_PUBKEY,
        created_at: NOW,
        tags: [['d', 'explore-topics']]
      })
    ]);
    const result = await buildLandingData({ ...deps, fetchNip11: async () => null });
    expect(result.freshTopicList).toEqual({ version: NOW, slugs: [] });
    expect(result.settled).toContain('freshTopics');
    expect(result.settled).toContain('topics');
    const post = freshNote(note('a', 'Sushi for lunch', 'japanese'), NOW, noBlocks)!;
    const old = {
      ...emptyLandingData(NOW - 120),
      freshTopicList: { version: NOW - 120, slugs: ['japanese'] },
      freshTopics: [
        {
          slug: 'japanese',
          name: 'Japanese',
          href: '/feed?tab=fresh&topic=japanese',
          image: post.image,
          post
        }
      ],
      topics: [
        {
          slug: 'japanese',
          name: 'Japanese',
          href: '/tag/japanese',
          image: post.image,
          count: null
        }
      ]
    };
    const merged = mergeWithLastGood(result, old).data;
    expect(merged.freshTopics).toEqual([]);
    expect(merged.topics).toEqual([]);
  });
  it('keeps an empty editorial choice cached through list outages and older replies until a newer list reopens it', async () => {
    const post = freshNote(note('a', 'Sushi for lunch', 'japanese'), NOW, noBlocks)!;
    const tile = {
      slug: 'japanese',
      name: 'Japanese',
      href: '/feed?tab=fresh&topic=japanese',
      image: post.image,
      post
    };
    let clock = NOW * 1000;
    let build: LandingData = {
      ...emptyLandingData(NOW),
      freshTopicList: { version: 2, slugs: [] },
      settled: ['freshTopics', 'topics']
    };
    const waits: Promise<unknown>[] = [];
    const get = () =>
      getLandingData({
        clock: () => clock,
        waitUntil: (p) => waits.push(p),
        build: async () => build
      });
    expect((await get()).freshTopicList).toEqual({ version: 2, slugs: [] });
    const discovery = {
      ...emptyLandingData(NOW),
      freshTopics: [tile],
      topics: [
        {
          slug: 'japanese',
          name: 'Japanese',
          href: '/tag/japanese',
          image: post.image,
          count: null
        }
      ]
    };
    for (const list of [undefined, { version: 1, slugs: ['japanese'] }]) {
      clock += FRESH_FOR_MS + 1;
      build = {
        ...discovery,
        builtAt: Math.floor(clock / 1000),
        ...(list ? { freshTopicList: list } : {})
      };
      await get();
      await Promise.all(waits);
      const result = await get();
      expect(result.freshTopicList).toEqual({ version: 2, slugs: [] });
      expect(result.freshTopics).toEqual([]);
      expect(result.topics).toEqual([]);
    }
    clock += FRESH_FOR_MS + 1;
    build = {
      ...discovery,
      builtAt: Math.floor(clock / 1000),
      freshTopicList: { version: 3, slugs: ['japanese'] }
    };
    await get();
    await Promise.all(waits);
    const reopened = await get();
    expect(reopened.freshTopicList?.version).toBe(3);
    expect(reopened.freshTopics?.[0].post.id).toBe(post.id);
    clock += FRESH_FOR_MS + 1;
    build = {
      ...emptyLandingData(Math.floor(clock / 1000)),
      freshTopicList: { version: 2, slugs: [] },
      settled: ['freshTopics', 'topics']
    };
    await get();
    await Promise.all(waits);
    expect((await get()).freshTopics?.[0].post.id).toBe(post.id);
    expect((await get()).freshTopicList?.version).toBe(3);
  });
  it('removes expired and newly blocked notes from cached recent/topic selections on every read', async () => {
    const source = note('a', 'Bread from the oven', 'baking');
    const post = freshNote(source, NOW, noBlocks)!;
    const data = {
      ...emptyLandingData(NOW),
      fresh: [post],
      freshPool: [post],
      freshTopics: [
        {
          slug: 'baking',
          name: 'Baking',
          href: '/feed?tab=fresh&topic=baking',
          image: post.image,
          post
        }
      ]
    };
    let clock = NOW * 1000;
    const waits: Promise<unknown>[] = [];
    const get = () =>
      getLandingData({
        clock: () => clock,
        waitUntil: (p) => waits.push(p),
        build: async () => data
      });
    expect((await get()).fresh).toHaveLength(1);
    clock += (JUST_SERVED_MAX_AGE_SECONDS + 1) * 1000;
    expect((await get()).fresh).toEqual([]);
    expect((await get()).freshTopics).toHaveLength(1);
    await Promise.all(waits);
    clock = (NOW + PUBLIC_FRESH_MAX_AGE_SECONDS + 1) * 1000;
    expect((await get()).freshTopics).toEqual([]);
    const blocked = moderateLandingData(data, { ...noBlocks, blockedEventIds: [post.id] }, NOW);
    expect(blocked.fresh).toEqual([]);
    expect(blocked.freshTopics).toEqual([]);
  });
  it('persists a complete empty Fresh result instead of reviving a Fresh-only cache', async () => {
    const post = freshNote(note('a', 'Bread from the oven', 'baking'), NOW, noBlocks)!;
    let clock = NOW * 1000;
    let build: LandingData = { ...emptyLandingData(NOW), fresh: [post], freshPool: [post] };
    const waits: Promise<unknown>[] = [];
    const get = () =>
      getLandingData({
        clock: () => clock,
        waitUntil: (p) => waits.push(p),
        build: async () => build
      });
    expect((await get()).fresh).toHaveLength(1);
    clock += FRESH_FOR_MS + 1;
    build = { ...emptyLandingData(Math.floor(clock / 1000)), settled: ['fresh', 'freshTopics'] };
    await get();
    await Promise.all(waits);
    expect((await get()).fresh).toEqual([]);
  });
  it('holds approved stories and topic photographs within an edition while recent posts refresh normally', () => {
    const oldPost = freshNote(note('a', 'Sushi for lunch', 'japanese'), NOW, noBlocks)!;
    const newPost = freshNote(note('b', 'Fresh ramen for lunch', 'japanese', 5), NOW, noBlocks)!;
    const story = {
      type: 'article' as const,
      coordinate: `30023:${pk('a')}:bread`,
      href: '/reads/one',
      title: 'Bread traditions',
      image: 'https://example.com/bread.jpg',
      author: { pubkey: pk('a') },
      publishedAt: NOW
    };
    const list = { version: 1, coordinates: [story.coordinate] };
    const last = {
      ...emptyLandingData(NOW),
      readPool: [story],
      readList: list,
      readPoolBucket: editionBucket(NOW),
      fresh: [oldPost],
      freshTopics: [
        {
          slug: 'japanese',
          name: 'Japanese',
          href: '/feed?tab=fresh&topic=japanese',
          image: oldPost.image,
          post: oldPost
        }
      ],
      freshTopicsBucket: editionBucket(NOW)
    };
    const next = {
      ...last,
      builtAt: NOW + FRESH_FOR_MS / 1000,
      readPool: [{ ...story, title: 'Updated bread traditions' }],
      fresh: [newPost],
      freshTopics: [{ ...last.freshTopics[0], post: newPost, image: newPost.image }]
    };
    const merged = mergeWithLastGood(next, last).data;
    expect(merged.readPool?.[0].title).toBe('Bread traditions');
    expect(merged.fresh[0].id).toBe(newPost.id);
    expect(merged.freshTopics?.[0].post.id).toBe(oldPost.id);
    expect(
      mergeWithLastGood({ ...next, builtAt: NOW + EDITORIAL_EDITION_SECONDS }, last).data
        .readPool?.[0].title
    ).toBe('Updated bread traditions');
    expect(
      mergeWithLastGood({ ...next, readList: { version: 2, coordinates: [] } }, last).data.readPool
    ).toEqual([]);
  });
});
