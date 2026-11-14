import { describe, it, expect } from 'vitest';
import { StreamDirectory } from './directory';
import type { NostrEventLike, StreamItem } from './types';

const HOST = 'a'.repeat(64);
const NOW = 1700000000;

function announcement(
  overrides: Partial<NostrEventLike> = {},
  tags: string[][] = []
): NostrEventLike {
  return {
    id: '1'.repeat(64),
    pubkey: HOST,
    created_at: NOW - 120,
    kind: 30311,
    tags: [
      ['d', 'my-stream'],
      ['status', 'live'],
      ['streaming', 'https://cdn.example.com/live.m3u8'],
      ...tags
    ],
    content: '',
    sig: 'f'.repeat(128),
    ...overrides
  };
}

function itemOf(directory: StreamDirectory, key: string): StreamItem {
  const item = directory.events.get(key);
  if (!item) throw new Error(`missing ${key}`);
  return item;
}

describe('StreamDirectory.accept', () => {
  it('parses kind 30311 and rejects other kinds', () => {
    const directory = new StreamDirectory();
    expect(directory.accept(announcement(), NOW)).toBe(true);
    expect(directory.accept(announcement({ kind: 1 }), NOW)).toBe(false);
    expect(directory.events.size).toBe(1);
  });

  it('newest announcement per address wins; ties keep the smaller id', () => {
    const directory = new StreamDirectory();
    directory.accept(announcement({ created_at: NOW - 200, id: '2'.repeat(64) }), NOW);
    expect(directory.accept(announcement({ created_at: NOW - 100 }), NOW)).toBe(true);
    expect(itemOf(directory, `30311:${HOST}:my-stream`).title).toBe('Untitled livestream');

    // Same created_at: the smaller event id wins regardless of arrival
    // order, and a duplicate (same id) is never re-accepted.
    const tie = new StreamDirectory();
    tie.accept(announcement({ id: '3'.repeat(64) }), NOW);
    expect(tie.accept(announcement({ id: '2'.repeat(64) }), NOW)).toBe(true);
    expect(itemOf(tie, `30311:${HOST}:my-stream`).id).toBe('2'.repeat(64));
    expect(tie.accept(announcement({ id: '2'.repeat(64) }), NOW)).toBe(false);
  });

  it('evicts the stalest entry past the cap', () => {
    const directory = new StreamDirectory(2);
    const withKey = (key: string, createdAt: number) =>
      announcement({
        created_at: createdAt,
        tags: [
          ['d', key],
          ['status', 'live'],
          ['streaming', `https://cdn.example.com/${key}.m3u8`]
        ]
      });
    directory.accept(withKey('old', NOW - 900), NOW);
    directory.accept(withKey('mid', NOW - 300), NOW);
    directory.accept(withKey('new', NOW - 100), NOW);
    expect(directory.events.size).toBe(2);
    expect(directory.events.has(`30311:${HOST}:old`)).toBe(false);
    expect(directory.events.has(`30311:${HOST}:mid`)).toBe(true);
  });
});

describe('StreamDirectory.isLive', () => {
  it('trusts fresh live announcements and a recent playlist proof', () => {
    const directory = new StreamDirectory();
    directory.accept(announcement(), NOW);
    const fresh = itemOf(directory, `30311:${HOST}:my-stream`);
    expect(directory.isLive(fresh, NOW)).toBe(true);
  });

  it('a stale announcement needs a recent playlist proof', () => {
    const directory = new StreamDirectory();
    directory.accept(announcement({ created_at: NOW - 7200 }), NOW);
    const stale = itemOf(directory, `30311:${HOST}:my-stream`);
    expect(directory.isLive(stale, NOW)).toBe(false);

    directory.verified.set(stale.url as string, NOW - 60);
    expect(directory.isLive(stale, NOW)).toBe(true);

    directory.verified.set(stale.url as string, NOW - 600);
    expect(directory.isLive(stale, NOW)).toBe(false);
  });

  it('never calls a stream without a media URL live', () => {
    const directory = new StreamDirectory();
    directory.accept(
      announcement({
        tags: [
          ['d', 'my-stream'],
          ['status', 'live'],
          ['streaming', '']
        ]
      }),
      NOW
    );
    const item = itemOf(directory, `30311:${HOST}:my-stream`);
    expect(item.url).toBeNull();
    expect(directory.isLive(item, NOW)).toBe(false);
  });
});

describe('StreamDirectory views', () => {
  it('dedupes live by streaming URL', () => {
    const directory = new StreamDirectory();
    // Two hosts announcing the same stream URL: only the newest shows.
    directory.accept(announcement({ created_at: NOW - 100 }), NOW);
    directory.accept(
      announcement({
        pubkey: 'c'.repeat(64),
        created_at: NOW - 50,
        tags: [
          ['d', 'rerun'],
          ['status', 'live'],
          ['streaming', 'https://cdn.example.com/live.m3u8']
        ]
      }),
      NOW
    );
    const live = directory.live(NOW);
    expect(live.length).toBe(1);
    expect(live[0].key).toBe(`30311:${'c'.repeat(64)}:rerun`);
  });

  it('sorts upcoming by start time, past by end', () => {
    const directory = new StreamDirectory();
    directory.accept(
      announcement(
        {
          created_at: NOW - 10,
          tags: [
            ['d', 'later'],
            ['status', 'planned'],
            ['starts', String(NOW + 7200)]
          ]
        },
        []
      ),
      NOW
    );
    directory.accept(
      announcement(
        {
          created_at: NOW - 20,
          tags: [
            ['d', 'sooner'],
            ['status', 'planned'],
            ['starts', String(NOW + 3600)]
          ]
        },
        []
      ),
      NOW
    );
    expect(directory.upcoming(NOW).map((e) => e.starts)).toEqual([NOW + 3600, NOW + 7200]);

    directory.accept(
      announcement(
        {
          created_at: NOW - 30,
          tags: [
            ['d', 'older-end'],
            ['title', 'Dinner service'],
            ['recording', 'https://cdn.example.com/older-end.m3u8'],
            ['status', 'ended'],
            ['ends', String(NOW - 600)]
          ]
        },
        []
      ),
      NOW
    );
    directory.accept(
      announcement(
        {
          created_at: NOW - 40,
          tags: [
            ['d', 'newer-end'],
            ['title', 'Dinner service'],
            ['recording', 'https://cdn.example.com/newer-end.m3u8'],
            ['status', 'ended'],
            ['ends', String(NOW - 100)]
          ]
        },
        []
      ),
      NOW
    );
    const past = directory.past();
    expect(past.length).toBe(2);
    expect(past[0].ends).toBe(NOW - 100);
  });

  it('leaves test runs and empty shells out of past', () => {
    const directory = new StreamDirectory();
    const ended = (d: string, extra: string[][]) =>
      announcement(
        { created_at: NOW - 30, tags: [['d', d], ['status', 'ended'], ...extra] },
        []
      );
    directory.accept(ended('real', [['title', 'Sunday roast'], ['recording', 'https://cdn.example.com/r.m3u8']]), NOW);
    directory.accept(ended('test-a', [['title', 'Test A']]), NOW);
    directory.accept(ended('canary', [['title', 'Canary stage (automated test)'], ['recording', 'https://cdn.example.com/c.m3u8']]), NOW);
    directory.accept(ended('shell', [['title', 'Pasta night']]), NOW);
    directory.accept(ended('untitled', [['image', 'https://cdn.example.com/i.png']]), NOW);
    expect(directory.past().map((e) => e.title)).toEqual(['Sunday roast']);
  });
});
