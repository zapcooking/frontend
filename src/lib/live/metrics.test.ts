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
  fetchStreamZapSats,
  monthKey,
  recordSessionMetrics,
  viewerSecondsFor,
  type MetricsDeps
} from './metrics.server';
import { runLiveSweep } from './sweep.server';
import { STREAM_RECEIPT_RELAYS, chatReceiptRelays } from '$lib/streams/relays';
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
      gaveUp: 0,
      retry: 0,
      waiting: 0
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
      gaveUp: 0,
      retry: 1,
      waiting: 1
    });
    expect(await closeOutEndedSessions(db, deps({}, null), NOW, never)).toMatchObject({
      retry: 1,
      waiting: 1
    });
    expect(sessionRow(id).metrics_at).toBeNull();
    expect(monthly()).toEqual([]);
  });

  it('keeps waiting until 24 hours after the end, then records what it could read', async () => {
    const HOUR = 60 * MIN;
    const id = ended({ ended: NOW - 23 * HOUR, started: NOW - 24 * HOUR, note: NOTE });
    const d = deps({ [id]: null }, null);
    // 23 h after the end: still waiting, nothing saved.
    expect(await closeOutEndedSessions(db, d, NOW, never)).toMatchObject({
      recorded: 0,
      retry: 1,
      waiting: 1
    });
    expect(sessionRow(id).metrics_at).toBeNull();
    // Just short of 24 h: still waiting.
    expect((await closeOutEndedSessions(db, d, NOW + HOUR - 1, never)).retry).toBe(1);
    // 24 h: recorded with what could be read.
    expect(await closeOutEndedSessions(db, d, NOW + HOUR, never)).toEqual({
      recorded: 1,
      gaveUp: 1,
      retry: 0,
      waiting: 0
    });
    expect(sessionRow(id)).toMatchObject({
      viewer_seconds: null,
      zap_sats: 0,
      metrics_at: NOW + HOUR
    });
    expect(monthly()[0]).toMatchObject({ streams: 1, viewer_seconds: 0, zap_sats: 0 });
  });

  it('reads zaps for every session: on its address, and on its note when it has one', async () => {
    const withNote = ended({ note: NOTE });
    const noNote = ended({ note: null });
    const asked: Record<string, string[]> = {};
    const d = deps({}, 0);
    d.zapSats = async (targets, host) => {
      const session = targets.at(-1)!.split(':')[2];
      asked[session] = targets;
      expect(host).toBe(HOST);
      return session === noNote ? 700 : 300;
    };
    expect((await closeOutEndedSessions(db, d, NOW, never)).recorded).toBe(2);
    expect(asked[withNote]).toEqual([NOTE, `30311:${HOST}:${withNote}`]);
    expect(asked[noNote]).toEqual([`30311:${HOST}:${noNote}`]);
    // A stream with the note off has a zap total too.
    expect(sessionRow(noNote).zap_sats).toBe(700);
    expect(sessionRow(withNote).zap_sats).toBe(300);
  });

  it('waits when the zaps of a session without a note cannot be read', async () => {
    const id = ended({ note: null });
    const summary = await closeOutEndedSessions(db, deps({}, null), NOW, never);
    expect(summary).toMatchObject({ recorded: 0, retry: 1 });
    expect(sessionRow(id).metrics_at).toBeNull();
  });

  it('stops when the time budget runs out, and reports how many are still waiting', async () => {
    ended();
    ended();
    ended();
    let calls = 0;
    // One check before the batch, one per session: time runs out at the second session.
    const summary = await closeOutEndedSessions(db, deps(), NOW, () => ++calls > 2);
    expect(summary).toMatchObject({ recorded: 1, waiting: 2 });
  });

  it('works through the whole queue in one run, oldest first, past one batch', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => ended({ ended: NOW - (60 - i) * MIN }));
    const order: string[] = [];
    const d = deps();
    const read = d.readTotals;
    d.readTotals = async (id) => {
      order.push(id);
      return read(id);
    };
    expect(await closeOutEndedSessions(db, d, NOW, never)).toMatchObject({
      recorded: 12,
      waiting: 0
    });
    expect(order).toEqual(ids);
  });

  it('looks at each session once per run, so sessions that keep waiting do not loop', async () => {
    for (let i = 0; i < 8; i++) ended({ note: NOTE, ended: NOW - (30 - i) * MIN });
    let reads = 0;
    const d = deps({}, null); // relays never answer
    d.readTotals = async () => {
      reads++;
      return { viewer_seconds: 0, peak: 0 };
    };
    expect(await closeOutEndedSessions(db, d, NOW, never)).toMatchObject({
      recorded: 0,
      retry: 8,
      waiting: 8
    });
    expect(reads).toBe(8);
  });

  it('counts sessions still inside the 5-minute wait as waiting', async () => {
    ended({ ended: NOW - 2 * MIN });
    expect(await closeOutEndedSessions(db, deps(), NOW, never)).toMatchObject({
      recorded: 0,
      retry: 0,
      waiting: 1
    });
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
      gaveUp: 0,
      retry: 0,
      waiting: 0
    });
  });
});

describe('not measured (viewer time NULL)', () => {
  it('stores NULL when the presence object is empty but the row shows people watched', async () => {
    const id = ended({ peak: 3 });
    // An emptied object (e.g. a stream from before viewer time was summed) answers 0 / 0.
    await closeOutEndedSessions(db, deps({ [id]: { viewer_seconds: 0, peak: 0 } }), NOW, never);
    expect(sessionRow(id)).toMatchObject({ viewer_seconds: null, peak_watching: 3 });
    expect(sessionRow(id).metrics_at).toBe(NOW);
    // Still a stream in its month, adding no viewer time.
    expect(monthly()[0]).toMatchObject({ streams: 1, viewer_seconds: 0, peak_watching: 3 });
  });

  it('stores 0 when nobody was counted at all (peak 0)', async () => {
    const id = ended({ peak: 0 });
    await closeOutEndedSessions(db, deps({ [id]: { viewer_seconds: 0, peak: 0 } }), NOW, never);
    expect(sessionRow(id).viewer_seconds).toBe(0);
  });

  it('keeps a measured 0 when the object counted someone (its own peak above 0)', async () => {
    const id = ended({ peak: 1 });
    await closeOutEndedSessions(db, deps({ [id]: { viewer_seconds: 0, peak: 1 } }), NOW, never);
    expect(sessionRow(id).viewer_seconds).toBe(0);
  });

  it('viewerSecondsFor', () => {
    expect(viewerSecondsFor(null, 0)).toBeNull();
    expect(viewerSecondsFor({ viewer_seconds: 0, peak: 0 }, 2)).toBeNull();
    expect(viewerSecondsFor({ viewer_seconds: 0, peak: 0 }, 0)).toBe(0);
    expect(viewerSecondsFor({ viewer_seconds: 90, peak: 0 }, 2)).toBe(90);
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

describe('accounts that asked to be deleted', () => {
  it('never folds a stream created before the request (e.g. a held row from before 0010), but folds a later one', async () => {
    const before = ended({ host: HOST, started: NOW - 120 * MIN, ended: NOW - 100 * MIN });
    db.raw
      .prepare(
        `INSERT INTO account_deletion_requests (pubkey, status, source, billing, requested_at, updated_at)
         VALUES (?, 'completed', 'web', 'none', ?, ?)`
      )
      .run(HOST, NOW - 90 * MIN, NOW - 90 * MIN);
    const after = ended({ host: HOST, started: NOW - 60 * MIN, ended: NOW - 30 * MIN });
    await closeOutEndedSessions(db, deps(), NOW, never);
    expect(sessionRow(before).metrics_at).toBe(NOW); // recorded, so it is not retried
    expect(sessionRow(after).metrics_at).toBe(NOW);
    expect(monthly()).toHaveLength(1);
    expect(monthly()[0]).toMatchObject({ streams: 1, stream_seconds: 30 * MIN });
  });
});

describe('fetchStreamZapSats (verified)', () => {
  const PROVIDER = 'd'.repeat(64);
  const VIEWER = 'b'.repeat(64);
  // Real invoice (zapAmount fixtures): 2000 sats, plaintext description.
  const INVOICE =
    'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567';
  const profile = {
    id: '0'.repeat(64),
    pubkey: HOST,
    created_at: 100,
    kind: 0,
    tags: [],
    content: JSON.stringify({ lud16: 'chef@example.com' }),
    sig: 's'
  };
  const ADDRESS = `30311:${HOST}:${'ab'.repeat(16)}`;
  const receipt = (
    over: { id?: string; pubkey?: string; e?: string; a?: string; amount?: string } = {}
  ) => {
    // `a`: a zap to the stream's address instead of the note.
    const target = over.a ? ['a', over.a] : ['e', over.e ?? NOTE];
    const request = {
      id: 'r'.repeat(64),
      pubkey: VIEWER,
      created_at: 50,
      kind: 9734,
      tags: [target, ['p', HOST], ['amount', over.amount ?? '2000000']],
      content: '',
      sig: 's'
    };
    return {
      id: over.id ?? '1'.repeat(64),
      pubkey: over.pubkey ?? PROVIDER,
      created_at: 60,
      kind: 9735,
      tags: [
        target,
        ['p', HOST],
        ['bolt11', INVOICE],
        ['description', JSON.stringify(request)]
      ],
      content: '',
      sig: 's'
    };
  };
  type Page = { events: unknown[]; done?: boolean; closed?: string };
  /** A collect() fake: kind-0 reads get the profile; receipt reads get `pages(relay)`. */
  function relays(receipts: (relay: string) => Page) {
    return vi.fn(async (url: string, subs: Record<string, Record<string, unknown>>) => {
      const key = Object.keys(subs)[0];
      const page: Page = key === 'p' ? { events: [profile] } : receipts(url);
      const f = subs[key];
      // Honour the time window and the tag filters, as a relay does.
      const tagged = (e: { tags?: string[][] }, name: string) =>
        !f[`#${name}`] ||
        !!e.tags?.some((t) => t[0] === name && (f[`#${name}`] as string[]).includes(t[1]));
      const events = (page.events as { created_at: number; tags?: string[][] }[]).filter(
        (e) =>
          (f.until === undefined || e.created_at <= (f.until as number)) &&
          (f.since === undefined || e.created_at >= (f.since as number)) &&
          tagged(e, 'e') &&
          tagged(e, 'a')
      );
      return {
        events: { [key]: events },
        done: { [key]: page.done ?? true },
        closed: page.closed ? { [key]: page.closed } : {}
      };
    });
  }
  const lnurl = (meta: unknown = { allowsNostr: true, nostrPubkey: PROVIDER }, ok = true) =>
    vi.fn(async () => new Response(JSON.stringify(meta), { status: ok ? 200 : 503 }));
  const verify = () => true;

  it('counts a provider-signed receipt once, however many relays carry it', async () => {
    const collect = relays(() => ({ events: [receipt()] }));
    const fetch = lnurl();
    expect(await fetchStreamZapSats([NOTE], HOST, { collect: collect as never, fetch, verify })).toBe(
      2000
    );
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe(
      'https://example.com/.well-known/lnurlp/chef'
    );
  });

  it('ignores forged receipts: wrong signer, another note, or a mismatched amount', async () => {
    const collect = relays(() => ({
      events: [
        receipt({ id: '2'.repeat(64), pubkey: 'f'.repeat(64) }),
        receipt({ id: '3'.repeat(64), e: 'e'.repeat(64) }),
        receipt({ id: '4'.repeat(64), amount: '999000' })
      ]
    }));
    expect(
      await fetchStreamZapSats([NOTE], HOST, { collect: collect as never, fetch: lnurl(), verify })
    ).toBe(0);
    // A receipt whose signature does not verify is not counted.
    const one = relays(() => ({ events: [receipt()] }));
    const receiptsFail = (e: { kind: number }) => e.kind !== 9735;
    expect(
      await fetchStreamZapSats([NOTE], HOST, {
        collect: one as never,
        fetch: lnurl(),
        verify: receiptsFail as never
      })
    ).toBe(0);
    // A profile that does not verify gives no provider: nothing can be verified.
    expect(
      await fetchStreamZapSats([NOTE], HOST, {
        collect: one as never,
        fetch: lnurl(),
        verify: () => false
      })
    ).toBe(0);
  });

  it('is null when every relay answers CLOSED or times out (retried), 0 after a clean empty pass', async () => {
    const closed = relays(() => ({ events: [], done: true, closed: 'auth-required: sign in' }));
    expect(
      await fetchStreamZapSats([NOTE], HOST, { collect: closed as never, fetch: lnurl(), verify })
    ).toBeNull();
    const timedOut = relays(() => ({ events: [], done: false }));
    expect(
      await fetchStreamZapSats([NOTE], HOST, { collect: timedOut as never, fetch: lnurl(), verify })
    ).toBeNull();
    const empty = relays(() => ({ events: [] }));
    expect(
      await fetchStreamZapSats([NOTE], HOST, { collect: empty as never, fetch: lnurl(), verify })
    ).toBe(0);
  });

  it('is null when the provider is unreachable, 0 when the host has no zappable address', async () => {
    const collect = relays(() => ({ events: [receipt()] }));
    expect(
      await fetchStreamZapSats([NOTE], HOST, {
        collect: collect as never,
        fetch: lnurl({}, false),
        verify
      })
    ).toBeNull();
    expect(
      await fetchStreamZapSats([NOTE], HOST, {
        collect: collect as never,
        fetch: lnurl({ allowsNostr: false }),
        verify
      })
    ).toBe(0);
  });

  it('reads receipts from the shared receipt relay list (relay.damus.io included)', async () => {
    const asked = new Set<string>();
    const collect = relays((url) => {
      asked.add(url);
      return { events: [] };
    });
    await fetchStreamZapSats([NOTE], HOST, { collect: collect as never, fetch: lnurl(), verify });
    expect([...asked].sort()).toEqual([...STREAM_RECEIPT_RELAYS].sort());
    expect(asked.has('wss://relay.damus.io')).toBe(true);
  });

  it("looks up each host's provider once per run", async () => {
    const collect = relays(() => ({ events: [receipt()] }));
    const fetch = lnurl();
    const providers = new Map();
    for (let i = 0; i < 3; i++) {
      await fetchStreamZapSats([NOTE], HOST, { collect: collect as never, fetch, verify, providers });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('counts zaps to the address: a stream with the note off has a total', async () => {
    const collect = relays(() => ({ events: [receipt({ a: ADDRESS })] }));
    const deps = { collect: collect as never, fetch: lnurl(), verify };
    expect(await fetchStreamZapSats([ADDRESS], HOST, deps)).toBe(2000);
    // Another stream's address is not this stream's.
    expect(await fetchStreamZapSats([`30311:${HOST}:${'cd'.repeat(16)}`], HOST, deps)).toBe(0);
    // No target at all: nothing to read, and no relay is asked.
    collect.mockClear();
    expect(await fetchStreamZapSats([], HOST, deps)).toBe(0);
    expect(collect).not.toHaveBeenCalled();
  });

  it('reads the note and the address with a filter each, and counts one payment once', async () => {
    const filters: Record<string, unknown>[] = [];
    // The same payment (one invoice) is on relays as a zap to the note and,
    // under another receipt id, as a zap to the address.
    const stored = [receipt(), receipt({ id: '5'.repeat(64), a: ADDRESS })];
    const inner = relays(() => ({ events: stored }));
    const collect = vi.fn(async (url: string, subs: Record<string, Record<string, unknown>>) => {
      if (subs.z) filters.push(subs.z);
      return inner(url, subs);
    });
    const deps = { collect: collect as never, fetch: lnurl(), verify };
    expect(await fetchStreamZapSats([NOTE, ADDRESS], HOST, deps)).toBe(2000);
    expect(filters.some((f) => JSON.stringify(f['#e']) === JSON.stringify([NOTE]))).toBe(true);
    expect(filters.some((f) => JSON.stringify(f['#a']) === JSON.stringify([ADDRESS]))).toBe(true);
    // Never one filter with both tags (a relay would AND them).
    expect(filters.some((f) => '#e' in f && '#a' in f)).toBe(false);
    // Either target alone finds its own receipt.
    expect(await fetchStreamZapSats([NOTE], HOST, deps)).toBe(2000);
    expect(await fetchStreamZapSats([ADDRESS], HOST, deps)).toBe(2000);
  });

  it('is null (retried) when no relay answers for one of the targets', async () => {
    const inner = relays(() => ({ events: [receipt()] }));
    // Every relay answers the note query and times out on the address query.
    const collect = vi.fn(async (url: string, subs: Record<string, Record<string, unknown>>) =>
      subs.z?.['#a'] ? { events: { z: [] }, done: { z: false }, closed: {} } : inner(url, subs)
    );
    expect(
      await fetchStreamZapSats([NOTE, ADDRESS], HOST, {
        collect: collect as never,
        fetch: lnurl(),
        verify
      })
    ).toBeNull();
  });

  it('walks history backward past the first page', async () => {
    const calls: Record<string, unknown>[] = [];
    const collect = vi.fn(async (_url: string, subs: Record<string, Record<string, unknown>>) => {
      const key = Object.keys(subs)[0];
      if (key === 'p') return { events: { p: [profile] }, done: { p: true }, closed: {} };
      const f = subs.z;
      calls.push(f);
      // First page: one receipt at t=60 (a full page of 1). Boundary and older pages: empty.
      const events = f.until === undefined || (f.until as number) > 60 ? [receipt()] : [];
      return { events: { z: f.since === 60 ? [] : events }, done: { z: true }, closed: {} };
    });
    expect(
      await fetchStreamZapSats([NOTE], HOST, { collect: collect as never, fetch: lnurl(), verify })
    ).toBe(2000);
    // Each relay asked again below the oldest receipt seen.
    expect(calls.some((f) => f.until === 59)).toBe(true);
  });
});

describe('one receipt relay list for the chat and the recorder', () => {
  it("the chat starts from the stream's relays plus the shared list", () => {
    const chat = chatReceiptRelays(['wss://stream.example']);
    expect(chat[0]).toBe('wss://stream.example');
    expect(chat.slice(1)).toEqual([...STREAM_RECEIPT_RELAYS]);
    expect(STREAM_RECEIPT_RELAYS).toContain('wss://relay.damus.io');
    expect(new Set(STREAM_RECEIPT_RELAYS).size).toBe(STREAM_RECEIPT_RELAYS.length);
  });
});
