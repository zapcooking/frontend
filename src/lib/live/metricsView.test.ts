import { describe, it, expect } from 'vitest';
import {
  change,
  chartHosts,
  dailySeries,
  hostRows,
  monthTotals,
  sortBy,
  streamsCsv,
  type MonthlyRow,
  type StreamRow
} from './metricsView';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const month = (host: string, m: string, over: Partial<MonthlyRow> = {}): MonthlyRow => ({
  host_pubkey: host,
  month: m,
  streams: 2,
  stream_seconds: 7200,
  longest_seconds: 5400,
  viewer_seconds: 36_000,
  peak_watching: 12,
  zap_sats: 500,
  ...over
});
// 2027-01-15T12:00:00Z
const NOW = Date.UTC(2027, 0, 15, 12) / 1000;
const stream = (over: Partial<StreamRow> = {}): StreamRow => ({
  id: '1'.repeat(32),
  host_pubkey: A,
  title: 'Soup',
  status: 'ended',
  end_reason: 'host',
  started_at: NOW - 3600,
  ended_at: NOW - 600,
  peak_watching: 4,
  joins: 9,
  viewer_seconds: 6000,
  zap_sats: 21,
  metrics_at: NOW,
  ...over
});

describe('monthTotals', () => {
  it('sums one month and counts hosts with streams', () => {
    const rows = [
      month(A, '2027-01'),
      month(B, '2027-01'),
      month(A, '2026-12'),
      month(B, '2027-01', { streams: 0, host_pubkey: 'c'.repeat(64) })
    ];
    expect(monthTotals(rows, '2027-01', 1)).toEqual({
      streams: 4,
      hours: 4,
      viewerMinutes: 1200,
      costUsd: 1.2,
      sats: 1000,
      activeHosts: 2
    });
  });

  it('change is null without a base', () => {
    expect(change(5, 0)).toBeNull();
    expect(change(15, 10)).toBe(0.5);
  });
});

describe('hostRows', () => {
  it('derives hours, average viewers and cost', () => {
    expect(hostRows([month(A, '2027-01'), month(B, '2026-12')], '2027-01', 1)).toEqual([
      {
        pubkey: A,
        streams: 2,
        hours: 2,
        longestSeconds: 5400,
        avgViewers: 5,
        peak: 12,
        viewerMinutes: 600,
        costUsd: 0.6,
        sats: 500
      }
    ]);
  });
});

describe('sortBy', () => {
  it('sorts numbers and strings both ways, nulls last, stable on ties', () => {
    const rows = [
      { k: 'b', n: 2 as number | null },
      { k: 'A', n: null },
      { k: 'c', n: 2 },
      { k: 'd', n: 1 }
    ];
    expect(sortBy(rows, 'n', 'desc').map((r) => r.k)).toEqual(['b', 'c', 'd', 'A']);
    expect(sortBy(rows, 'n', 'asc').map((r) => r.k)).toEqual(['d', 'b', 'c', 'A']);
    expect(sortBy(rows, 'k', 'asc').map((r) => r.k)).toEqual(['A', 'b', 'c', 'd']);
  });
});

describe('dailySeries', () => {
  it('has one entry per UTC day ending today, with streams filed by start day', () => {
    const days = dailySeries(
      [
        stream(),
        stream({ host_pubkey: B, viewer_seconds: null }),
        stream({ started_at: NOW - 86_400 * 2 }),
        stream({ started_at: NOW - 86_400 * 40 })
      ],
      NOW,
      1
    );
    expect(days).toHaveLength(30);
    expect(days[29].day).toBe('2027-01-15');
    expect(days[0].day).toBe('2026-12-17');
    expect(days[29]).toMatchObject({ viewerMinutes: 100, costUsd: 0.1, streams: 2 });
    expect([...days[29].streamsByHost]).toEqual([
      [A, 1],
      [B, 1]
    ]);
    expect(days[27].streams).toBe(1);
  });

  it('picks the hosts with the most streams, ties by key', () => {
    const s = [
      stream({ host_pubkey: B }),
      stream({ host_pubkey: B }),
      stream(),
      stream({ host_pubkey: 'c'.repeat(64) })
    ];
    expect(chartHosts(s, 2)).toEqual([B, A]);
  });
});

describe('streamsCsv', () => {
  it('writes a header and one row per stream, quoting and defusing formulas', () => {
    const csv = streamsCsv(
      [
        stream({ title: '=HYPERLINK("x"), "soup"' }),
        stream({ viewer_seconds: null, metrics_at: null, zap_sats: null })
      ],
      NOW,
      1,
      { [A]: 'Chef A' }
    );
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'session_id,host_pubkey,host_name,title,status,end_reason,started_at_utc,ended_at_utc,minutes,peak_watching,joins,avg_watching,viewer_minutes,est_cost_usd,zap_sats,recorded'
    );
    expect(lines[1]).toBe(
      `${'1'.repeat(32)},${A},Chef A,"'=HYPERLINK(""x""), ""soup""",ended,host,2027-01-15T11:00:00.000Z,2027-01-15T11:50:00.000Z,50.0,4,9,2.00,100.0,0.1000,21,yes`
    );
    expect(lines[2].endsWith(',50.0,4,9,,,,,no')).toBe(true);
    expect(lines).toHaveLength(4); // trailing CRLF
  });
});
