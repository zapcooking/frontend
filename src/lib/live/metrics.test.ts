/**
 * Tests for the Go live metrics close-out (migration 0010). Rows go
 * straight into real SQLite; the presence object and relays are fakes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLiveDatabase } from '../../test/liveDatabase';
import { purgeLiveSessions } from './admin.server';
import {
  closeOutEndedSessions,
  deleteOldMonthly,
  fetchNoteZapSats,
  monthKey,
  recordSessionMetrics,
  type MetricsDeps
} from './metrics.server';
import { runLiveSweep } from './sweep.server';
import type { PresenceTotals } from './presence.server';

// 2027-01-15T08:00:00Z
const NOW = Date.UTC(2027, 0, 15, 8) / 1000;
const MIN = 60;
const HOST = 'a'.repeat(64);
const HOST2 = 'b'.repeat(64);
const NOTE = 'f'.repeat(64);

let db: ReturnType<typeof createLiveDatabase>;
let n = 0;

interface Init {
  host?: string;
  started?: number | null;
  ended?: number;
  peak?: number;
  note?: string | null;
}

function ended(init: Init = {}): string {
  n++;
  const id = n.toString(16).padStart(32, '0');
  const started = init.started === undefined ? NOW - 60 * MIN : init.started;
  db.raw
    .prepare(
      `INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, end_reason,
                                  created_at, started_at, ended_at, peak_watching, note_id)
       VALUES (?, ?, 't', '', 'ended', 'host', ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      init.host ?? HOST,
      (started ?? NOW - 60 * MIN) - 60,
      started,
      init.ended ?? NOW - 10 * MIN,
      init.peak ?? 0,
      init.note === undefined ? null : init.note
    );
  return id;
}

const sessionRow = (id: string) =>
  db.raw
    .prepare(
      'SELECT viewer_seconds, zap_sats, metrics_at, peak_watching FROM live_sessions WHERE id = ?'
    )
    .get(id);
const monthly = () =>
  db.raw.prepare('SELECT * FROM live_host_monthly ORDER BY host_pubkey, month').all();

function deps(
  totals: Record<string, PresenceTotals | null> = {},
  sats: number | null = 0
): MetricsDeps & { finished: string[] } {
  const finished: string[] = [];
  return {
    finished,
    readTotals: async (id) => (id in totals ? totals[id] : { viewer_seconds: 0, peak: 0 }),
    finish: async (id) => {
      finished.push(id);
    },
    zapSats: async () => sats
  };
}

const never = () => false;

beforeEach(() => {
  db = createLiveDatabase();
  n = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('closeOutEndedSessions', () => {
  it('records viewer time, zaps and the peak, folds the month, then wipes the object', async () => {
    const id = ended({ started: NOW - 70 * MIN, ended: NOW - 10 * MIN, peak: 3, note: NOTE });
    const d = deps({ [id]: { viewer_seconds: 5400, peak: 4 } }, 2100);
    expect(await closeOutEndedSessions(db, d, NOW, never)).toEqual({
      recorded: 1,
      waiting: 0,
      gaveUp: 0
    });
    expect(sessionRow(id)).toEqual({
      viewer_seconds: 5400,
      zap_sats: 2100,
      metrics_at: NOW,
      peak_watching: 4
    });
    expect(monthly()).toEqual([
      {
        host_pubkey: HOST,
        month: '2027-01',
        streams: 1,
        stream_seconds: 3600,
        longest_seconds: 3600,
        viewer_seconds: 5400,
        peak_watching: 4,
        zap_sats: 2100,
        updated_at: NOW
      }
    ]);
    expect(d.finished).toEqual([id]);
  });

  it('waits LIVE_METRICS_DELAY_SECONDS after the end, for late zaps', async () => {
    const id = ended({ ended: NOW - 4 * MIN });
    expect((await closeOutEndedSessions(db, deps(), NOW, never)).recorded).toBe(0);
    expect(sessionRow(id).metrics_at).toBeNull();
    expect((await closeOutEndedSessions(db, deps(), NOW + MIN, never)).recorded).toBe(1);
  });

  it('folds a session exactly once, even when two close-outs race', async () => {
    const id = ended();
    const d = deps({ [id]: { viewer_seconds: 100, peak: 1 } });
    await Promise.all([
      closeOutEndedSessions(db, d, NOW, never),
      closeOutEndedSessions(db, d, NOW, never)
    ]);
    await closeOutEndedSessions(db, d, NOW + MIN, never);
    expect(monthly()).toHaveLength(1);
    expect(monthly()[0]).toMatchObject({ streams: 1, viewer_seconds: 100 });
  });

  it('sums a host month: streams, seconds and sats add; longest and peak take the max', async () => {
    const a = ended({ started: NOW - 200 * MIN, ended: NOW - 170 * MIN, peak: 9, note: NOTE });
    const b = ended({ started: NOW - 100 * MIN, ended: NOW - 40 * MIN, peak: 2, note: NOTE });
    const c = ended({ host: HOST2 });
    await closeOutEndedSessions(
      db,
      deps({ [a]: { viewer_seconds: 60, peak: 0 }, [b]: { viewer_seconds: 40, peak: 5 } }, 10),
      NOW,
      never
    );
    const [h1, h2] = monthly();
    expect(h1).toMatchObject({
      host_pubkey: HOST,
      streams: 2,
      stream_seconds: 30 * MIN + 60 * MIN,
      longest_seconds: 60 * MIN,
      viewer_seconds: 100,
      peak_watching: 9,
      zap_sats: 20
    });
    expect(h2).toMatchObject({ host_pubkey: HOST2, streams: 1 });
    expect(c).toBeTruthy();
  });

  it('files a stream under the UTC month it started in', async () => {
    const start = Date.UTC(2026, 11, 31, 23, 30) / 1000;
    ended({ started: start, ended: start + 3600 });
    await closeOutEndedSessions(db, deps(), NOW, never);
    expect(monthly()[0].month).toBe('2026-12');
  });

  it('records a session that never went live without folding it', async () => {
    const id = ended({ started: null });
    const d = deps();
    expect((await closeOutEndedSessions(db, d, NOW, never)).recorded).toBe(1);
    expect(sessionRow(id)).toMatchObject({ viewer_seconds: 0, zap_sats: 0, metrics_at: NOW });
    expect(monthly()).toEqual([]);
    expect(d.finished).toEqual([]);
  });

  it('retries while the presence object or the relays are unreachable', async () => {
    const id = ended({ note: NOTE });
    expect(await closeOutEndedSessions(db, deps({ [id]: null }), NOW, never)).toEqual({
      recorded: 0,
      waiting: 1,
      gaveUp: 0
    });
    expect((await closeOutEndedSessions(db, deps({}, null), NOW, never)).waiting).toBe(1);
    expect(sessionRow(id).metrics_at).toBeNull();
    expect(monthly()).toEqual([]);
  });

  it('gives up after an hour: viewer time NULL, zaps 0, still counted as a stream', async () => {
    const id = ended({ ended: NOW - 61 * MIN, started: NOW - 120 * MIN, note: NOTE });
    const d = deps({ [id]: null }, null);
    expect(await closeOutEndedSessions(db, d, NOW, never)).toEqual({
      recorded: 0,
      waiting: 0,
      gaveUp: 1
    });
    expect(sessionRow(id)).toMatchObject({ viewer_seconds: null, zap_sats: 0, metrics_at: NOW });
    expect(monthly()[0]).toMatchObject({ streams: 1, viewer_seconds: 0, zap_sats: 0 });
  });

  it('does not read zaps for a session without a note', async () => {
    const id = ended({ note: null });
    const d = deps({}, null); // would wait if it were asked
    expect((await closeOutEndedSessions(db, d, NOW, never)).recorded).toBe(1);
    expect(sessionRow(id).zap_sats).toBe(0);
  });

  it('stops when the sweep runs out of time', async () => {
    ended();
    ended();
    let calls = 0;
    const summary = await closeOutEndedSessions(db, deps(), NOW, () => ++calls > 1);
    expect(summary.recorded).toBe(1);
  });

  it('fails soft on a database without migration 0010', async () => {
    const bare = {
      prepare: () => {
        throw new Error('no such column: metrics_at');
      },
      batch: async () => []
    } as never;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await closeOutEndedSessions(bare, deps(), NOW, never)).toEqual({
      recorded: 0,
      waiting: 0,
      gaveUp: 0
    });
  });
});

describe('recordSessionMetrics', () => {
  it('never lowers the stored peak and ignores a session that is not ended', async () => {
    const id = ended({ peak: 7 });
    await recordSessionMetrics(db, id, { viewer_seconds: 1, peak: 3, zap_sats: 0 }, NOW);
    expect(sessionRow(id).peak_watching).toBe(7);
    db.raw
      .prepare(
        `INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at, started_at)
         VALUES (?, ?, 't', 'h', 'live', ?, ?)`
      )
      .run('9'.repeat(32), HOST2, NOW, NOW);
    expect(
      await recordSessionMetrics(
        db,
        '9'.repeat(32),
        { viewer_seconds: 1, peak: 1, zap_sats: 1 },
        NOW
      )
    ).toBe(false);
    expect(monthly()).toHaveLength(1);
  });
});

describe('the sweep runs the close-out', () => {
  it('records sessions only when metrics deps are given', async () => {
    const id = ended();
    const without = await runLiveSweep(db, null, { now: NOW });
    expect(without.metrics.recorded).toBe(0);
    const withDeps = await runLiveSweep(db, null, {
      now: NOW,
      metrics: deps({ [id]: { viewer_seconds: 30, peak: 1 } })
    });
    expect(withDeps.metrics.recorded).toBe(1);
    expect(monthly()[0]).toMatchObject({ viewer_seconds: 30 });
  });
});

describe('retention', () => {
  it('keeps 24 months, the current one included', async () => {
    const put = (month: string) =>
      db.raw
        .prepare(`INSERT INTO live_host_monthly (host_pubkey, month, updated_at) VALUES (?, ?, 1)`)
        .run(HOST, month);
    put('2025-01');
    put('2025-02');
    put('2027-01');
    expect(await deleteOldMonthly(db, NOW)).toBe(1);
    expect(monthly().map((r: { month: string }) => r.month)).toEqual(['2025-02', '2027-01']);
  });

  it('monthKey shifts across years', () => {
    expect(monthKey(NOW)).toBe('2027-01');
    expect(monthKey(NOW, -1)).toBe('2026-12');
    expect(monthKey(NOW, -23)).toBe('2025-02');
    expect(monthKey(NOW, 12)).toBe('2028-01');
  });

  it('account deletion removes the monthly rows and never folds a held row later', async () => {
    const held = ended({ host: HOST });
    db.raw
      .prepare(
        `INSERT INTO live_host_monthly (host_pubkey, month, streams, updated_at) VALUES (?, '2026-12', 3, 1)`
      )
      .run(HOST);
    db.raw
      .prepare(`INSERT INTO live_holds (session_id, status, opened_at) VALUES (?, 'open', ?)`)
      .run(held, NOW);
    await purgeLiveSessions(db, null, HOST);
    expect(monthly()).toEqual([]);
    expect(sessionRow(held).metrics_at).not.toBeNull();
    await closeOutEndedSessions(db, deps(), NOW + 60 * MIN, never);
    expect(monthly()).toEqual([]);
  });
});

describe('fetchNoteZapSats', () => {
  const receipt = (id: string, sats: number, e = NOTE) => ({
    id,
    pubkey: 'z'.repeat(64),
    created_at: 1,
    kind: 9735,
    content: '',
    sig: '',
    tags: [
      ['e', e],
      ['description', JSON.stringify({ tags: [['amount', String(sats * 1000)]] })]
    ]
  });

  it('sums receipts on the note, and only on it', async () => {
    const read = vi.fn(async () => ({
      events: { z: [receipt('1', 21), receipt('2', 1000), receipt('3', 5, 'e'.repeat(64))] },
      anyDone: { z: true }
    }));
    expect(await fetchNoteZapSats(NOTE, read as never)).toBe(1021);
    const [, subs] = read.mock.calls[0] as unknown as [string[], Record<string, unknown>];
    expect(subs).toEqual({ z: { kinds: [9735], '#e': [NOTE], limit: 500 } });
  });

  it('is null when no relay answered, 0 when they answered with nothing', async () => {
    const none = async () => ({ events: { z: [] }, anyDone: { z: false } });
    const empty = async () => ({ events: { z: [] }, anyDone: { z: true } });
    expect(await fetchNoteZapSats(NOTE, none as never)).toBeNull();
    expect(await fetchNoteZapSats(NOTE, empty as never)).toBe(0);
  });
});
