/**
 * POST /api/live/<id>/report: stored, held and alerted (DM publisher
 * stubbed). Nothing is ended automatically.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, nip04 } from 'nostr-tools';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createLiveDatabase } from '../../../../../test/liveDatabase';
import { createKvFake } from '../../../../../test/liveStreamStub';

const mocks = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('$lib/rawPublish', () => ({ publishEventRaw: mocks.publish }));

import { POST as report } from './+server';
import { keyedReporterHash } from '$lib/live/safety.server';

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const HOST = 'a'.repeat(64);
const SESSION = 'ab'.repeat(16);
const COMMENT = { id: '1'.repeat(64), pubkey: 'c'.repeat(64) };

let db: ReturnType<typeof createLiveDatabase>;
let kv: ReturnType<typeof createKvFake>;
let env: Record<string, unknown>;
let ip = 0;
let waited: Promise<unknown>[];

function post(body: unknown, opts: { id?: string; ip?: string; ctx?: boolean } = {}) {
  const platform: any = { env };
  if (opts.ctx) platform.ctx = { waitUntil: (p: Promise<unknown>) => waited.push(p) };
  const id = opts.id ?? SESSION;
  const address = opts.ip ?? `10.0.0.${++ip}`;
  return report({
    request: new Request(`https://zap.cooking/api/live/${id}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }),
    params: { id },
    platform,
    getClientAddress: () => address
  } as never);
}

const count = (table: string) => db.raw.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
const statusOf = () =>
  db.raw.prepare('SELECT status FROM live_sessions WHERE id = ?').get(SESSION).status;

beforeEach(() => {
  db = createLiveDatabase();
  kv = createKvFake();
  waited = [];
  env = {
    SCHEDULER_DB: db,
    GATED_CONTENT: kv,
    NOTIFICATION_PRIVATE_KEY: bytesToHex(generateSecretKey()),
    LIVE_REPORTER_HASH_SECRET: 'reporter-secret-for-tests'
  };
  mocks.publish.mockReset().mockResolvedValue(2);
  db.raw
    .prepare(
      "INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at, cf_input_uid) VALUES (?, ?, 'Pizza Beans', 'h', 'live', 1, NULL)"
    )
    .run(SESSION, HOST);
  for (const level of ['info', 'warn', 'error', 'log'] as const)
    vi.spyOn(console, level).mockImplementation(() => {});
});

describe('POST /api/live/<id>/report', () => {
  it('stores a stream report, opens the hold and DMs the admin', async () => {
    const res = await post({ reason: 'nudity', details: '  look at 2:10  ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false });
    const row = db.raw.prepare('SELECT * FROM live_reports').get();
    expect(row).toMatchObject({ session_id: SESSION, reason: 'nudity', details: 'look at 2:10', comment_id: null });
    expect(row.reporter_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('10.0.0.');
    expect(count('live_holds')).toBe(1);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it('stores HMAC(secret, limiter hash), never the limiter hash itself', async () => {
    await post({ reason: 'nudity' }, { ip: '10.7.7.7' });
    const stored = db.raw.prepare('SELECT reporter_hash FROM live_reports').get().reporter_hash;
    const day = new Date().toISOString().slice(0, 10);
    const salt = kv.data.get(`config:ip-salt-v2:${day}`)!;
    const limiterHash = await sha256(`10.7.7.7:${salt}`);
    expect(stored).not.toBe(limiterHash);
    expect(stored).toBe(await keyedReporterHash('reporter-secret-for-tests', limiterHash));
    // Another secret gives another id.
    expect(await keyedReporterHash('other-secret', limiterHash)).not.toBe(stored);
  });

  it('without the secret: stores nothing, still DMs the admin (unthrottled), logs it, asks to email support', async () => {
    env.LIVE_REPORTER_HASH_SECRET = undefined;
    // NIP-04 is symmetric: the sender's key and the admin's pubkey read the DM.
    const senderSk = generateSecretKey();
    env.NOTIFICATION_PRIVATE_KEY = bytesToHex(senderSk);

    const res = await post({ reason: 'child_safety', details: 'reporter note' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_stored' });
    expect(count('live_reports')).toBe(0);
    expect(count('live_holds')).toBe(0);
    expect(console.error).toHaveBeenCalledWith(
      '[Live] report NOT stored: LIVE_REPORTER_HASH_SECRET is not set'
    );

    expect(mocks.publish).toHaveBeenCalledTimes(1);
    const event = mocks.publish.mock.calls[0][0];
    const text = nip04.decrypt(senderSk, ADMIN_PUBKEY, event.content);
    expect(text).toMatch(/^⚠️ NOT STORED/);
    expect(text).toContain('CHILD SAFETY');
    expect(text).toContain(`/live/s/${SESSION}`);
    // Nothing about the reporter: not their note, not an address.
    expect(text).not.toContain('reporter note');
    expect(text).not.toMatch(/10\.0\.0\./);

    // Never throttled: every report still reaches the admin, urgent or not.
    for (const value of ['', '   ']) {
      env.LIVE_REPORTER_HASH_SECRET = value;
      expect((await post({ reason: 'spam' })).status).toBe(503);
    }
    expect(mocks.publish).toHaveBeenCalledTimes(3);
    expect(count('live_reports')).toBe(0);
  });

  it('without the secret, an unknown session is still 404 and sends nothing', async () => {
    env.LIVE_REPORTER_HASH_SECRET = undefined;
    expect((await post({ reason: 'child_safety' }, { id: 'f'.repeat(32) })).status).toBe(404);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('without KV (no limiter hash) stores a one-off unverified id, never a guessable one', async () => {
    env.GATED_CONTENT = undefined;
    await post({ reason: 'spam' }, { ip: '10.8.8.8' });
    await post({ reason: 'spam' }, { ip: '10.8.8.8' });
    const ids = db.raw.prepare('SELECT reporter_hash FROM live_reports').all();
    expect(ids).toHaveLength(2);
    for (const r of ids) expect(r.reporter_hash).toMatch(/^unverified:/);
  });

  it('on preview, uses preview throttle and rate-limit keys only', async () => {
    env.LIVE_INPUT_PREFIX = 'zc-live-preview-';
    await post({ reason: 'nudity' });
    const keys = [...kv.data.keys()];
    expect(keys).toContain(`live:preview:alert:${SESSION}`);
    expect(keys).not.toContain(`live:alert:${SESSION}`);
    expect(keys.some((k) => k.startsWith('rl:live-preview-report:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('rl:live-report:'))).toBe(false);
    // A production throttle does not hold back a preview alert.
    env.LIVE_INPUT_PREFIX = undefined;
    kv.data.delete(`live:preview:alert:${SESSION}`);
    kv.data.set(`live:alert:${SESSION}`, '1');
    env.LIVE_INPUT_PREFIX = 'zc-live-preview-';
    await post({ reason: 'spam' });
    expect(mocks.publish).toHaveBeenCalledTimes(2);
  });

  it('stores a comment report against that comment', async () => {
    await post({ reason: 'spam', comment: COMMENT });
    expect(db.raw.prepare('SELECT comment_id, comment_pubkey FROM live_reports').get()).toEqual({
      comment_id: COMMENT.id,
      comment_pubkey: COMMENT.pubkey
    });
  });

  it('sends the DM in the background when the runtime offers waitUntil', async () => {
    await post({ reason: 'spam' }, { ctx: true });
    expect(waited).toHaveLength(1);
    await Promise.all(waited);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it('a repeat from the same reporter is a duplicate and sends nothing', async () => {
    await post({ reason: 'nudity' }, { ip: '10.9.9.9' });
    const again = await post({ reason: 'spam' }, { ip: '10.9.9.9' });
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(count('live_reports')).toBe(1);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it('throttles alerts per session, except child safety and violence', async () => {
    await post({ reason: 'nudity' });
    await post({ reason: 'spam' });
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    await post({ reason: 'child_safety' });
    await post({ reason: 'violence' });
    expect(mocks.publish).toHaveBeenCalledTimes(3);
  });

  it('refuses bad input and unknown sessions', async () => {
    for (const body of [
      { reason: 'nsfw' },
      { reason: 'other', details: 5 },
      { reason: 'other', details: 'x'.repeat(301) },
      { reason: 'other', comment: { id: 'nope', pubkey: COMMENT.pubkey } },
      'not json',
      '[]'
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect((await post({ reason: 'other' }, { id: 'nope' })).status).toBe(400);
    expect((await post({ reason: 'other' }, { id: 'f'.repeat(32) })).status).toBe(404);
    expect((await post('x'.repeat(3000))).status).toBe(413);
    expect(count('live_reports')).toBe(0);
  });

  it('rate limits per address', async () => {
    let last = 0;
    for (let i = 0; i < 9; i++) {
      last = (await post({ reason: 'other', comment: { ...COMMENT, id: String(i).repeat(64) } }, { ip: '10.1.1.1' })).status;
    }
    expect(last).toBe(429);
  });

  it('never ends a stream by itself, however many report it', async () => {
    for (let i = 0; i < 5; i++) await post({ reason: 'nudity' });
    expect(statusOf()).toBe('live');
    expect(count('live_actions')).toBe(0);
  });
});
