import { describe, expect, it } from 'vitest';
import {
  freshNote,
  freshCardAllowed,
  isLandingFoodText,
  JUST_SERVED_MAX_AGE_SECONDS,
  PUBLIC_FRESH_MAX_AGE_SECONDS,
  selectFreshDiscovery,
  topicPostOverrides
} from './fresh';
import { ev, pk } from './fakeRelay.testutil';
import type { FreshTopicTile, NoteCard } from './content';
import { EDITORIAL_EDITION_SECONDS } from './editorialConfig';
const NOW = 1_800_000_000;
const lists = {
  blockedPubkeys: [] as string[],
  blockedEventIds: [] as string[],
  blockedNaddrs: [] as string[],
  denylist: [] as string[]
};
function card(id: string, age = 60, author = id): NoteCard {
  return {
    id,
    href: `/note-${id}`,
    text: 'Sourdough from the oven',
    image: `https://image.nostr.build/${id}.jpg`,
    author: { pubkey: pk(author), name: `Cook ${author}` },
    createdAt: NOW - age
  };
}
const tile = (slug: string, post: NoteCard): FreshTopicTile => ({
  slug,
  name: slug,
  href: '/old',
  image: post.image,
  post
});

describe('landing Fresh eligibility', () => {
  it('requires food relevance beyond a trusted author or a broad protocol/wellness tag', () => {
    expect(isLandingFoodText('Relay updates and bitcoin', ['bitcoin'])).toBe(false);
    expect(isLandingFoodText('My morning routine', ['wellness'])).toBe(false);
    for (const tag of ['gardening', 'homestead', 'farming', 'beekeeping', 'japanese']) {
      expect(isLandingFoodText('The roses are looking lovely', [tag])).toBe(false);
    }
    expect(isLandingFoodText('Tomatoes from the garden for dinner', ['gardening'])).toBe(true);
    expect(isLandingFoodText('Roasting carrots with garlic', ['homestead'])).toBe(true);
    expect(isLandingFoodText('Fresh bread from the oven')).toBe(true);
    expect(isLandingFoodText('Made this today', ['sourdough'])).toBe(true);
    expect(isLandingFoodText('Mint now to get our token airdrop', ['foodstr'])).toBe(false);
  });
  it('admits only public-window photo notes without replies, warnings or moderation blocks', () => {
    const source = ev({
      kind: 1,
      pubkey: pk('a'),
      created_at: NOW - 60,
      content: 'Bread',
      tags: [['image', 'https://example.com/bread.jpg']]
    });
    expect(freshNote(source, NOW, lists)?.text).toBe('Bread');
    expect(freshNote({ ...source, kind: 30023 }, NOW, lists)).toBeNull();
    expect(
      freshNote({ ...source, created_at: NOW - PUBLIC_FRESH_MAX_AGE_SECONDS - 1 }, NOW, lists)
    ).toBeNull();
    expect(freshNote({ ...source, created_at: NOW + 3600 }, NOW, lists)).toBeNull();
    expect(freshNote({ ...source, tags: [...source.tags, ['e', pk('b')]] }, NOW, lists)).toBeNull();
    expect(freshNote(source, NOW, { ...lists, blockedEventIds: [source.id] })).toBeNull();
    expect(
      freshNote({ ...source, tags: [...source.tags, ['content-warning', 'sensitive']] }, NOW, lists)
    ).toBeNull();
  });
  it('requires explicit editorial selection to show a caption-free topic photo, never to bypass moderation', () => {
    const source = ev({
      kind: 1,
      pubkey: pk('a'),
      created_at: NOW,
      content: 'A little moment',
      tags: [['image', 'https://example.com/one.jpg']]
    });
    expect(freshNote(source, NOW, lists)).toBeNull();
    const approved = freshNote(source, NOW, lists, true)!;
    expect(approved.editorial).toBe(true);
    expect(freshCardAllowed(approved, NOW, lists)).toBe(true);
    expect(freshCardAllowed(approved, NOW, { ...lists, blockedPubkeys: [pk('a')] })).toBe(false);
    expect(
      topicPostOverrides([
        ['topic-post', 'baking', pk('a')],
        ['topic-post', 'bad slug', pk('b')],
        ['e', pk('c')]
      ])
    ).toEqual(new Map([['baking', pk('a')]]));
  });
});

describe('Fresh display selection', () => {
  it('uses distinct filtered destinations, preserves source attribution, and rotates only by editorial day', () => {
    const topics = ['japanese', 'desserts', 'cheese', 'baking', 'soups', 'grilling', 'coffee'].map(
      (slug, i) => tile(slug, card(String(i)))
    );
    const bucketStart = Math.floor(NOW / EDITORIAL_EDITION_SECONDS) * EDITORIAL_EDITION_SECONDS;
    const first = selectFreshDiscovery(topics, [], bucketStart + 36000);
    const again = selectFreshDiscovery(topics, [], bucketStart + 36001);
    expect(again).toEqual(first);
    expect(first.freshTopics).toHaveLength(6);
    for (const chosen of first.freshTopics) {
      expect(chosen.href).toBe(`/feed?tab=fresh&topic=${chosen.slug}`);
      expect(chosen.post.author.name).toMatch(/^Cook /);
      expect(chosen.post.href).toMatch(/^\/note-/);
    }
    expect(
      selectFreshDiscovery(
        topics,
        [],
        bucketStart + EDITORIAL_EDITION_SECONDS + 36000
      ).freshTopics.map((t) => t.slug)
    ).not.toEqual(first.freshTopics.map((t) => t.slug));
  });
  it('deduplicates source photos and ids across topics and recent posts, and limits repeated authors', () => {
    const first = card('1');
    const samePhoto = { ...card('2'), image: `${first.image}?w=640` };
    const alternative = card('3');
    const topics = [
      tile('baking', first),
      { ...tile('desserts', samePhoto), alternatives: [alternative] }
    ];
    const recent = [
      first,
      samePhoto,
      alternative,
      card('4'),
      card('5', 80, '4'),
      card('6', JUST_SERVED_MAX_AGE_SECONDS + 1),
      card('7', 90)
    ];
    const result = selectFreshDiscovery(topics, recent, NOW, new Set([first.image]));
    expect(result.freshTopics.map((t) => t.post.id)).toEqual(['3']);
    expect(result.fresh.map((post) => post.id)).toEqual(['4', '7']);
  });
  it('expires old cached posts at selection time without inventing fresh replacements', () => {
    expect(
      selectFreshDiscovery([], [card('a', JUST_SERVED_MAX_AGE_SECONDS + 1)], NOW).fresh
    ).toEqual([]);
    expect(
      selectFreshDiscovery([tile('baking', card('a', PUBLIC_FRESH_MAX_AGE_SECONDS + 1))], [], NOW)
        .freshTopics
    ).toEqual([]);
  });
});
