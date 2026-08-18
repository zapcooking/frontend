/**
 * Unit tests for the scheduled-posts sweep (workers/cron/sweep.ts)
 * and the cron trigger routing (workers/cron/index.js).
 *
 * The D1 fake implements exactly the five statements the sweep
 * issues and throws on anything else. Its mutations are synchronous
 * inside run()/all(), which mirrors D1's per-statement atomicity —
 * that's what makes the concurrency test honest: two racing sweeps
 * interleave at await boundaries but each claim is atomic.
 *
 * Crypto runs for real (rows are encrypted with the shared helper);
 * relays never do — the publisher is injected and keeps a call log.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  sweepDueEvents,
  relaysFor,
  PANTRY_RELAY,
  MAX_ATTEMPTS,
  SWEEP_BATCH_LIMIT
} from './sweep';
import { dispatchScheduled, MINUTELY_CRON, DAILY_CRON } from './index';
import { importScheduleKey, encryptScheduledEvent } from '../../src/lib/scheduleCrypto.server';
import { standardRelays } from '../../src/lib/consts';

const ENC_KEY = 'd'.repeat(64);
const NOW = 1_800_000_000;
const fixedClock = () => NOW;

let key: CryptoKey;
beforeAll(async () => {
  key = await importScheduleKey(ENC_KEY);
});

// ── fake D1 ─────────────────────────────────────────────────────────

interface Row {
  id: string;
  pubkey: string;
  kind: number;
  publish_at: number;
  relay_mode: string;
  ciphertext: string;
  iv: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
}

function fakeD1(rows: Row[]) {
  return {
    rows,
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first() {
              if (sql.startsWith('SELECT status')) {
                const r = rows.find((r) => r.id === args[0]);
                return r ? { status: r.status } : null;
              }
              throw new Error(`fakeD1: unexpected first(): ${sql}`);
            },
            async all() {
              if (sql.includes('publish_at <= ?1')) {
                const results = rows
                  .filter((r) => r.status === 'pending' && r.publish_at <= args[0])
                  .sort((a, b) => a.publish_at - b.publish_at)
                  .slice(0, SWEEP_BATCH_LIMIT)
                  .map(({ id, publish_at, relay_mode, ciphertext, iv }) => ({
                    id,
                    publish_at,
                    relay_mode,
                    ciphertext,
                    iv
                  }));
                return { results };
              }
              throw new Error(`fakeD1: unexpected all(): ${sql}`);
            },
            async run() {
              if (sql.includes("SET status = 'pending'") && sql.includes("'publishing'")) {
                let changes = 0;
                for (const r of rows) {
                  if (r.status === 'publishing' && r.updated_at < args[1]) {
                    r.status = 'pending';
                    r.updated_at = args[0];
                    changes++;
                  }
                }
                return { meta: { changes } };
              }
              if (sql.includes("SET status = 'publishing'")) {
                const r = rows.find((r) => r.id === args[0] && r.status === 'pending');
                if (!r) return { meta: { changes: 0 } };
                r.status = 'publishing';
                r.updated_at = args[1];
                return { meta: { changes: 1 } };
              }
              if (sql.includes("SET status = 'sent'")) {
                const r = rows.find((r) => r.id === args[0]);
                if (!r) return { meta: { changes: 0 } };
                r.status = 'sent';
                r.sent_at = args[1];
                r.updated_at = args[1];
                return { meta: { changes: 1 } };
              }
              if (sql.includes('attempts = attempts + 1')) {
                const r = rows.find((r) => r.id === args[0]);
                if (!r) return { meta: { changes: 0 } };
                r.attempts += 1;
                r.last_error = args[1];
                r.updated_at = args[2];
                r.status =
                  r.attempts >= MAX_ATTEMPTS || args[2] > r.publish_at + 86400
                    ? 'failed'
                    : 'pending';
                return { meta: { changes: 1 } };
              }
              throw new Error(`fakeD1: unexpected run(): ${sql}`);
            }
          };
        }
      };
    }
  };
}

type FakeDb = ReturnType<typeof fakeD1>;

let seq = 0;
/** Seed a row whose ciphertext really decrypts to a distinct event. */
async function seedRow(rows: Row[], overrides: Partial<Row> = {}): Promise<Row & { eventId: string }> {
  const eventId = `event-${++seq}`;
  const { ciphertext, iv } = await encryptScheduledEvent(
    key,
    JSON.stringify({ id: eventId, kind: 1, content: `content ${seq}` })
  );
  const row: Row = {
    id: seq.toString(16).padStart(64, '0'),
    pubkey: 'p'.repeat(64),
    kind: 1,
    publish_at: NOW - 60,
    relay_mode: 'all',
    ciphertext,
    iv,
    status: 'pending',
    attempts: 0,
    last_error: null,
    created_at: NOW - 3600,
    updated_at: NOW - 3600,
    sent_at: null,
    ...overrides
  };
  rows.push(row);
  return Object.assign(row, { eventId });
}

/** Injected publisher with a call log; okCount relays "accept". */
function makePublisher(okCount = 1, delayMs = 0) {
  const calls: { eventId: string; relays: string[] }[] = [];
  const publish = async (event: any, relays: string[]) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    calls.push({ eventId: event.id, relays });
    return okCount;
  };
  return { calls, publish };
}

function sweep(db: FakeDb, publish: any, clock: () => number = fixedClock) {
  return sweepDueEvents({ db, encKeyHex: ENC_KEY, publish, clock });
}

// ── relay sets ──────────────────────────────────────────────────────

describe('relaysFor', () => {
  it("'pantry' broadcasts to the pantry relay only", () => {
    expect(relaysFor('pantry')).toEqual([PANTRY_RELAY]);
  });

  it("'all' broadcasts to the app's default relay list (shared constant, not a mirror)", () => {
    expect(relaysFor('all')).toBe(standardRelays);
    expect(standardRelays.length).toBeGreaterThan(0);
  });
});

// ── Gate A: concurrency ─────────────────────────────────────────────

describe('concurrent sweeps', () => {
  it('two sweeps racing over the same due rows broadcast every row exactly once', async () => {
    const rows: Row[] = [];
    const seeded = [];
    for (let i = 0; i < 5; i++) seeded.push(await seedRow(rows));
    const db = fakeD1(rows);

    // Slow publisher forces interleaving: while sweep 1 awaits a
    // publish, sweep 2 runs its select + claims.
    const p1 = makePublisher(1, 5);
    const p2 = makePublisher(1, 5);
    const [s1, s2] = await Promise.all([sweep(db, p1.publish), sweep(db, p2.publish)]);

    const allCalls = [...p1.calls, ...p2.calls];
    const broadcastIds = allCalls.map((c) => c.eventId).sort();
    expect(broadcastIds).toEqual(seeded.map((r) => r.eventId).sort()); // once each, none missing
    expect(new Set(broadcastIds).size).toBe(5);
    expect(rows.every((r) => r.status === 'sent')).toBe(true);
    expect(s1.sent + s2.sent).toBe(5);
    expect(s1.skipped + s2.skipped).toBeGreaterThan(0); // the loser actually raced
  });
});

// ── Gate B: recovery ────────────────────────────────────────────────

describe('stuck-claim recovery', () => {
  it('re-claims and broadcasts a row stuck in publishing for 6 minutes; leaves a 2-minute-old claim alone', async () => {
    const rows: Row[] = [];
    const stale = await seedRow(rows, { status: 'publishing', updated_at: NOW - 360 });
    const fresh = await seedRow(rows, { status: 'publishing', updated_at: NOW - 120 });
    const db = fakeD1(rows);

    const pub = makePublisher(1);
    const summary = await sweep(db, pub.publish);

    expect(summary.recovered).toBe(1);
    expect(pub.calls.map((c) => c.eventId)).toEqual([stale.eventId]);
    expect(stale.status).toBe('sent');
    // The fresh claim belongs to a sweep that may still be alive.
    expect(fresh.status).toBe('publishing');
  });
});

// ── Gate C: cancel-vs-sweep race ────────────────────────────────────

describe('cancel-vs-sweep race', () => {
  it('a row cancelled between SELECT and claim is skipped and stays cancelled', async () => {
    const rows: Row[] = [];
    const row = await seedRow(rows);
    const db = fakeD1(rows);

    // Interpose on the due-select: the owner cancels right after the
    // sweep has read the row but before it claims.
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (!sql.includes('publish_at <= ?1')) return stmt;
      return {
        bind(...args: any[]) {
          const bound = stmt.bind(...args);
          return {
            ...bound,
            async all() {
              const res = await bound.all();
              row.status = 'cancelled';
              return res;
            }
          };
        }
      };
    };

    const pub = makePublisher(1);
    const summary = await sweep(db, pub.publish);

    expect(summary.skipped).toBe(1);
    expect(pub.calls).toEqual([]); // nothing broadcast
    expect(row.status).toBe('cancelled');
  });
});

// ── Gate D: terminal transitions ────────────────────────────────────

describe('terminal failure transitions', () => {
  it("the 10th failed attempt parks the row in 'failed'", async () => {
    const rows: Row[] = [];
    const row = await seedRow(rows, { attempts: MAX_ATTEMPTS - 1 });
    const db = fakeD1(rows);

    const pub = makePublisher(0); // zero relays accept
    const summary = await sweep(db, pub.publish);

    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.last_error).toBe('no_relay_accepted');
    expect(summary.failed).toBe(1);
  });

  it("a row past publish_at + 24h fails terminally even on attempt 1", async () => {
    const rows: Row[] = [];
    const row = await seedRow(rows, { publish_at: NOW - 86400 - 300, attempts: 0 });
    const db = fakeD1(rows);

    const pub = makePublisher(0);
    await sweep(db, pub.publish);

    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
  });

  it("a mid-window failure goes back to 'pending' for the next tick", async () => {
    const rows: Row[] = [];
    const row = await seedRow(rows, { attempts: 3 });
    const db = fakeD1(rows);

    const pub = makePublisher(0);
    const summary = await sweep(db, pub.publish);

    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(4);
    expect(summary.retried).toBe(1);
  });

  it("an undecryptable row records last_error='decrypt_failed' as a normal attempt (no hot loop)", async () => {
    const rows: Row[] = [];
    const row = await seedRow(rows);
    // Valid base64, wrong bytes — GCM auth fails on decrypt.
    row.ciphertext = btoa('not the real ciphertext');
    const db = fakeD1(rows);

    const pub = makePublisher(1);
    const summary = await sweep(db, pub.publish);

    expect(pub.calls).toEqual([]);
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe('decrypt_failed');
    expect(summary.retried).toBe(1);
  });
});

// ── Gate E: partial relay success ───────────────────────────────────

describe('partial relay success', () => {
  it("1 OK out of 3 relays counts as 'sent'", async () => {
    const rows: Row[] = [];
    const row = await seedRow(rows);
    const db = fakeD1(rows);

    const pub = makePublisher(1); // 1 accept (the other 2 "failed")
    const summary = await sweep(db, pub.publish);

    expect(row.status).toBe('sent');
    expect(row.sent_at).toBe(NOW);
    expect(summary.sent).toBe(1);
  });
});

// ── tick budget ─────────────────────────────────────────────────────

describe('tick wall-clock budget', () => {
  it('stops claiming once the budget is exhausted; unprocessed rows stay pending', async () => {
    const rows: Row[] = [];
    const first = await seedRow(rows, { publish_at: NOW - 120 });
    const second = await seedRow(rows, { publish_at: NOW - 60 });
    const db = fakeD1(rows);

    // Clock advances 30 s on every publish — after the first row the
    // 25 s budget is blown.
    let t = NOW;
    const clock = () => t;
    const calls: string[] = [];
    const publish = async (event: any) => {
      calls.push(event.id);
      t += 30;
      return 1;
    };

    const summary = await sweep(db, publish, clock);

    expect(calls).toEqual([first.eventId]);
    expect(first.status).toBe('sent');
    expect(second.status).toBe('pending'); // untouched — next tick's work
    expect(summary.sent).toBe(1);
  });
});

// ── Gate F: trigger routing ─────────────────────────────────────────

describe('cron trigger routing', () => {
  function spies() {
    const calls: string[] = [];
    return {
      calls,
      impl: {
        sweep: async () => {
          calls.push('sweep');
        },
        membership: async () => {
          calls.push('membership');
        }
      }
    };
  }

  it('the minutely trigger runs the sweep and never the membership check', async () => {
    const { calls, impl } = spies();
    await dispatchScheduled({ cron: MINUTELY_CRON }, {}, impl);
    expect(calls).toEqual(['sweep']);
  });

  it('the daily trigger runs the membership check and never the sweep', async () => {
    const { calls, impl } = spies();
    await dispatchScheduled({ cron: DAILY_CRON }, {}, impl);
    expect(calls).toEqual(['membership']);
  });

  it('an unknown cron falls through to the membership check (pre-split behavior)', async () => {
    const { calls, impl } = spies();
    await dispatchScheduled({ cron: '30 12 * * *' }, {}, impl);
    expect(calls).toEqual(['membership']);
  });
});
