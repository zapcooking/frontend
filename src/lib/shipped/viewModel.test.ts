import { describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/pow-prs.json';
import { rollup } from './rollup';
import type { PowPayload, PrRecord } from './types';
import {
  FIRST_DAY,
  displayTitle,
  facts,
  heatCells,
  monthlyRows,
  pageState,
  recentShipped,
  summarySentence
} from './viewModel';

const NOW = new Date('2026-03-11T14:00:00Z');
const payload = (over: Partial<PowPayload> = {}): PowPayload => ({
  ...rollup(fixture.records as PrRecord[], NOW),
  complete: true,
  lastSuccessAt: '2026-03-11T13:00:00Z',
  stale: false,
  dataVersion: 'v1',
  ...over
});

describe('displayTitle', () => {
  for (const [input, expected] of [
    ['feat(nav): match iOS — Search in the bottom bar', 'Match iOS — Search in the bottom bar'],
    ['fix: crash when the pantry is empty', 'Crash when the pantry is empty'],
    ['FEAT: Bigger buttons', 'Bigger buttons'],
    ['Fix(Pow): uppercase scope', 'Uppercase scope'],
    ['feat(api)!: drop the v1 route', 'Drop the v1 route'],
    ['chore(deps): bump vite', 'Bump vite'],
    ['add a pantry page', 'Add a pantry page'],
    ['Note: this one stays whole', 'Note: this one stays whole'],
    ['fixes: not a conventional type', 'Fixes: not a conventional type'],
    ['  feat:   spaced out  ', 'Spaced out'],
    ['fix:', 'Fix:']
  ]) {
    it(`${input} → ${expected}`, () => expect(displayTitle(input)).toBe(expected));
  }
});

describe('recentShipped', () => {
  it('skips the Automation bucket, newest first, at most 10', () => {
    const items = recentShipped(payload());
    expect(items.map((r) => r.author)).not.toContain('copilot-swe-agent');
    expect(items.map((r) => r.author)).not.toContain('dependabot');
    expect(items).toHaveLength(10); // 12 merges, 2 of them bots
    expect(items[0].id).toBe('ios-2');
    const times = items.map((r) => r.mergedAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('shows fewer than 10 when recent is mostly bots', () => {
    const p = payload();
    const bots = p.recent.map((r, i) => ({ ...r, id: `b${i}`, author: 'dependabot' }));
    expect(recentShipped({ ...p, recent: [...bots.slice(0, 15), ...p.recent.slice(0, 5)] })).toHaveLength(
      5
    );
  });
});

describe('heatCells', () => {
  const p = payload();

  it('has one cell per ET day from START through today', () => {
    const { cells } = heatCells(p, '2026-03-11', 'all');
    expect(FIRST_DAY).toBe('2026-01-01');
    expect(cells[0].date).toBe('2026-01-01');
    expect(cells.at(-1)!.date).toBe('2026-03-11');
    expect(cells).toHaveLength(31 + 28 + 11);
    // Jan 1 2026 is a Thursday; the next Sunday starts week 1.
    expect(cells[0]).toMatchObject({ week: 0, weekday: 4 });
    expect(cells.find((c) => c.date === '2026-01-04')).toMatchObject({ week: 1, weekday: 0 });
  });

  it('counts per ET day, including the 23:30 ET merge on its Eastern day', () => {
    const { cells } = heatCells(p, '2026-03-11', 'all');
    const at = (d: string) => cells.find((c) => c.date === d)!;
    expect(at('2026-01-14').count).toBe(1);
    expect(at('2026-01-13').count).toBe(0);
    expect(at('2026-01-13').level).toBe(0);
    expect(at('2026-03-07').byRepo.zap_cooking_android).toBe(1);
  });

  it('filters by repo and scales levels to the filtered max', () => {
    const busy = payload({
      daily: { '2026-01-02': { frontend: 4, zapcooking_ios: 1 }, '2026-01-03': { frontend: 1 } }
    });
    const all = heatCells(busy, '2026-01-05', 'all');
    const ios = heatCells(busy, '2026-01-05', 'zapcooking_ios');
    const at = (g: typeof all, d: string) => g.cells.find((c) => c.date === d)!;
    expect(at(all, '2026-01-02')).toMatchObject({ count: 5, level: 4 });
    expect(at(all, '2026-01-03')).toMatchObject({ count: 1, level: 1 });
    expect(at(ios, '2026-01-02')).toMatchObject({ count: 1, level: 4 });
    expect(at(ios, '2026-01-03')).toMatchObject({ count: 0, level: 0 });
    expect(all.max).toBe(5);
  });
});

describe('facts', () => {
  it('hottest day (ties to the most recent), streaks, busiest weekday, biggest month', () => {
    const p = payload({
      daily: {
        '2026-02-02': { frontend: 3 }, // Monday
        '2026-02-09': { zapcooking_ios: 3 }, // Monday, same count, later
        '2026-02-10': { frontend: 1 } // Tuesday
      }
    });
    const f = facts(p);
    expect(f.hottestDay).toEqual({ date: '2026-02-09', count: 3 });
    expect(f.busiestWeekday).toEqual({ name: 'Monday', count: 6 });
    expect(f.biggestMonth).toEqual({ month: '2026-01', prs: 9 });
    expect(f).toMatchObject({ currentStreak: 2, longestStreak: 4, longestStart: '2026-01-14' });
  });

  it('is empty-safe', () => {
    const f = facts(payload({ daily: {}, monthly: [] }));
    expect(f.hottestDay).toBeNull();
    expect(f.busiestWeekday).toBeNull();
    expect(f.biggestMonth).toBeNull();
  });
});

describe('monthlyRows', () => {
  it('keeps a running total', () => {
    const rows = monthlyRows(payload());
    expect(rows.map((r) => [r.month, r.prs, r.cumulative])).toEqual([
      ['2026-01', 9, 9],
      ['2026-02', 0, 9],
      ['2026-03', 3, 12]
    ]);
    expect(rows[0].label).toBe('Jan 2026');
  });
});

describe('summarySentence', () => {
  it('uses counted lines, not raw', () => {
    const s = summarySentence(payload());
    expect(s).toContain('12 pull requests');
    expect(s).toContain('+309 / −51 lines');
    expect(s).not.toContain('2,699');
    expect(s).toContain('3 contributors');
  });
});

describe('pageState', () => {
  it('complete:false is still counting', () => {
    expect(pageState({ state: 'ok', summary: payload({ complete: false }) })).toEqual({
      kind: 'ok',
      counting: true,
      stale: false
    });
  });
  it('stale:true is shown as stale, not as an error', () => {
    expect(pageState({ state: 'ok', summary: payload({ stale: true }) })).toEqual({
      kind: 'ok',
      counting: false,
      stale: true
    });
  });
  it('unconfigured and unavailable are the calm empty state', () => {
    expect(pageState({ state: 'unconfigured' })).toEqual({ kind: 'empty' });
    expect(pageState({ state: 'unavailable' })).toEqual({ kind: 'empty' });
  });
});
