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
import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '$lib/nip98';
import { POLL_ENDS_AT_TAG, ZAP_POLL_CLOSED_AT_TAG } from '$lib/polls';
import {
  importScheduleKey,
  encryptScheduledEvent,
  decryptScheduledEvent
} from '$lib/scheduleCrypto.server';
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
                const results = rows
                  .filter((r) => r.pubkey === args[0])
                  .sort((a, b) => b.publish_at - a.publish_at || b.created_at - a.created_at)
                  .slice(0, args[1])
                  .map((r) => ({
                    id: r.id,
                    publish_at: r.publish_at,
                    relay_mode: r.relay_mode,
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
                const [id, pubkey, kind, publish_at, relay_mode, ciphertext, iv, now] = args;
                if (rows.some((r) => r.id === id)) {
                  throw new Error('UNIQUE constraint failed: scheduled_events.id');
                }
                rows.push({
                  id,
                  pubkey,
                  kind,
                  publish_at,
                  relay_mode,
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

async function list(db: FakeDb | null, opts: { secretKey?: Uint8Array } = {}) {
  const headers = new Headers({
    Authorization: await nip98Header({ url: ENDPOINT, method: 'GET', secretKey: opts.secretKey })
  });
  const request = new Request(ENDPOINT, { method: 'GET', headers });
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

  it('400 quota_exceeded at 25 pending rows (only pending counts)', async () => {
    const db = fakeD1();
    for (let i = 0; i < 24; i++) seedRow(db);
    // Non-pending rows must NOT count toward the quota.
    seedRow(db, { status: 'sent' });
    seedRow(db, { status: 'cancelled' });
    const first = await post(db, { event: futureEvent({ content: 'fits' }), relay_mode: 'all' });
    expect(first.res.status).toBe(201);

    const { res, data } = await post(db, { event: futureEvent({ content: 'over' }), relay_mode: 'all' });
    expect(res.status).toBe(400);
    expect(data.error).toBe('quota_exceeded');
  });

  it('429 rate_limited at 10 creates in the rolling hour, counted by row created_at', async () => {
    const db = fakeD1();
    // Rows created 30 min ago count; publish_at is irrelevant to the
    // window. Status is irrelevant too — mix them.
    for (let i = 0; i < 10; i++) {
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

  it('429 on the cancel-and-recreate bypass: schedule 10, cancel all 10, the 11th create still rate-limits', async () => {
    const db = fakeD1();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
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
    // All 10 rows are cancelled — but they were created inside the
    // window, so the 11th create must still be rejected.
    const { res, data } = await post(db, { event: futureEvent({ content: 'post 11' }), relay_mode: 'all' });
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
    expect(data.error).toBe('already_scheduled');
    expect(db.rows).toHaveLength(1);
  });

  it('500 not_configured without the D1 binding / enc key', async () => {
    const { res } = await post(null, { event: futureEvent(), relay_mode: 'all' });
    expect(res.status).toBe(500);
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
  it('returns only the caller’s rows, newest publish_at first, all statuses, decrypted', async () => {
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

  it('caps the list at 100 rows', async () => {
    const db = fakeD1();
    const key = await importScheduleKey(ENC_KEY);
    const enc = await encryptScheduledEvent(key, JSON.stringify(futureEvent()));
    for (let i = 0; i < 101; i++) {
      seedRow(db, { publish_at: nowSec() + 3600 + i, ciphertext: enc.ciphertext, iv: enc.iv });
    }
    const { data } = await list(db);
    expect(data.items).toHaveLength(100);
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
