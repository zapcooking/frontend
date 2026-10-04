import { describe, it, expect } from 'vitest';
import {
  isRecipe,
  postKind,
  isOldEdit,
  passesFreshFilters,
  formatTimeAgo,
  mediaUrls,
  contentWithoutMedia
} from './posts';
import type { RelayEvent } from './relay';
import type { MuteList } from '$lib/muteFilter';

const NOW = 2_000_000_000;
const DAY = 86400;

function ev(p: Partial<RelayEvent>): RelayEvent {
  return {
    id: 'i'.repeat(64),
    pubkey: 'p'.repeat(64),
    created_at: NOW - 60,
    kind: 1,
    tags: [],
    content: 'hello',
    sig: 's',
    ...p
  };
}

const noHell = () => false;

describe('post kinds', () => {
  it('recipes: kind 35000, or 30023 tagged zapcooking/nostrcooking (any case)', () => {
    expect(isRecipe(ev({ kind: 35000 }))).toBe(true);
    expect(isRecipe(ev({ kind: 30023, tags: [['t', 'ZapCooking']] }))).toBe(true);
    expect(isRecipe(ev({ kind: 30023, tags: [['t', 'nostrcooking']] }))).toBe(true);
    expect(isRecipe(ev({ kind: 30023, tags: [['t', 'food']] }))).toBe(false);
    expect(isRecipe(ev({ kind: 1, tags: [['t', 'zapcooking']] }))).toBe(false);
  });

  it('maps every feed kind', () => {
    expect(postKind(ev({ kind: 1 }))).toBe('note');
    expect(postKind(ev({ kind: 1068 }))).toBe('poll');
    expect(postKind(ev({ kind: 35000 }))).toBe('recipe');
    expect(postKind(ev({ kind: 30023 }))).toBe('article');
  });
});

describe('old edits stay out of the main feed', () => {
  it('a long-form post published before the window is an edit', () => {
    const old = String(NOW - 30 * DAY);
    expect(isOldEdit(ev({ kind: 30023, tags: [['published_at', old]] }), NOW)).toBe(true);
    expect(isOldEdit(ev({ kind: 35000, tags: [['published_at', old]] }), NOW)).toBe(true);
  });

  it('recent or missing published_at, and notes, are not', () => {
    expect(isOldEdit(ev({ kind: 30023, tags: [['published_at', String(NOW - DAY)]] }), NOW)).toBe(
      false
    );
    expect(isOldEdit(ev({ kind: 30023 }), NOW)).toBe(false);
    expect(isOldEdit(ev({ kind: 30023, tags: [['published_at', 'garbage']] }), NOW)).toBe(false);
    expect(isOldEdit(ev({ kind: 1, tags: [['published_at', '1']] }), NOW)).toBe(false);
  });
});

describe('passesFreshFilters', () => {
  const muteList: MuteList = {
    pubkeys: [{ type: 'pubkey', value: 'b'.repeat(64) }],
    words: [{ type: 'word', value: 'spam' }],
    tags: [{ type: 'tag', value: 'nsfw' }],
    threads: []
  };

  it('passes an ordinary post', () => {
    expect(passesFreshFilters(ev({}), { muteList, isHellthread: noHell, now: NOW })).toBe(true);
    expect(passesFreshFilters(ev({}), { muteList: null, isHellthread: noHell, now: NOW })).toBe(
      true
    );
  });

  it('applies mutes: people, words, hashtags', () => {
    const ctx = { muteList, isHellthread: noHell, now: NOW };
    expect(passesFreshFilters(ev({ pubkey: 'b'.repeat(64) }), ctx)).toBe(false);
    expect(passesFreshFilters(ev({ content: 'buy spam now' }), ctx)).toBe(false);
    expect(passesFreshFilters(ev({ tags: [['t', 'nsfw']] }), ctx)).toBe(false);
  });

  it('applies the hellthread rule', () => {
    expect(passesFreshFilters(ev({}), { muteList: null, isHellthread: () => true, now: NOW })).toBe(
      false
    );
  });

  it('drops old edits', () => {
    const e = ev({ kind: 30023, tags: [['published_at', String(NOW - 90 * DAY)]] });
    expect(passesFreshFilters(e, { muteList: null, isHellthread: noHell, now: NOW })).toBe(false);
  });

  it('applies no food test or hashtag cap (the relay is curated)', () => {
    const many = Array.from({ length: 12 }, (_, i) => ['t', `tag${i}`]);
    const e = ev({ content: 'a note about my bike', tags: many });
    expect(passesFreshFilters(e, { muteList: null, isHellthread: noHell, now: NOW })).toBe(true);
  });
});

describe('copied FoodstrFeedOptimized helpers', () => {
  it('formatTimeAgo', () => {
    expect(formatTimeAgo(NOW - 30, NOW)).toBe('now');
    expect(formatTimeAgo(NOW - 600, NOW)).toBe('10m');
    expect(formatTimeAgo(NOW - 3 * 3600, NOW)).toBe('3h');
    expect(formatTimeAgo(NOW - 2 * DAY, NOW)).toBe('2d');
    expect(formatTimeAgo(NOW - 400 * DAY, NOW)).toBe('1y');
  });

  it('media URLs and the text without them', () => {
    const c = 'Dinner https://x.com/a.jpg and https://example.com/page https://v.com/b.mp4';
    expect(mediaUrls(c)).toEqual(['https://x.com/a.jpg', 'https://v.com/b.mp4']);
    expect(contentWithoutMedia(c)).toBe('Dinner  and https://example.com/page');
  });

  it('collapses a text duplicated in full', () => {
    const half = 'This soup is the best thing I cooked all week';
    expect(contentWithoutMedia(`${half} ${half}`)).toBe(half);
  });
});
