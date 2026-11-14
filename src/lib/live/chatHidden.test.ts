import { describe, it, expect } from 'vitest';
import {
  addHiddenTags,
  hiddenAuthorsFrom,
  LIVE_HIDDEN_D,
  LIVE_HIDDEN_KIND,
  liveHiddenListOf
} from './chatHidden';
import type { NostrEventLike } from '$lib/streams/types';

const HOST = 'a'.repeat(64);
const TROLL = 'b'.repeat(64);
const SPAM = 'c'.repeat(64);
const OLD = 'd'.repeat(64);

const ev = (o: Partial<NostrEventLike>): NostrEventLike => ({
  id: Math.random().toString(16).slice(2).padEnd(64, '0'),
  pubkey: HOST,
  created_at: 100,
  kind: LIVE_HIDDEN_KIND,
  tags: [],
  content: '',
  sig: '',
  ...o
});

describe('hiddenAuthorsFrom', () => {
  it('reads the newest live-chat hidden list and the public part of the mute list', () => {
    const events = [
      ev({
        created_at: 100,
        tags: [
          ['d', LIVE_HIDDEN_D],
          ['p', OLD]
        ]
      }),
      ev({
        created_at: 200,
        tags: [
          ['d', LIVE_HIDDEN_D],
          ['p', TROLL]
        ]
      }),
      ev({ kind: 10000, tags: [['p', SPAM]], content: 'encrypted-private-part' }),
      // Someone else's list, and another people set of the host's: ignored.
      ev({
        pubkey: OLD,
        tags: [
          ['d', LIVE_HIDDEN_D],
          ['p', SPAM]
        ]
      }),
      ev({
        tags: [
          ['d', 'friends'],
          ['p', OLD]
        ]
      })
    ];
    expect([...hiddenAuthorsFrom(HOST, events)].sort()).toEqual([TROLL, SPAM].sort());
  });

  it('never hides the host, and ignores malformed keys', () => {
    const events = [
      ev({
        tags: [
          ['d', LIVE_HIDDEN_D],
          ['p', HOST],
          ['p', 'nope']
        ]
      })
    ];
    expect(hiddenAuthorsFrom(HOST, events).size).toBe(0);
  });
});

describe('addHiddenTags', () => {
  it('starts a new list with its d tag and title', () => {
    expect(addHiddenTags(null, TROLL)).toEqual([
      ['d', LIVE_HIDDEN_D],
      ['title', 'Hidden from Zap Cooking live chat'],
      ['p', TROLL]
    ]);
  });

  it('keeps every existing tag and adds the pubkey once', () => {
    const existing = [
      ['d', LIVE_HIDDEN_D],
      ['title', 'Mine'],
      ['p', SPAM],
      ['client', 'x']
    ];
    expect(addHiddenTags(existing, TROLL)).toEqual([...existing, ['p', TROLL]]);
    expect(addHiddenTags([...existing, ['p', TROLL]], TROLL)).toBeNull();
  });

  it('picks the host list by d tag', () => {
    const list = ev({ tags: [['d', LIVE_HIDDEN_D]] });
    expect(liveHiddenListOf(HOST, [ev({ tags: [['d', 'other']] }), list])).toBe(list);
    expect(liveHiddenListOf(HOST, [])).toBeNull();
  });
});
