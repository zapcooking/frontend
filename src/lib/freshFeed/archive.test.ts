import { describe, it, expect } from 'vitest';
import {
  dayWindow,
  labelTopics,
  labeledOnly,
  capPerAuthor,
  visibleSections,
  archiveMonths,
  monthWindow,
  isEarlyDays,
  LABELER_PUBKEY,
  TOPIC_NAMESPACE
} from './archive';
import type { RelayEvent } from './relay';

const ev = (
  id: string,
  pubkey: string,
  created_at: number,
  kind = 1,
  tags: string[][] = []
): RelayEvent => ({ id, pubkey, created_at, kind, tags, content: '', sig: '' }) as RelayEvent;
const label = (post: string, topics: string[], by = LABELER_PUBKEY, ns = TOPIC_NAMESPACE) =>
  ev('l' + post, by, 0, 1985, [['L', ns], ...topics.map((t) => ['l', t, ns]), ['e', post]]);

describe('dayWindow', () => {
  it('the same local calendar day, N years back, inclusive', () => {
    const w = dayWindow(new Date(2026, 9, 6, 15, 30), 1);
    expect(new Date(w.since * 1000)).toEqual(new Date(2025, 9, 6));
    expect(new Date((w.until + 1) * 1000)).toEqual(new Date(2025, 9, 7));
  });
  it('Feb 29 maps to Feb 28 in a year without one', () => {
    const w = dayWindow(new Date(2028, 1, 29, 12), 1);
    expect(new Date(w.since * 1000)).toEqual(new Date(2027, 1, 28));
  });
});

describe('labels', () => {
  it('only the labeler’s topic labels count', () => {
    const m = labelTopics([
      label('a', ['bbq', 'beef']),
      label('b', ['bbq'], 'f'.repeat(64)),
      label('c', ['x'], LABELER_PUBKEY, 'other.namespace'),
      label('d', [])
    ]);
    expect([...m.keys()]).toEqual(['a']);
    expect(m.get('a')).toEqual(['bbq', 'beef']);
  });
  it('labeledOnly keeps labeled posts, newest first', () => {
    const topics = new Map([
      ['a', ['x']],
      ['c', ['y']]
    ]);
    expect(
      labeledOnly([ev('a', 'p', 1), ev('b', 'p', 3), ev('c', 'p', 2)], topics).map((e) => e.id)
    ).toEqual(['c', 'a']);
  });
});

describe('capPerAuthor', () => {
  it('at most 2 per author (their newest, given newest-first input), others untouched', () => {
    const r = capPerAuthor([ev('1', 'a', 5), ev('2', 'a', 4), ev('3', 'b', 3), ev('4', 'a', 2)]);
    expect(r.map((e) => e.id)).toEqual(['1', '2', '3']);
  });
});

describe('visibleSections', () => {
  const s = (yearsBack: number, n: number) => ({
    yearsBack,
    window: { since: 0, until: 0 },
    posts: Array.from({ length: n }, (_, i) => ev(`${yearsBack}-${i}`, 'p', i))
  });
  it('1 and 2 years when they have posts; 3 years only with ≥3', () => {
    expect(visibleSections([s(1, 1), s(2, 0), s(3, 2)]).map((x) => x.yearsBack)).toEqual([1]);
    expect(visibleSections([s(1, 0), s(2, 4), s(3, 3)]).map((x) => x.yearsBack)).toEqual([2, 3]);
  });
});

describe('time machine months', () => {
  it('from 2023-04 to now, newest first', () => {
    const m = archiveMonths(new Date(2026, 9, 6));
    expect(m[0].key).toBe('2026-10');
    expect(m.at(-1)!.key).toBe('2023-04');
    expect(m).toHaveLength(43);
  });
  it('a month window covers the whole local month, inclusive', () => {
    const w = monthWindow(2024, 2);
    expect(new Date(w.since * 1000)).toEqual(new Date(2024, 1, 1));
    expect(new Date((w.until + 1) * 1000)).toEqual(new Date(2024, 2, 1));
  });
  it('early days: fully loaded and under 20 labeled posts', () => {
    expect(isEarlyDays(5, true)).toBe(true);
    expect(isEarlyDays(5, false)).toBe(false);
    expect(isEarlyDays(20, true)).toBe(false);
  });
});
