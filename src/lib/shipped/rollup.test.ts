import { describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/pow-prs.json';
import { rollup, zonedDate } from './rollup';
import type { PrRecord } from './types';

const records = fixture.records as PrRecord[];
// Mar 11 ET, mid-morning; nothing has merged "today".
const NOW = new Date('2026-03-11T14:00:00Z');

describe('zonedDate (America/New_York)', () => {
  it('puts a 23:30 ET merge on its Eastern day, not the next UTC day', () => {
    expect(zonedDate(new Date('2026-01-15T04:30:00Z'))).toBe('2026-01-14');
  });

  it('follows the DST switch on 2026-03-08 rather than a fixed offset', () => {
    // 23:30 EST (-05:00) the night before the switch
    expect(zonedDate(new Date('2026-03-08T04:30:00Z'))).toBe('2026-03-07');
    // 00:30 EDT (-04:00) after it; a fixed -05:00 would give Mar 8
    expect(zonedDate(new Date('2026-03-09T04:30:00Z'))).toBe('2026-03-09');
  });
});

describe('rollup', () => {
  const s = rollup(records, NOW);

  it('labels the zone and start', () => {
    expect(s.tz).toBe('America/New_York');
    expect(s.start).toBe('2026-01-01T00:00:00-05:00');
    expect(s.asOfDate).toBe('2026-03-11');
  });

  it('drops non-allowlisted repos, pre-START merges and duplicate ids', () => {
    expect(s.totals.prs).toBe(12);
    expect(s.recent.map((r) => r.id)).not.toContain('mr-9');
    expect(s.recent.map((r) => r.id)).not.toContain('fe-0');
  });

  it('totals include bots and sum raw and counted lines', () => {
    expect(s.totals).toMatchObject({
      prs: 12,
      additions: 2699,
      deletions: 451,
      countedAdditions: 309,
      countedDeletions: 51,
      contributors: 3,
      activeDays: 12
    });
  });

  it('breaks totals down by every allowlisted repo', () => {
    expect(s.byRepo.frontend).toMatchObject({ prs: 7, countedAdditions: 255 });
    expect(s.byRepo.zap_cooking_android).toMatchObject({ prs: 3, countedAdditions: 35 });
    expect(s.byRepo.zapcooking_ios).toMatchObject({ prs: 2, countedAdditions: 19 });
    expect(Object.keys(s.byRepo)).toEqual(['frontend', 'zap_cooking_android', 'zapcooking_ios']);
  });

  it('buckets days in Eastern time', () => {
    expect(s.daily['2026-01-14']).toEqual({ zapcooking_ios: 1 }); // 23:30 ET merge
    expect(s.daily['2026-01-15']).toEqual({ frontend: 1 });
    expect(s.daily['2026-01-31']).toEqual({ frontend: 1 });
    expect(s.daily['2026-02-01']).toBeUndefined();
    expect(s.daily['2026-03-07']).toEqual({ zap_cooking_android: 1 });
    expect(s.daily['2026-03-08']).toBeUndefined();
    expect(s.daily['2026-03-09']).toEqual({ zap_cooking_android: 1 });
  });

  it('draws the year boundary at midnight Eastern, inclusive', () => {
    const ids = s.recent.map((r) => r.id);
    expect(ids).toContain('fe-7'); // 00:00:00 ET Jan 1
    expect(ids).not.toContain('fe-8'); // 23:59:59 ET Dec 31, already Jan 1 in UTC
    expect(s.daily['2025-12-31']).toBeUndefined();
    expect(s.daily['2026-01-01']).toEqual({ frontend: 1 });
  });

  it('buckets months in Eastern time with zero months present', () => {
    expect(s.monthly.map((m) => [m.month, m.prs])).toEqual([
      ['2026-01', 9],
      ['2026-02', 0],
      ['2026-03', 3]
    ]);
    expect(s.monthly[2].byRepo).toEqual({
      frontend: 0,
      zap_cooking_android: 2,
      zapcooking_ios: 1
    });
    expect(s.monthly.reduce((n, m) => n + m.prs, 0)).toBe(s.totals.prs);
  });

  it('credits humans individually and bots to one trailing Automation bucket', () => {
    expect(s.contributors).toEqual([
      { kind: 'human', login: 'dmnyc', prs: 5, countedAdditions: 134, countedDeletions: 22 },
      { kind: 'human', login: 'spe1020', prs: 4, countedAdditions: 138, countedDeletions: 19 },
      { kind: 'human', login: 'ghost', prs: 1, countedAdditions: 7, countedDeletions: 7 },
      { kind: 'automation', login: 'Automation', prs: 2, countedAdditions: 30, countedDeletions: 3 }
    ]);
    expect(s.contributors.reduce((n, c) => n + c.prs, 0)).toBe(s.totals.prs);
  });

  it('omits the Automation bucket when there are no bot PRs', () => {
    const humansOnly = records.filter((r) => r.author !== 'dependabot' && r.author !== 'copilot-swe-agent');
    expect(rollup(humansOnly, NOW).contributors.some((c) => c.kind === 'automation')).toBe(false);
  });

  it('finds the longest streak across the Jan 13 gap', () => {
    expect(s.streak).toMatchObject({ longest: 4, longestStart: '2026-01-14', longestEnd: '2026-01-17' });
  });

  it('counts the current streak through yesterday when nothing has merged today', () => {
    // Mar 9 + Mar 10 (ET). UTC bucketing would wrongly add Mar 8.
    expect(s.streak).toMatchObject({ current: 2, currentStart: '2026-03-09' });
  });

  it('counts today once something has merged today', () => {
    const late = rollup(records, new Date('2026-03-10T23:00:00Z')); // 19:00 ET Mar 10
    expect(late.streak).toMatchObject({ current: 2, currentStart: '2026-03-09' });
    expect(late.asOfDate).toBe('2026-03-10');
  });

  it('resets the current streak after a full day with no merge', () => {
    expect(rollup(records, new Date('2026-03-12T14:00:00Z')).streak.current).toBe(0);
  });

  it('lists recent merges newest first, capped at 20', () => {
    expect(s.recent[0].id).toBe('ios-2');
    expect(s.recent.at(-1)!.id).toBe('fe-7');
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...records[1],
      id: `x-${i}`,
      mergedAt: `2026-02-${String(i % 28 + 1).padStart(2, '0')}T12:00:00Z`
    }));
    expect(rollup(many, NOW).recent).toHaveLength(20);
  });
});
