/**
 * Unit tests for the Scheduled Posts API:
 *   POST   /api/schedule        (create)
 *   GET    /api/schedule        (list)
 *   DELETE /api/schedule/[id]   (cancel)
 *
 * NIP-98 auth runs FOR REAL (signed kind-27235 headers via
 * nostr-tools) — no verifier mocks, so the auth-response-shaping and
 * payload-binding behavior under test is the behavior in production.
 * D1 is a small in-memory fake that implements exactly the statements
 * the routes issue and throws on anything else.
 *
 * Covers every row of the spec §5.1 validation table plus the review
 * gates: coarse 401s that never leak the verifier's granular reason,
 * route-level pubkey_mismatch (not expectedPubkey), byte-identical
 * DELETE 404s for missing vs foreign rows, and the cancel-and-recreate
 * rate-limit bypass attempt.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '$lib/nip98';
import { POLL_ENDS_AT_TAG, ZAP_POLL_CLOSED_AT_TAG } from '$lib/polls';
import {
  importScheduleKey,
  encryptScheduledEvent,
  decryptScheduledEvent
} from '$lib/scheduleCrypto.server';
import { MAX_SCHEDULE_RELAYS } from '$lib/scheduleRelays';
import {
  SCHEDULABLE_KINDS,
  PANTRY_SCHEDULABLE_KINDS,
  MAX_PENDING_PER_PUBKEY,
  MAX_CREATES_PER_HOUR,
  MAX_MOVES_PER_HOUR,
  MIN_LEAD_SECONDS
} from '$lib/scheduleApi.server';
import { POST, GET } from './+server';
import { DELETE } from './[id]/+server';

const ENDPOINT = 'https://zap.cooking/api/schedule';
const ENC_KEY = 'c'.repeat(64);

const sk = generateSecretKey();
const PUBKEY = getPublicKey(sk);
const otherSk = generateSecretKey();
const OTHER_PUBKEY = getPublicKey(otherSk);

/** Every granular verifier reason — none may ever appear in a response. */
const GRANULAR_REASONS = [
  'missing-header',
  'malformed-header',
  'invalid-signature',
  'wrong-kind',
  'stale-timestamp',
  'url-mismatch',
  'method-mismatch',
  'payload-mismatch',
  'missing-payload-tag',
  'pubkey-mismatch'
];

const nowSec = () => Math.floor(Date.now() / 1000);

// ── fake D1 ─────────────────────────────────────────────────────────

interface Row {
  id: string;
  pubkey: string;
  kind: number;
  publish_at: number;
  relay_mode: string;
  relays: string | null;
  ciphertext: string;
  iv: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
}

function fakeD1(rows: Row[] = []) {
  return {
    rows,
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first() {
              if (sql.includes('COUNT(*)') && sql.includes("'pending'")) {
                return { c: rows.filter((r) => r.pubkey === args[0] && r.status === 'pending').length };
              }
              if (sql.includes('COUNT(*)') && sql.includes('created_at >')) {
                // Plain creates only; this fake holds no replacing rows
                // (replaces is exercised against real SQLite below).
                if (!sql.includes('replaces IS NULL')) {
                  throw new Error('fakeD1: the creates count must leave out replacing rows');
                }
                return { c: rows.filter((r) => r.pubkey === args[0] && r.created_at > args[1]).length };
              }
              if (sql.startsWith('SELECT status')) {
                const row = rows.find((r) => r.id === args[0] && r.pubkey === args[1]);
                return row ? { status: row.status } : null;
              }
              throw new Error(`fakeD1: unexpected first(): ${sql}`);
            },
            async all() {
              if (sql.includes('ORDER BY publish_at DESC')) {
                // Filtered form binds the status as ?3; it must be in the SQL
                  // for the bind to mean anything.
                  const byStatus = sql.includes('status = ?3');
                  if (!byStatus && args.length > 2) {
                    throw new Error('fakeD1: status bound but not filtered on');
                  }
                // The unfiltered form must leave cancelled rows out in SQL.
                const liveOnly = sql.includes("status != 'cancelled'");
                if (!byStatus && !liveOnly) {
                  throw new Error('fakeD1: unfiltered list must exclude cancelled rows');
                }
                const results = rows
                  .filter(
                    (r) =>
                      r.pubkey === args[0] &&
                      (byStatus ? r.status === args[2] : r.status !== 'cancelled')
                  )
                  .sort((a, b) => b.publish_at - a.publish_at || b.created_at - a.created_at)
                  .slice(0, args[1])
                  .map((r) => ({
                    id: r.id,
                    publish_at: r.publish_at,
                    relay_mode: r.relay_mode,
                    relays: r.relays,
                    status: r.status,
                    attempts: r.attempts,
                    last_error: r.last_error,
                    sent_at: r.sent_at,
                    ciphertext: r.ciphertext,
                    iv: r.iv
                  }));
                return { results };
              }
              throw new Error(`fakeD1: unexpected all(): ${sql}`);
            },
            async run() {
              if (sql.includes('INSERT INTO scheduled_events')) {
                const [id, pubkey, kind, publish_at, relay_mode, ciphertext, iv, now, relays] = args;
                if (args.length !== 9 || !/\brelays\)/.test(sql)) {
                  throw new Error('fakeD1: INSERT must name and bind the relays column');
                }
                if (rows.some((r) => r.id === id)) {
                  throw new Error('UNIQUE constraint failed: scheduled_events.id');
                }
                rows.push({
                  id,
                  pubkey,
                  kind,
                  publish_at,
                  relay_mode,
                  relays,
                  ciphertext,
                  iv,
                  status: 'pending',
                  attempts: 0,
                  last_error: null,
                  created_at: now,
                  updated_at: now,
                  sent_at: null
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes("SET status = 'cancelled'")) {
                const row = rows.find(
                  (r) => r.id === args[0] && r.pubkey === args[1] && r.status === 'pending'
                );
                if (!row) return { meta: { changes: 0 } };
                row.status = 'cancelled';
                row.updated_at = args[2];
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

let seedSeq = 0;
function seedRow(db: FakeDb, overrides: Partial<Row> = {}): Row {
  const now = nowSec();
  const row: Row = {
    id: (++seedSeq).toString(16).padStart(64, '0'),
    pubkey: PUBKEY,
    kind: 1,
    publish_at: now + 3600,
    relay_mode: 'all',
    relays: null,
    ciphertext: 'unused',
    iv: 'unused',
    status: 'pending',
    attempts: 0,
    last_error: null,
    created_at: now - 7200,
    updated_at: now - 7200,
    sent_at: null,
    ...overrides
  };
  db.rows.push(row);
  return row;
}

// ── request builders ────────────────────────────────────────────────

async function nip98Header(opts: {
  url: string;
  method: string;
  body?: string;
  secretKey?: Uint8Array;
  omitPayloadTag?: boolean;
  methodTag?: string;
}): Promise<string> {
  const tags: string[][] = [
    ['u', normalizeUrl(opts.url)],
    ['method', opts.methodTag ?? opts.method]
  ];
  if (opts.body !== undefined && !opts.omitPayloadTag) {
    tags.push(['payload', await sha256Hex(new TextEncoder().encode(opts.body))]);
  }
  const template: EventTemplate = { kind: 27235, created_at: nowSec(), tags, content: '' };
  return `Nostr ${btoa(JSON.stringify(finalizeEvent(template, opts.secretKey ?? sk)))}`;
}

/** Strip nostr-tools' non-JSON Symbol(verified) marker for deep-equal checks. */
function plain(event: unknown) {
  return JSON.parse(JSON.stringify(event));
}

/** Sign a schedulable event with created_at defaulting to +1 h out. */
function futureEvent(overrides: Partial<EventTemplate> = {}, secretKey: Uint8Array = sk) {
  return finalizeEvent(
    {
      kind: 1,
      created_at: nowSec() + 3600,
      tags: [],
      content: 'hello from the future',
      ...overrides
    },
    secretKey
  );
}

function platformFor(db: FakeDb | null) {
  return { env: db ? { SCHEDULER_DB: db, SCHEDULE_ENC_KEY: ENC_KEY } : {} };
}

async function readJson(res: Response) {
  const text = await res.text();
  return { text, data: text ? (JSON.parse(text) as any) : null };
}

async function post(
  db: FakeDb | null,
  body: unknown,
  opts: { rawBody?: string; authHeader?: string | null; secretKey?: Uint8Array } = {}
) {
  const rawBody = opts.rawBody ?? JSON.stringify(body);
  const authHeader =
    opts.authHeader === undefined
      ? await nip98Header({ url: ENDPOINT, method: 'POST', body: rawBody, secretKey: opts.secretKey })
      : opts.authHeader;
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authHeader) headers.set('Authorization', authHeader);
  const request = new Request(ENDPOINT, { method: 'POST', headers, body: rawBody });
  const res = await POST({ request, platform: platformFor(db) } as any);
  return { res, ...(await readJson(res)) };
}

async function list(db: FakeDb | null, opts: { secretKey?: Uint8Array; query?: string } = {}) {
  // The auth event signs the bare URL; the query string is not part of
  // the NIP-98 `u` match, exactly as a real client would send it.
  const headers = new Headers({
    Authorization: await nip98Header({ url: ENDPOINT, method: 'GET', secretKey: opts.secretKey })
  });
  const request = new Request(ENDPOINT + (opts.query ?? ''), { method: 'GET', headers });
  const res = await GET({ request, platform: platformFor(db) } as any);
  return { res, ...(await readJson(res)) };
}

async function cancel(db: FakeDb | null, id: string, opts: { secretKey?: Uint8Array } = {}) {
  const url = `${ENDPOINT}/${id}`;
  const headers = new Headers({
    Authorization: await nip98Header({ url, method: 'DELETE', secretKey: opts.secretKey })
  });
  const request = new Request(url, { method: 'DELETE', headers });
  const res = await DELETE({ request, params: { id }, platform: platformFor(db) } as any);
  return { res, ...(await readJson(res)) };
}

// ── POST: §5.1 validation table, in order ───────────────────────────

describe('POST /api/schedule — validation table', () => {
  it('400 bad_request when the body is not JSON', async () => {
    const { res, data } = await post(fakeD1(), null, { rawBody: 'not json' });
    expect(res.status).toBe(400);
    expect(data.error).toBe('bad_request');
  });

  it('400 bad_request when event is missing', async () => {
    const { res, data } = await post(fakeD1(), { relay_mode: 'all' });
    expect(res.status).toBe(400);
    expect(data.error).toBe('bad_request');
  });

  it('400 bad_request when relay_mode is missing', async () => {
    const { res, data } = await post(fakeD1(), { event: futureEvent() });
    expect(res.status).toBe(400);
    expect(data.error).toBe('bad_request');
  });

  it('400 bad_relay_mode for an unknown relay_mode', async () => {
    const { res, data } = await post(fakeD1(), { event: futureEvent(), relay_mode: 'some' });
    expect(res.status).toBe(400);
    expect(data.error).toBe('bad_relay_mode');
  });

  it('400 bad_signature for a tampered event', async () => {
    const event = { ...futureEvent(), content: 'tampered after signing' };
    const { res, data } = await post(fakeD1(), { event, relay_mode: 'all' });
    expect(res.status).toBe(400);
    expect(data.error).toBe('bad_signature');
  });

  it('400 pubkey_mismatch when the payload event is signed by a different key than the auth header', async () => {
    // Auth header signed by sk (valid), event signed by otherSk (also
    // internally valid) — must be a route-level 400, NOT a 401: auth
    // itself succeeded, the body just belongs to someone else.
    const { res, data } = await post(fakeD1(), {
      event: futureEvent({}, otherSk),
      relay_mode: 'all'
    });
    expect(res.status).toBe(400);
    expect(data.error).toBe('pubkey_mismatch');
  });

  it('400 bad_kind for a kind outside the allowlist', async () => {
    const { res, data } = await post(fakeD1(), { event: futureEvent({ kind: 7 }), relay_mode: 'all' });
    expect(res.status).toBe(400);
    expect(data.error).toBe('bad_kind');
  });

  it('400 bad_publish_time when created_at is less than 2 minutes out', async () => {
    const { res, data } = await post(fakeD1(), {
      event: futureEvent({ created_at: nowSec() + 60 }),
      relay_mode: 'all'
    });
    expect(res.status).toBe(400);
    expect(data.error).toBe('bad_publish_time');
  });

  it('400 bad_publish_time when created_at is more than 90 days out', async () => {
    const { res, data } = await post(fakeD1(), {
      event: futureEvent({ created_at: nowSec() + 91 * 86400 }),
      relay_mode: 'all'
    });
    expect(res.status).toBe(400);
    expect(data.error).toBe('bad_publish_time');
  });

  it('400 too_large when the serialized event exceeds 64 KB', async () => {
    const { res, data } = await post(fakeD1(), {
      event: futureEvent({ content: 'x'.repeat(64 * 1024 + 1) }),
      relay_mode: 'all'
    });
    expect(res.status).toBe(400);
    expect(data.error).toBe('too_large');
  });

  it('400 poll_closes_before_publish for a kind-1068 poll closing within 60 s of publish', async () => {
    const publishAt = nowSec() + 3600;
    const event = futureEvent({
      kind: 1068,
      created_at: publishAt,
      tags: [
        ['option', 'aaaaaaaaa', 'Yes'],
        ['option', 'bbbbbbbbb', 'No'],
        [POLL_ENDS_AT_TAG, String(publishAt + 30)]
      ]
    });
    const { res, data } = await post(fakeD1(), { event, relay_mode: 'all' });
    expect(res.status).toBe(400);
    expect(data.error).toBe('poll_closes_before_publish');
  });

  it('400 poll_closes_before_publish for a kind-6969 zap poll closing before publish', async () => {
    const publishAt = nowSec() + 3600;
    const event = futureEvent({
      kind: 6969,
      created_at: publishAt,
      tags: [
        ['poll_option', '0', 'Yes'],
        ['poll_option', '1', 'No'],
        [ZAP_POLL_CLOSED_AT_TAG, String(publishAt - 100)]
      ]
    });
    const { res, data } = await post(fakeD1(), { event, relay_mode: 'all' });
    expect(res.status).toBe(400);
    expect(data.error).toBe('poll_closes_before_publish');
  });

  it('201 for a poll that stays open comfortably past publish', async () => {
    const publishAt = nowSec() + 3600;
    const event = futureEvent({
      kind: 1068,
      created_at: publishAt,
      tags: [
        ['option', 'aaaaaaaaa', 'Yes'],
        ['option', 'bbbbbbbbb', 'No'],
        [POLL_ENDS_AT_TAG, String(publishAt + 86400)]
      ]
    });
    const { res } = await post(fakeD1(), { event, relay_mode: 'all' });
    expect(res.status).toBe(201);
  });

  it('400 quota_exceeded at 50 pending rows (only pending counts)', async () => {
    expect(MAX_PENDING_PER_PUBKEY).toBe(50);
    const db = fakeD1();
    for (let i = 0; i < 49; i++) seedRow(db);
    // Non-pending rows must NOT count toward the quota.
    seedRow(db, { status: 'sent' });
    seedRow(db, { status: 'cancelled' });
    const first = await post(db, { event: futureEvent({ content: 'fits' }), relay_mode: 'all' });
    expect(first.res.status).toBe(201);

    const { res, data } = await post(db, { event: futureEvent({ content: 'over' }), relay_mode: 'all' });
    expect(res.status).toBe(400);
    expect(data.error).toBe('quota_exceeded');
  });

  it('429 rate_limited at 30 creates in the rolling hour, counted by row created_at', async () => {
    expect(MAX_CREATES_PER_HOUR).toBe(30);
    const db = fakeD1();
    // Rows created 30 min ago count; publish_at is irrelevant to the
    // window. Status is irrelevant too — mix them.
    for (let i = 0; i < 29; i++) {
      seedRow(db, { created_at: nowSec() - 1800, status: 'sent' });
    }
    // The 30th create inside the window still fits…
    expect((await post(db, { event: futureEvent({ content: '30th' }), relay_mode: 'all' })).res.status).toBe(201);
    db.rows.length = 0;
    for (let i = 0; i < 30; i++) {
      seedRow(db, {
        created_at: nowSec() - 1800,
        status: i % 2 === 0 ? 'sent' : 'pending',
        publish_at: nowSec() + 86400 * (i + 1)
      });
    }
    const { res, data } = await post(db, { event: futureEvent(), relay_mode: 'all' });
    expect(res.status).toBe(429);
    expect(data.error).toBe('rate_limited');
  });

  it('429 on the cancel-and-recreate bypass: schedule 30, cancel all 30, the 31st create still rate-limits', async () => {
    const db = fakeD1();
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const { res, data } = await post(db, {
        event: futureEvent({ content: `post ${i}` }),
        relay_mode: 'all'
      });
      expect(res.status).toBe(201);
      ids.push(data.id);
    }
    for (const id of ids) {
      const { res } = await cancel(db, id);
      expect(res.status).toBe(200);
    }
    // All 30 rows are cancelled — but they were created inside the
    // window, so the 31st create must still be rejected.
    const { res, data } = await post(db, { event: futureEvent({ content: 'post 31' }), relay_mode: 'all' });
    expect(res.status).toBe(429);
    expect(data.error).toBe('rate_limited');
  });
});

// ── POST: success + duplicate ───────────────────────────────────────

describe('POST /api/schedule — success path', () => {
  it('201 with { id, publish_at, relay_mode, status } and an encrypted pending row', async () => {
    const db = fakeD1();
    const event = futureEvent();
    const { res, data } = await post(db, { event, relay_mode: 'pantry' });

    expect(res.status).toBe(201);
    expect(data).toEqual({
      id: event.id,
      publish_at: event.created_at,
      relay_mode: 'pantry',
      relays: [],
      status: 'pending'
    });

    expect(db.rows).toHaveLength(1);
    const row = db.rows[0];
    expect(row.status).toBe('pending');
    expect(row.pubkey).toBe(PUBKEY);
    expect(row.publish_at).toBe(event.created_at);
    // Stored encrypted — and it round-trips back to the exact event.
    expect(row.ciphertext).not.toContain('hello from the future');
    const key = await importScheduleKey(ENC_KEY);
    expect(JSON.parse(await decryptScheduledEvent(key, row.ciphertext, row.iv))).toEqual(plain(event));
  });

  it('409 already_scheduled for a duplicate event id', async () => {
    const db = fakeD1();
    const event = futureEvent();
    expect((await post(db, { event, relay_mode: 'all' })).res.status).toBe(201);

    const { res, data } = await post(db, { event, relay_mode: 'all' });
    expect(res.status).toBe(409);
    expect(data).toEqual({ error: 'already_scheduled', status: 'pending' });
    expect(db.rows).toHaveLength(1);
  });

  it('409 already_scheduled carries the row’s CURRENT status, so a retry can tell it was sent', async () => {
    for (const status of ['publishing', 'sent', 'failed', 'cancelled']) {
      const db = fakeD1();
      const event = futureEvent({ content: `was ${status}` });
      expect((await post(db, { event, relay_mode: 'all' })).res.status).toBe(201);
      db.rows[0].status = status;

      const { res, data } = await post(db, { event, relay_mode: 'all' });
      expect(res.status).toBe(409);
      expect(data).toEqual({ error: 'already_scheduled', status });
    }
  });

  it('a retry of an event that took the last pending slot gets 409, not quota_exceeded', async () => {
    // The dropped-response case at the limit: the first attempt filled
    // the quota, so a retry checked against the quota first would be
    // told it is over a limit it filled itself.
    const db = fakeD1();
    for (let i = 0; i < MAX_PENDING_PER_PUBKEY - 1; i++) seedRow(db);
    const event = futureEvent({ content: 'the 50th' });
    expect((await post(db, { event, relay_mode: 'all' })).res.status).toBe(201);
    expect(db.rows.filter((r) => r.status === 'pending')).toHaveLength(MAX_PENDING_PER_PUBKEY);

    const retry = await post(db, { event, relay_mode: 'all' });
    expect(retry.res.status).toBe(409);
    expect(retry.data).toEqual({ error: 'already_scheduled', status: 'pending' });
    // A different event at the same limit is still refused.
    const other = await post(db, { event: futureEvent({ content: 'a 51st' }), relay_mode: 'all' });
    expect(other.data.error).toBe('quota_exceeded');
  });

  it('a retry of an event that took the last create of the hour gets 409, not rate_limited', async () => {
    const db = fakeD1();
    for (let i = 0; i < MAX_CREATES_PER_HOUR - 1; i++) {
      seedRow(db, { created_at: nowSec() - 1800, status: 'sent' });
    }
    const event = futureEvent({ content: 'the 30th this hour' });
    expect((await post(db, { event, relay_mode: 'all' })).res.status).toBe(201);

    const retry = await post(db, { event, relay_mode: 'all' });
    expect(retry.res.status).toBe(409);
    expect(retry.data).toEqual({ error: 'already_scheduled', status: 'pending' });
    const other = await post(db, { event: futureEvent({ content: 'a 31st' }), relay_mode: 'all' });
    expect(other.res.status).toBe(429);
  });

  it('409 from the insert race (lookup missed, UNIQUE hit) still reports a status', async () => {
    const db = fakeD1();
    const event = futureEvent();
    expect((await post(db, { event, relay_mode: 'all' })).res.status).toBe(201);
    // Hide the row from the FIRST status lookup only, as if a
    // concurrent request inserted it between lookup and insert.
    const origPrepare = db.prepare.bind(db);
    let lookups = 0;
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (!sql.startsWith('SELECT status')) return stmt;
      return {
        bind(...args: any[]) {
          const bound = stmt.bind(...args);
          return { ...bound, first: async () => (++lookups === 1 ? null : bound.first()) };
        }
      };
    };
    const { res, data } = await post(db, { event, relay_mode: 'all' });
    expect(res.status).toBe(409);
    expect(data).toEqual({ error: 'already_scheduled', status: 'pending' });
    expect(lookups).toBe(2);
  });

  it('500 not_configured without the D1 binding / enc key', async () => {
    const { res } = await post(null, { event: futureEvent(), relay_mode: 'all' });
    expect(res.status).toBe(500);
  });
});

// ── POST: kinds ──────────────────────────────────────────────────────

describe('POST /api/schedule — schedulable kinds', () => {
  it('the allowlist is exactly the kinds the three composers produce', () => {
    expect([...SCHEDULABLE_KINDS].sort((a, b) => a - b)).toEqual([1, 20, 21, 22, 1068, 1111, 6969, 30023]);
  });

  // A `for` loop, not it.each: the each helpers don't typecheck under this repo's svelte-check.
  for (const [kind, name] of [
    [1111, 'NIP-22 comment'],
    [20, 'NIP-68 picture'],
    [21, 'NIP-71 horizontal video'],
    [22, 'NIP-71 vertical video']
  ] as const) {
    it(`201 for kind ${kind} (${name}) in 'all' mode`, async () => {
      const db = fakeD1();
      const { res, data } = await post(db, { event: futureEvent({ kind }), relay_mode: 'all' });
      expect(res.status).toBe(201);
      expect(data.status).toBe('pending');
      expect(db.rows[0].kind).toBe(kind);
    });
  }

  it('400 bad_kind for 35000 (the retired premium-recipe kind) in either mode', async () => {
    for (const relay_mode of ['all', 'pantry']) {
      const db = fakeD1();
      const { res, data } = await post(db, { event: futureEvent({ kind: 35000 }), relay_mode });
      expect(res.status).toBe(400);
      expect(data.error).toBe('bad_kind');
      expect(db.rows).toHaveLength(0);
    }
  });

  it("pantry's set is a subset of the allowlist and is exactly pantry's open kinds that are schedulable", () => {
    expect([...PANTRY_SCHEDULABLE_KINDS].sort((a, b) => a - b)).toEqual([1, 1068, 6969, 30023]);
    for (const kind of PANTRY_SCHEDULABLE_KINDS) expect(SCHEDULABLE_KINDS).toContain(kind);
  });

  for (const kind of [1111, 20, 21, 22]) {
    it(`400 kind_not_allowed_for_relay_mode for kind ${kind} with relay_mode 'pantry', nothing stored`, async () => {
      const db = fakeD1();
      const { res, data } = await post(db, { event: futureEvent({ kind }), relay_mode: 'pantry' });
      expect(res.status).toBe(400);
      expect(data).toEqual({ error: 'kind_not_allowed_for_relay_mode' });
      expect(db.rows).toHaveLength(0);
    });
  }

  for (const kind of [1, 30023]) {
    it(`201 for kind ${kind} with relay_mode 'pantry'`, async () => {
      const { res } = await post(fakeD1(), { event: futureEvent({ kind }), relay_mode: 'pantry' });
      expect(res.status).toBe(201);
    });
  }

  it('a kind outside the allowlist is bad_kind even for pantry (bad_kind is checked first)', async () => {
    const { data } = await post(fakeD1(), { event: futureEvent({ kind: 7 }), relay_mode: 'pantry' });
    expect(data.error).toBe('bad_kind');
  });

  it('the minimum lead is still 2 minutes', () => {
    expect(MIN_LEAD_SECONDS).toBe(120);
  });
});

// ── POST: relays ─────────────────────────────────────────────────────

describe('POST /api/schedule — relays', () => {
  const FOUR = ['wss://a.example.com', 'wss://b.example.com', 'wss://c.example.com', 'wss://d.example.com'];

  async function postRelays(relays: unknown, relay_mode = 'all') {
    const db = fakeD1();
    const result = await post(db, { event: futureEvent(), relay_mode, relays });
    return { db, ...result };
  }

  it('omitted, null or empty: accepted, stored as NULL, returned as []', async () => {
    for (const body of [{}, { relays: null }, { relays: [] }]) {
      const db = fakeD1();
      const { res, data } = await post(db, { event: futureEvent(), relay_mode: 'all', ...body });
      expect(res.status).toBe(201);
      expect(data.relays).toEqual([]);
      expect(db.rows[0].relays).toBeNull();
    }
  });

  it('stores up to the cap of 4, in the order sent, and echoes them', async () => {
    expect(MAX_SCHEDULE_RELAYS).toBe(4);
    const { db, res, data } = await postRelays(FOUR);
    expect(res.status).toBe(201);
    expect(data.relays).toEqual(FOUR);
    expect(JSON.parse(db.rows[0].relays!)).toEqual(FOUR);
  });

  it('normalizes (case, default port, trailing slash) and folds duplicates before counting', async () => {
    const { db, res, data } = await postRelays([
      'wss://Relay.Example.com/',
      'WSS://relay.example.com:443',
      'wss://relay.example.com',
      'wss://b.example.com//',
      'wss://c.example.com:4443/inbox',
      'wss://d.example.com',
      'wss://D.example.com/'
    ]);
    expect(res.status).toBe(201);
    const expected = [
      'wss://relay.example.com',
      'wss://b.example.com',
      'wss://c.example.com:4443/inbox',
      'wss://d.example.com'
    ];
    expect(data.relays).toEqual(expected);
    expect(JSON.parse(db.rows[0].relays!)).toEqual(expected);
  });

  it('400 bad_relays for a fifth distinct relay, nothing stored', async () => {
    const { db, res, data } = await postRelays([...FOUR, 'wss://e.example.com']);
    expect(res.status).toBe(400);
    expect(data).toEqual({ error: 'bad_relays' });
    expect(db.rows).toHaveLength(0);
  });

  // A `for` loop, not it.each: the each helpers don't typecheck under this repo's svelte-check.
  const BAD_RELAYS: [string, unknown][] = [
    ['not an array (string)', 'wss://a.example.com'],
    ['not an array (object)', { 0: 'wss://a.example.com' }],
    ['a non-string entry', ['wss://a.example.com', 42]],
    ['a nested array entry', [['wss://a.example.com']]],
    ['ws:// (not TLS)', ['ws://a.example.com']],
    ['https://', ['https://a.example.com']],
    ['no scheme', ['a.example.com']],
    ['an IPv4 literal', ['wss://203.0.113.7']],
    ['a private IPv4 literal', ['wss://10.0.0.5:7777']],
    ['loopback', ['wss://127.0.0.1']],
    ['a decimal-integer IPv4', ['wss://2130706433']],
    ['a hex IPv4', ['wss://0x7f.0.0.1']],
    ['an IPv6 literal', ['wss://[::1]']],
    ['a private IPv6 literal', ['wss://[fd00::1]:443']],
    ['localhost', ['wss://localhost']],
    ['localhost with a port', ['wss://localhost:7777']],
    ['a .localhost name', ['wss://relay.localhost']],
    ['a .local name', ['wss://printer.local']],
    ['a .internal name', ['wss://db.internal']],
    ['a .lan name', ['wss://nas.lan']],
    ['a single-label host', ['wss://intranet']],
    ['a .onion host', ['wss://abc.onion']],
    ['credentials in the URL', ['wss://user:pass@a.example.com']],
    ['whitespace', ['wss://a.example.com/ path']],
    ['an empty string', ['']],
    ['200 characters', [`wss://a.example.com/${'p'.repeat(180)}`]],
    ['one bad entry among good ones', ['wss://a.example.com', 'wss://localhost', 'wss://b.example.com']]
  ];
  for (const [label, relays] of BAD_RELAYS) {
    it(`400 bad_relays for ${label}, nothing stored`, async () => {
      const { db, res, data } = await postRelays(relays);
      expect(res.status).toBe(400);
      expect(data).toEqual({ error: 'bad_relays' });
      expect(db.rows).toHaveLength(0);
    });
  }

  it('199 characters is accepted (the limit is "under 200")', async () => {
    const url = `wss://a.example.com/${'p'.repeat(179)}`;
    expect(url).toHaveLength(199);
    expect(`wss://a.example.com/${'p'.repeat(180)}`).toHaveLength(200);
    const { res } = await postRelays([url]);
    expect(res.status).toBe(201);
  });

  it("'pantry' mode ignores valid relays: accepted, stored NULL, returned []", async () => {
    const { db, res, data } = await postRelays(FOUR, 'pantry');
    expect(res.status).toBe(201);
    expect(data.relays).toEqual([]);
    expect(db.rows[0].relays).toBeNull();
  });

  it("'pantry' mode still refuses a malformed list rather than hiding it", async () => {
    const { res, data } = await postRelays(['wss://localhost'], 'pantry');
    expect(res.status).toBe(400);
    expect(data.error).toBe('bad_relays');
  });

  it('bad_relays is reported before the signature is even checked', async () => {
    const event = { ...futureEvent(), content: 'tampered after signing' };
    const { data } = await post(fakeD1(), { event, relay_mode: 'all', relays: ['wss://localhost'] });
    expect(data.error).toBe('bad_relays');
  });
});

// ── auth response shaping (all three endpoints) ─────────────────────

describe('auth failures collapse to coarse 401s', () => {
  function expectCoarse401(result: { res: Response; text: string; data: any }) {
    expect(result.res.status).toBe(401);
    expect(result.data.error).toBe('auth_failed');
    expect(typeof result.data.detail).toBe('string');
    for (const reason of GRANULAR_REASONS) {
      expect(result.text).not.toContain(reason);
    }
  }

  it('POST without an Authorization header', async () => {
    const result = await post(fakeD1(), { event: futureEvent(), relay_mode: 'all' }, { authHeader: null });
    expectCoarse401(result);
  });

  it('POST with a method-mismatched header never echoes the granular reason', async () => {
    const body = JSON.stringify({ event: futureEvent(), relay_mode: 'all' });
    const authHeader = await nip98Header({ url: ENDPOINT, method: 'POST', body, methodTag: 'GET' });
    expectCoarse401(await post(fakeD1(), null, { rawBody: body, authHeader }));
  });

  it('POST with the payload tag stripped never echoes the granular reason', async () => {
    const body = JSON.stringify({ event: futureEvent(), relay_mode: 'all' });
    const authHeader = await nip98Header({
      url: ENDPOINT,
      method: 'POST',
      body,
      omitPayloadTag: true
    });
    expectCoarse401(await post(fakeD1(), null, { rawBody: body, authHeader }));
  });

  it('POST with a stale auth event never echoes the granular reason', async () => {
    const body = JSON.stringify({ event: futureEvent(), relay_mode: 'all' });
    const tags: string[][] = [
      ['u', normalizeUrl(ENDPOINT)],
      ['method', 'POST'],
      ['payload', await sha256Hex(new TextEncoder().encode(body))]
    ];
    const stale = finalizeEvent(
      { kind: 27235, created_at: nowSec() - 3600, tags, content: '' },
      sk
    );
    expectCoarse401(
      await post(fakeD1(), null, {
        rawBody: body,
        authHeader: `Nostr ${btoa(JSON.stringify(stale))}`
      })
    );
  });

  it('GET without an Authorization header', async () => {
    const request = new Request(ENDPOINT, { method: 'GET' });
    const res = await GET({ request, platform: platformFor(fakeD1()) } as any);
    expectCoarse401({ res, ...(await readJson(res)) });
  });

  it('DELETE without an Authorization header', async () => {
    const id = 'a'.repeat(64);
    const request = new Request(`${ENDPOINT}/${id}`, { method: 'DELETE' });
    const res = await DELETE({ request, params: { id }, platform: platformFor(fakeD1()) } as any);
    expectCoarse401({ res, ...(await readJson(res)) });
  });
});

// ── GET /api/schedule ───────────────────────────────────────────────

describe('GET /api/schedule', () => {
  it('returns only the caller’s rows, newest publish_at first, live statuses, decrypted', async () => {
    const db = fakeD1();
    const key = await importScheduleKey(ENC_KEY);

    const early = futureEvent({ content: 'early', created_at: nowSec() + 3600 });
    const late = futureEvent({ content: 'late', created_at: nowSec() + 7200 });
    await post(db, { event: early, relay_mode: 'all' });
    await post(db, { event: late, relay_mode: 'pantry' });

    // A sent row (seeded directly) and a foreign row that must not appear.
    const sentEvent = futureEvent({ content: 'already sent', created_at: nowSec() + 10800 });
    const enc = await encryptScheduledEvent(key, JSON.stringify(sentEvent));
    seedRow(db, {
      id: sentEvent.id,
      publish_at: sentEvent.created_at,
      status: 'sent',
      sent_at: nowSec() - 60,
      ciphertext: enc.ciphertext,
      iv: enc.iv
    });
    const foreign = await encryptScheduledEvent(key, JSON.stringify(futureEvent({}, otherSk)));
    seedRow(db, { pubkey: OTHER_PUBKEY, ciphertext: foreign.ciphertext, iv: foreign.iv });

    const { res, data } = await list(db);
    expect(res.status).toBe(200);
    expect(data.items).toHaveLength(3);
    expect(data.items.map((i: any) => i.id)).toEqual([sentEvent.id, late.id, early.id]);
    expect(data.items.map((i: any) => i.status)).toEqual(['sent', 'pending', 'pending']);
    expect(data.items[0].sent_at).not.toBeNull();
    expect(data.items[1].event).toEqual(plain(late));
    expect(data.items[2].event.content).toBe('early');
  });

  it('returns each row’s relays ([] when it has none)', async () => {
    const db = fakeD1();
    const withRelays = futureEvent({ content: 'with', created_at: nowSec() + 7200 });
    const without = futureEvent({ content: 'without', created_at: nowSec() + 3600 });
    await post(db, { event: withRelays, relay_mode: 'all', relays: ['wss://a.example.com/', 'wss://b.example.com'] });
    await post(db, { event: without, relay_mode: 'all' });

    const { data } = await list(db);
    expect(data.items.map((i: any) => i.relays)).toEqual([
      ['wss://a.example.com', 'wss://b.example.com'],
      []
    ]);
  });

  it('a damaged relays column reads as [] instead of failing the list', async () => {
    const db = fakeD1();
    await post(db, { event: futureEvent(), relay_mode: 'all' });
    db.rows[0].relays = '{not json';
    const { res, data } = await list(db);
    expect(res.status).toBe(200);
    expect(data.items[0].relays).toEqual([]);
  });

  describe('?status= filter', () => {
    async function seeded() {
      const db = fakeD1();
      const key = await importScheduleKey(ENC_KEY);
      const statuses = ['pending', 'pending', 'publishing', 'sent', 'failed', 'cancelled'];
      for (const [i, status] of statuses.entries()) {
        const event = futureEvent({ content: `${status} ${i}`, created_at: nowSec() + 3600 + i });
        const enc = await encryptScheduledEvent(key, JSON.stringify(event));
        seedRow(db, { id: event.id, publish_at: event.created_at, status, ...enc });
      }
      return db;
    }

    it('no filter: every status except cancelled', async () => {
      const { data } = await list(await seeded());
      expect(data.items).toHaveLength(5);
      expect(data.items.map((i: any) => i.status).sort()).toEqual([
        'failed',
        'pending',
        'pending',
        'publishing',
        'sent'
      ]);
      expect(data).not.toHaveProperty('truncated');
    });

    for (const [status, count] of [
      ['pending', 2],
      ['publishing', 1],
      ['sent', 1],
      ['failed', 1],
      ['cancelled', 1]
    ] as const) {
      it(`?status=${status} returns only those rows, newest publish_at first`, async () => {
        const { res, data } = await list(await seeded(), { query: `?status=${status}` });
        expect(res.status).toBe(200);
        expect(data.items).toHaveLength(count);
        expect(data.items.every((i: any) => i.status === status)).toBe(true);
        const times = data.items.map((i: any) => i.publish_at);
        expect(times).toEqual([...times].sort((a, b) => b - a));
      });
    }

    it('400 bad_status for an unknown or empty status', async () => {
      for (const query of ['?status=done', '?status=', '?status=PENDING', '?status=pending,sent']) {
        const { res, data } = await list(await seeded(), { query });
        expect(res.status).toBe(400);
        expect(data).toEqual({ error: 'bad_status' });
      }
    });

    it('the filter never widens past the caller: someone else’s pending rows stay out', async () => {
      const db = await seeded();
      seedRow(db, { pubkey: OTHER_PUBKEY, status: 'pending' });
      const { data } = await list(db, { query: '?status=pending' });
      expect(data.items).toHaveLength(2);
    });

    it('auth is still required with a filter', async () => {
      const request = new Request(`${ENDPOINT}?status=pending`, { method: 'GET' });
      const res = await GET({ request, platform: platformFor(await seeded()) } as any);
      expect(res.status).toBe(401);
    });
  });

  it('caps the list at 100 rows and says so with truncated: true', async () => {
    const db = fakeD1();
    const key = await importScheduleKey(ENC_KEY);
    const enc = await encryptScheduledEvent(key, JSON.stringify(futureEvent()));
    for (let i = 0; i < 100; i++) {
      seedRow(db, { publish_at: nowSec() + 3600 + i, ciphertext: enc.ciphertext, iv: enc.iv });
    }
    // Exactly at the cap: everything is there, so no flag.
    const full = await list(db);
    expect(full.data.items).toHaveLength(100);
    expect(full.data).not.toHaveProperty('truncated');

    seedRow(db, { publish_at: nowSec() + 3600 + 100, ciphertext: enc.ciphertext, iv: enc.iv });
    const cut = await list(db);
    expect(cut.data.items).toHaveLength(100);
    expect(cut.data.truncated).toBe(true);
    // The row dropped is the oldest publish time, never the newest.
    expect(cut.data.items[0].publish_at).toBe(nowSec() + 3600 + 100);

    const filtered = await list(db, { query: '?status=pending' });
    expect(filtered.data.items).toHaveLength(100);
    expect(filtered.data.truncated).toBe(true);
  });
});

// ── real SQLite: the list default and `replaces` ────────────────────
//
// These run the routes' own SQL against SQLite (node:sqlite, in memory)
// with the schema built from the migration files themselves, because
// what is under test IS the SQL: which rows the unfiltered list keeps,
// and that a replace is all-or-nothing. `batch` is one transaction, as
// D1's is.

const MIGRATIONS = [
  '0001_create_scheduled_events.sql',
  '0012_add_scheduled_event_relays.sql',
  '0013_add_scheduled_event_replaces.sql'
];

function sqliteD1() {
  const { DatabaseSync } = (process as any).getBuiltinModule('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  for (const file of MIGRATIONS) {
    sqlite.exec(readFileSync(`migrations/scheduler/${file}`, 'utf8'));
  }
  const statement = (sql: string, args: any[] = []) => ({
    bind: (...bound: any[]) => statement(sql, bound),
    async first() {
      const row = sqlite.prepare(sql).get(...args);
      return row ? { ...row } : null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...args).map((r: any) => ({ ...r })) };
    },
    async run() {
      return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } };
    }
  });
  const db = {
    /** Runs just before a batch executes: stands in for the sweep winning a race. */
    beforeBatch: null as null | (() => void),
    prepare: (sql: string) => statement(sql),
    async batch(statements: { run(): Promise<{ meta: { changes: number } }> }[]) {
      db.beforeBatch?.();
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    row(id: string): (Row & { replaces: string | null }) | undefined {
      const row = sqlite.prepare('SELECT * FROM scheduled_events WHERE id = ?').get(id);
      return row ? { ...row } : undefined;
    },
    count(where = '1'): number {
      return Number(sqlite.prepare(`SELECT COUNT(*) AS c FROM scheduled_events WHERE ${where}`).get().c);
    },
    setStatus(id: string, status: string) {
      sqlite.prepare('UPDATE scheduled_events SET status = ? WHERE id = ?').run(status, id);
    },
    seed(overrides: Partial<Row> & { replaces?: string | null } = {}) {
      const now = nowSec();
      const r = {
        id: (++seedSeq).toString(16).padStart(64, '0'),
        pubkey: PUBKEY,
        kind: 1,
        publish_at: now + 3600,
        relay_mode: 'all',
        relays: null,
        ciphertext: 'unused',
        iv: 'unused',
        status: 'pending',
        created_at: now - 7200,
        replaces: null,
        ...overrides
      };
      sqlite
        .prepare(
          `INSERT INTO scheduled_events (id, pubkey, kind, publish_at, relay_mode, relays, ciphertext, iv, status, created_at, updated_at, sent_at, replaces)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(r.id, r.pubkey, r.kind, r.publish_at, r.relay_mode, r.relays, r.ciphertext, r.iv, r.status, r.created_at, r.created_at, r.sent_at ?? null, r.replaces);
      return r;
    }
  };
  return db;
}

/** The fake and the SQLite database are interchangeable to the routes. */
const asDb = (db: ReturnType<typeof sqliteD1>) => db as unknown as FakeDb;

describe('GET /api/schedule — the unfiltered list on real SQL', () => {
  it('a heavy rescheduler still sees every pending row: 50 pending + 70 cancelled', async () => {
    const db = sqliteD1();
    const key = await importScheduleKey(ENC_KEY);
    const enc = await encryptScheduledEvent(key, JSON.stringify(futureEvent()));
    for (let i = 0; i < 50; i++) {
      db.seed({ publish_at: nowSec() + (i + 1) * 86400, ...enc });
    }
    // Cancelled rows with later publish times than most pending ones:
    // the old query spent 70 of its 100 rows on these.
    for (let i = 0; i < 70; i++) {
      db.seed({ publish_at: nowSec() + (20 + i) * 86400 + 60, status: 'cancelled', ...enc });
    }

    const { res, data } = await list(asDb(db));
    expect(res.status).toBe(200);
    expect(data.items).toHaveLength(50);
    expect(data.items.every((i: any) => i.status === 'pending')).toBe(true);
    expect(data).not.toHaveProperty('truncated');
  });

  it('?status=cancelled still returns cancelled rows', async () => {
    const db = sqliteD1();
    const key = await importScheduleKey(ENC_KEY);
    const enc = await encryptScheduledEvent(key, JSON.stringify(futureEvent()));
    db.seed({ ...enc });
    db.seed({ status: 'cancelled', ...enc });
    db.seed({ status: 'cancelled', ...enc });

    const { data } = await list(asDb(db), { query: '?status=cancelled' });
    expect(data.items).toHaveLength(2);
    expect(data.items.every((i: any) => i.status === 'cancelled')).toBe(true);
  });

  it('truncated: true only when the cap cut the result, and pending rows are kept first', async () => {
    const db = sqliteD1();
    const key = await importScheduleKey(ENC_KEY);
    const enc = await encryptScheduledEvent(key, JSON.stringify(futureEvent()));
    for (let i = 0; i < 50; i++) db.seed({ publish_at: nowSec() + 3600 + i, ...enc });
    for (let i = 0; i < 60; i++) {
      db.seed({ publish_at: nowSec() - 86400 - i, status: 'sent', sent_at: nowSec() - 86400, ...enc });
    }
    const { data } = await list(asDb(db));
    expect(data.items).toHaveLength(100);
    expect(data.truncated).toBe(true);
    expect(data.items.filter((i: any) => i.status === 'pending')).toHaveLength(50);
  });
});

describe('POST /api/schedule — replaces', () => {
  const OLD_AT = () => nowSec() + 3600;

  /** A database holding one pending post of ours, scheduled through the API. */
  async function withPending(extra: Record<string, unknown> = {}) {
    const db = sqliteD1();
    const old = futureEvent({ content: 'the post', created_at: OLD_AT() });
    const first = await post(asDb(db), { event: old, relay_mode: 'all', ...extra });
    expect(first.res.status).toBe(201);
    return { db, old };
  }
  const moved = (content = 'the post') => futureEvent({ content, created_at: nowSec() + 2 * 86400 });

  it('201: the new event is pending, the old row is cancelled, and the response echoes `replaced`', async () => {
    const { db, old } = await withPending();
    const next = moved();
    const { res, data } = await post(asDb(db), { event: next, relay_mode: 'all', replaces: old.id });

    expect(res.status).toBe(201);
    expect(data).toEqual({
      id: next.id,
      publish_at: next.created_at,
      relay_mode: 'all',
      relays: [],
      status: 'pending',
      replaced: old.id
    });
    expect(db.row(old.id)?.status).toBe('cancelled');
    const row = db.row(next.id)!;
    expect(row.status).toBe('pending');
    expect(row.replaces).toBe(old.id);
    expect(row.publish_at).toBe(next.created_at);
    const key = await importScheduleKey(ENC_KEY);
    expect(JSON.parse(await decryptScheduledEvent(key, row.ciphertext, row.iv))).toEqual(plain(next));

    // The list shows one post, at its new time.
    const listed = await list(asDb(db));
    expect(listed.data.items.map((i: any) => i.id)).toEqual([next.id]);
  });

  it('a plain create has no `replaced` in its response and a NULL replaces column', async () => {
    const { db, old } = await withPending();
    expect(db.row(old.id)?.replaces).toBeNull();
    const { data } = await post(asDb(db), { event: moved('another'), relay_mode: 'all', replaces: null });
    expect(data).not.toHaveProperty('replaced');
  });

  it('stores the relay_mode and relays sent with the replacement', async () => {
    const { db, old } = await withPending({ relays: ['wss://a.example.com'] });
    const next = moved();
    const { data } = await post(asDb(db), {
      event: next,
      relay_mode: 'all',
      relays: ['wss://a.example.com', 'wss://b.example.com/'],
      replaces: old.id
    });
    expect(data.relays).toEqual(['wss://a.example.com', 'wss://b.example.com']);
    expect(JSON.parse(db.row(next.id)!.relays!)).toEqual(['wss://a.example.com', 'wss://b.example.com']);
  });

  it('works at the 50-pending cap, where a plain create is refused, and leaves 50 pending', async () => {
    const { db, old } = await withPending();
    for (let i = 0; i < MAX_PENDING_PER_PUBKEY - 1; i++) db.seed();
    expect(db.count("status = 'pending'")).toBe(MAX_PENDING_PER_PUBKEY);

    const refused = await post(asDb(db), { event: moved('new'), relay_mode: 'all' });
    expect(refused.data).toEqual({ error: 'quota_exceeded' });

    const { res } = await post(asDb(db), { event: moved(), relay_mode: 'all', replaces: old.id });
    expect(res.status).toBe(201);
    expect(db.count("status = 'pending'")).toBe(MAX_PENDING_PER_PUBKEY);
  });

  it('is not refused by the creates-per-hour cap, and does not spend a create', async () => {
    const { db, old } = await withPending();
    // 28 more plain creates this hour: 29 with the one above.
    for (let i = 0; i < MAX_CREATES_PER_HOUR - 2; i++) db.seed({ status: 'cancelled', created_at: nowSec() - 60 });

    const first = await post(asDb(db), { event: moved('moved once'), relay_mode: 'all', replaces: old.id });
    expect(first.res.status).toBe(201);
    const again = moved('moved twice');
    const second = await post(asDb(db), { event: again, relay_mode: 'all', replaces: first.data.id });
    expect(second.res.status).toBe(201);

    // Still 29 plain creates: the 30th is allowed, the 31st is not.
    const thirtieth = await post(asDb(db), { event: moved('create 30'), relay_mode: 'all' });
    expect(thirtieth.res.status).toBe(201);
    const thirtyFirst = await post(asDb(db), { event: moved('create 31'), relay_mode: 'all' });
    expect(thirtyFirst.res.status).toBe(429);
    expect(thirtyFirst.data).toEqual({ error: 'rate_limited' });

    // …and with creates exhausted, a move still goes through.
    const third = await post(asDb(db), { event: moved('moved thrice'), relay_mode: 'all', replaces: again.id });
    expect(third.res.status).toBe(201);
  });

  it('429 rate_limited (limit: moves) at 60 replaces in the rolling hour, nothing changed', async () => {
    const { db, old } = await withPending();
    for (let i = 0; i < MAX_MOVES_PER_HOUR; i++) {
      db.seed({ status: 'cancelled', created_at: nowSec() - 60, replaces: 'f'.repeat(64) });
    }
    const next = moved();
    const { res, data } = await post(asDb(db), { event: next, relay_mode: 'all', replaces: old.id });
    expect(res.status).toBe(429);
    expect(data).toEqual({ error: 'rate_limited', limit: 'moves' });
    expect(db.row(old.id)?.status).toBe('pending');
    expect(db.row(next.id)).toBeUndefined();
  });

  it('replaces older than an hour no longer count', async () => {
    const { db, old } = await withPending();
    for (let i = 0; i < MAX_MOVES_PER_HOUR; i++) {
      db.seed({ status: 'cancelled', created_at: nowSec() - 3700, replaces: 'f'.repeat(64) });
    }
    const { res } = await post(asDb(db), { event: moved(), relay_mode: 'all', replaces: old.id });
    expect(res.status).toBe(201);
  });

  for (const status of ['publishing', 'sent', 'failed', 'cancelled']) {
    it(`409 not_replaceable with status "${status}" when the old row is no longer pending, nothing stored`, async () => {
      const { db, old } = await withPending();
      db.setStatus(old.id, status);
      const next = moved();
      const { res, data } = await post(asDb(db), { event: next, relay_mode: 'all', replaces: old.id });
      expect(res.status).toBe(409);
      expect(data).toEqual({ error: 'not_replaceable', status });
      expect(db.row(next.id)).toBeUndefined();
      expect(db.row(old.id)?.status).toBe(status);
    });
  }

  it('the sweep claims the old row between the lookup and the swap: 409, the post is not doubled', async () => {
    const { db, old } = await withPending();
    db.beforeBatch = () => db.setStatus(old.id, 'publishing');
    const next = moved();
    const { res, data } = await post(asDb(db), { event: next, relay_mode: 'all', replaces: old.id });
    expect(res.status).toBe(409);
    expect(data).toEqual({ error: 'not_replaceable', status: 'publishing' });
    expect(db.row(next.id)).toBeUndefined();
    expect(db.row(old.id)?.status).toBe('publishing');
    expect(db.count()).toBe(1);
  });

  it('a missing old row and someone else’s row are byte-identical 404s, nothing stored', async () => {
    const { db } = await withPending();
    const foreign = db.seed({ pubkey: OTHER_PUBKEY });
    const a = moved('a');
    const b = moved('b');
    const missing = await post(asDb(db), { event: a, relay_mode: 'all', replaces: 'e'.repeat(64) });
    const theirs = await post(asDb(db), { event: b, relay_mode: 'all', replaces: foreign.id });
    expect(missing.res.status).toBe(404);
    expect(theirs.res.status).toBe(404);
    expect(missing.text).toBe(theirs.text);
    expect(missing.data).toEqual({ error: 'not_found' });
    expect(db.row(a.id)).toBeUndefined();
    expect(db.row(b.id)).toBeUndefined();
    expect(db.row(foreign.id)?.status).toBe('pending');
  });

  it('400 bad_request for a `replaces` that is not an event id', async () => {
    const { db, old } = await withPending();
    for (const replaces of ['', 'abc', old.id.toUpperCase(), 123, [old.id], { id: old.id }]) {
      const { res, data } = await post(asDb(db), { event: moved(), relay_mode: 'all', replaces });
      expect(res.status).toBe(400);
      expect(data).toEqual({ error: 'bad_request' });
    }
    expect(db.row(old.id)?.status).toBe('pending');
    expect(db.count()).toBe(1);
  });

  it('the replacement is validated like any create, and a refused one leaves the old row alone', async () => {
    const { db, old } = await withPending();
    const tooSoon = futureEvent({ created_at: nowSec() + 30 });
    const { data } = await post(asDb(db), { event: tooSoon, relay_mode: 'all', replaces: old.id });
    expect(data).toEqual({ error: 'bad_publish_time' });
    const foreignEvent = futureEvent({}, otherSk);
    const mismatch = await post(asDb(db), { event: foreignEvent, relay_mode: 'all', replaces: old.id });
    expect(mismatch.data).toEqual({ error: 'pubkey_mismatch' });
    expect(db.row(old.id)?.status).toBe('pending');
    expect(db.count()).toBe(1);
  });

  it('a retry after a lost response gets 409 already_scheduled with `replaced`, and changes nothing', async () => {
    const { db, old } = await withPending();
    const next = moved();
    await post(asDb(db), { event: next, relay_mode: 'all', replaces: old.id });
    const retry = await post(asDb(db), { event: next, relay_mode: 'all', replaces: old.id });
    expect(retry.res.status).toBe(409);
    expect(retry.data).toEqual({ error: 'already_scheduled', status: 'pending', replaced: old.id });
    expect(db.count()).toBe(2);
    expect(db.row(old.id)?.status).toBe('cancelled');
  });

  it('auth is checked first: no header, nothing looked up', async () => {
    const { db, old } = await withPending();
    const { res } = await post(asDb(db), { event: moved(), relay_mode: 'all', replaces: old.id }, { authHeader: null });
    expect(res.status).toBe(401);
    expect(db.row(old.id)?.status).toBe('pending');
  });
});

// ── DELETE /api/schedule/[id] ───────────────────────────────────────

describe('DELETE /api/schedule/[id]', () => {
  it('cancels a pending row', async () => {
    const db = fakeD1();
    const event = futureEvent();
    await post(db, { event, relay_mode: 'all' });

    const { res, data } = await cancel(db, event.id);
    expect(res.status).toBe(200);
    expect(data).toEqual({ id: event.id, status: 'cancelled' });
    expect(db.rows[0].status).toBe('cancelled');
  });

  it('409 not_cancellable (with the current status) for a non-pending row', async () => {
    const db = fakeD1();
    const row = seedRow(db, { status: 'sent' });
    const { res, data } = await cancel(db, row.id);
    expect(res.status).toBe(409);
    expect(data).toEqual({ error: 'not_cancellable', status: 'sent' });
    expect(db.rows[0].status).toBe('sent');
  });

  it('missing row and someone else’s row return byte-identical 404s', async () => {
    const db = fakeD1();
    const foreignRow = seedRow(db, { pubkey: OTHER_PUBKEY });

    const missing = await cancel(db, 'f'.repeat(64));
    const foreign = await cancel(db, foreignRow.id);

    expect(missing.res.status).toBe(404);
    expect(foreign.res.status).toBe(404);
    // Byte-identical bodies — a caller can't distinguish "doesn't
    // exist" from "exists but isn't yours" (no existence oracle).
    expect(foreign.text).toBe(missing.text);
    // And the foreign row was not touched.
    expect(db.rows[0].status).toBe('pending');
  });
});
