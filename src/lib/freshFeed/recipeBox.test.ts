import { describe, it, expect } from 'vitest';
import {
  recipeAddress,
  isBoxCandidate,
  buildPool,
  pickRandom,
  boxSlots,
  pruneSeen,
  loadSeen,
  markSeen,
  SEEN_KEY,
  SEEN_MAX,
  SEEN_TTL_SECONDS
} from './recipeBox';
import type { RelayEvent } from './relay';

const NOW = 2_000_000_000;
const DAY = 86400;
const A = 'a'.repeat(64);

function recipe(d: string, created: number, extra: string[][] = [], kind = 30023): RelayEvent {
  return {
    id: `${d}-${created}`,
    pubkey: A,
    created_at: created,
    kind,
    tags: [['d', d], ['t', 'zapcooking'], ...extra],
    content: '',
    sig: 's'
  };
}

class Store {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('the pool', () => {
  it('takes recipes first published more than 14 days ago', () => {
    expect(isBoxCandidate(recipe('old', NOW - 30 * DAY), NOW)).toBe(true);
    expect(isBoxCandidate(recipe('new', NOW - 2 * DAY), NOW)).toBe(false);
    // An edit: recent created_at, old published_at.
    expect(
      isBoxCandidate(recipe('edit', NOW - DAY, [['published_at', String(NOW - 60 * DAY)]]), NOW)
    ).toBe(true);
    expect(isBoxCandidate(recipe('gated', NOW - 30 * DAY, [], 35000), NOW)).toBe(true);
  });

  it('leaves out articles and notes', () => {
    const article = {
      ...recipe('a', NOW - 30 * DAY),
      tags: [
        ['d', 'a'],
        ['t', 'food']
      ]
    };
    expect(isBoxCandidate(article, NOW)).toBe(false);
    expect(isBoxCandidate({ ...recipe('n', NOW - 30 * DAY), kind: 1 }, NOW)).toBe(false);
  });

  it('keeps one recipe per address, the newest version', () => {
    const v1 = recipe('soup', NOW - 40 * DAY);
    const v2 = recipe('soup', NOW - 20 * DAY);
    const pool = buildPool([v1, v2, recipe('stew', NOW - 50 * DAY)], NOW);
    expect(pool.map((e) => e.id).sort()).toEqual([v2.id, 'stew-' + (NOW - 50 * DAY)].sort());
    expect(recipeAddress(v1)).toBe(`30023:${A}:soup`);
  });
});

describe('random from the unshown pool', () => {
  const pool = ['a', 'b', 'c', 'd'].map((d) => recipe(d, NOW - 30 * DAY));

  it('picks uniformly by the random number', () => {
    expect(pickRandom(pool, new Map(), new Set(), () => 0)?.tags[0][1]).toBe('a');
    expect(pickRandom(pool, new Map(), new Set(), () => 0.99)?.tags[0][1]).toBe('d');
  });

  it('different random draws give different recipes (different readers differ)', () => {
    const picks = new Set(
      [0.1, 0.3, 0.6, 0.9].map((r) => pickRandom(pool, new Map(), new Set(), () => r)?.id)
    );
    expect(picks.size).toBe(4);
  });

  it('skips recipes shown on this device or already picked this session', () => {
    const seen = new Map([[recipeAddress(pool[0]), NOW]]);
    const taken = new Set([recipeAddress(pool[1]), recipeAddress(pool[2])]);
    expect(pickRandom(pool, seen, taken, () => 0)?.tags[0][1]).toBe('d');
  });

  it('returns null when everything has been shown', () => {
    const seen = new Map(pool.map((e) => [recipeAddress(e), NOW]));
    expect(pickRandom(pool, seen, new Set())).toBeNull();
  });

  it('one slot per eight posts', () => {
    expect([0, 7, 8, 15, 16, 30].map(boxSlots)).toEqual([0, 0, 1, 1, 2, 3]);
  });
});

describe('the device-local seen list', () => {
  it('round-trips through storage', () => {
    const s = new Store();
    const m = markSeen(new Map(), 'x', NOW, s);
    expect(m.get('x')).toBe(NOW);
    expect(loadSeen(NOW, s).get('x')).toBe(NOW);
  });

  it('prunes entries older than 90 days', () => {
    const m = new Map([
      ['old', NOW - SEEN_TTL_SECONDS - 1],
      ['recent', NOW - DAY]
    ]);
    expect([...pruneSeen(m, NOW).keys()]).toEqual(['recent']);
  });

  it('caps at the 1,000 newest', () => {
    const m = new Map(Array.from({ length: SEEN_MAX + 5 }, (_, i) => [`r${i}`, NOW - i] as const));
    const pruned = pruneSeen(new Map(m), NOW);
    expect(pruned.size).toBe(SEEN_MAX);
    expect(pruned.has('r0')).toBe(true);
    expect(pruned.has(`r${SEEN_MAX + 4}`)).toBe(false);
  });

  it('treats corrupt or missing storage as empty, and survives a failing write', () => {
    const s = new Store();
    s.setItem(SEEN_KEY, 'not json');
    expect(loadSeen(NOW, s).size).toBe(0);
    s.setItem(SEEN_KEY, '[1,2]');
    expect(loadSeen(NOW, s).size).toBe(0);
    expect(loadSeen(NOW, null).size).toBe(0);
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      }
    };
    expect(markSeen(new Map(), 'x', NOW, failing).has('x')).toBe(true);
  });
});
