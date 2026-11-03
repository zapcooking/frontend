import { describe, it, expect, vi } from 'vitest';
import { loadOnThisDay, MonthPager, type HistorySource } from './archiveLoader';
import { dayWindow, monthWindow, LABELER_PUBKEY, TOPIC_NAMESPACE } from './archive';
import type { HistoryResult, RelayEvent } from './relay';

const post = (id: string, pubkey: string, created_at: number): RelayEvent =>
  ({ id, pubkey, created_at, kind: 1, tags: [], content: '', sig: '' }) as RelayEvent;
const label = (id: string): RelayEvent =>
  ({
    id: 'L' + id,
    pubkey: LABELER_PUBKEY,
    created_at: 0,
    kind: 1985,
    tags: [
      ['l', 'bbq', TOPIC_NAMESPACE],
      ['e', id]
    ],
    content: '',
    sig: ''
  }) as RelayEvent;

/** A source over a fixed post list; labels for every post not listed in `unlabeled`. */
function source(
  posts: RelayEvent[],
  unlabeled = new Set<string>(),
  pageSize = 500
): HistorySource & { calls: number[][] } {
  const calls: number[][] = [];
  return {
    calls,
    async history(since, until, opts): Promise<HistoryResult> {
      calls.push([since, until, opts?.authedOnly ? 1 : 0]);
      const evs = posts
        .filter((p) => p.created_at >= since && p.created_at <= until)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, pageSize);
      return {
        state: 'ok',
        events: evs,
        labels: evs.filter((e) => !unlabeled.has(e.id)).map((e) => label(e.id)),
        end: evs.length >= pageSize ? 'more' : 'exhausted',
        nextUntil: evs.length ? evs[evs.length - 1].created_at : since
      };
    }
  };
}

const NOW = new Date(2026, 9, 6, 12);
const day = (y: number, i = 0) => dayWindow(NOW, y).since + 3600 + i;

describe('loadOnThisDay', () => {
  it('labeled posts, ≤2 per author, 3 years only with ≥3 posts', async () => {
    const src = source(
      [
        post('a1', 'A', day(1, 3)),
        post('a2', 'A', day(1, 2)),
        post('a3', 'A', day(1, 1)),
        post('b1', 'B', day(1)),
        post('u1', 'U', day(1, 5)), // unlabeled
        post('c1', 'C', day(2)),
        post('d1', 'D', day(3)),
        post('d2', 'E', day(3, 1))
      ],
      new Set(['u1'])
    );
    const r = await loadOnThisDay(src, NOW);
    expect(r.state).toBe('ok');
    expect(r.sections.map((s) => [s.yearsBack, s.posts.map((p) => p.id)])).toEqual([
      [1, ['a1', 'a2', 'b1']],
      [2, ['c1']]
    ]);
  });

  it('passes authedOnly through (the caught-up card never prompts)', async () => {
    const src = source([]);
    await loadOnThisDay(src, NOW, { authedOnly: true });
    expect(src.calls.every((c) => c[2] === 1)).toBe(true);
  });

  it('stops at the first refusal (not a member): its state, nothing shown', async () => {
    const src: HistorySource = {
      history: vi.fn(async () => ({ state: 'auth-required' as const, events: [], labels: [] }))
    };
    const r = await loadOnThisDay(src, NOW);
    expect(r).toEqual({ state: 'auth-required', sections: [] });
    expect(src.history).toHaveBeenCalledTimes(1);
  });
});

describe('MonthPager', () => {
  const w = monthWindow(2024, 3);
  const month = { key: '2024-03', label: 'March 2024', window: w };

  it('pages back through the month, labeled only, without repeats', async () => {
    const posts = Array.from({ length: 5 }, (_, i) => post('p' + i, 'A' + i, w.until - i * 100));
    const pager = new MonthPager(source(posts, new Set(['p2']), 2), month);
    const seen: string[] = [];
    while (!pager.done) seen.push(...(await pager.next()).posts.map((p) => p.id));
    expect(seen).toEqual(['p0', 'p1', 'p3', 'p4']);
    expect(pager.labeled).toBe(4);
  });

  it('a full page of one second steps past it instead of looping', async () => {
    const same = Array.from({ length: 3 }, (_, i) => post('s' + i, 'A', w.until - 10));
    const pager = new MonthPager(
      source([...same, post('older', 'B', w.since + 5)], new Set(), 3),
      month
    );
    const seen: string[] = [];
    for (let i = 0; i < 6 && !pager.done; i++)
      seen.push(...(await pager.next()).posts.map((p) => p.id));
    expect(pager.done).toBe(true);
    expect(seen).toContain('older');
  });
});
