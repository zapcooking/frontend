/**
 * POST /api/live/<id>/report: stored, held and alerted (DM publisher
 * stubbed). Nothing is ended automatically.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createLiveDatabase } from '../../../../../test/liveDatabase';
import { createKvFake } from '../../../../../test/liveStreamStub';

const mocks = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('$lib/rawPublish', () => ({ publishEventRaw: mocks.publish }));

import { POST as report } from './+server';

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
    NOTIFICATION_PRIVATE_KEY: bytesToHex(generateSecretKey())
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
