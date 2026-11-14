/**
 * A Go live report through the report endpoint: it is queued like any
 * report, puts the session on a report hold, and DMs the admin (the DM
 * publisher is stubbed). A child-safety report is never throttled.
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
const COMMENTER = 'c'.repeat(64);
const COMMENT_ID = '1'.repeat(64);
const SESSION = 'ab'.repeat(16);

let db: ReturnType<typeof createLiveDatabase>;
let kv: ReturnType<typeof createKvFake>;
let waited: Promise<unknown>[];
let ip = 0;

function post(body: unknown, opts: { ctx?: boolean } = {}) {
  ip++;
  const platform: any = {
    env: {
      SCHEDULER_DB: db,
      GATED_CONTENT: kv,
      NOTIFICATION_PRIVATE_KEY: bytesToHex(generateSecretKey())
    }
  };
  if (opts.ctx) platform.ctx = { waitUntil: (p: Promise<unknown>) => waited.push(p) };
  return report({
    request: new Request('https://zap.cooking/api/reads/moderation/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    platform,
    // A fresh address per call keeps the per-IP report limit out of the way.
    getClientAddress: () => `10.0.0.${ip}`
  } as never);
}

const holdOf = () =>
  db.raw.prepare('SELECT report_hold_at FROM live_sessions WHERE id = ?').get(SESSION)
    ?.report_hold_at;

beforeEach(() => {
  db = createLiveDatabase();
  kv = createKvFake();
  waited = [];
  mocks.publish.mockReset().mockResolvedValue(2);
  db.raw
    .prepare(
      "INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at) VALUES (?, ?, 'Pizza Beans', 'h', 'live', 1)"
    )
    .run(SESSION, HOST);
  for (const level of ['info', 'warn', 'error'] as const)
    vi.spyOn(console, level).mockImplementation(() => {});
});

describe('Go live report', () => {
  it('holds the session and DMs the admin', async () => {
    const res = await post({ pubkey: HOST, liveSession: SESSION, reason: 'nsfw' });
    expect(res.status).toBe(200);
    expect(typeof holdOf()).toBe('number');
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expect(mocks.publish.mock.calls[0][0].kind).toBe(4);
  });

  it('sends the DM in the background when the runtime offers waitUntil', async () => {
    await post({ pubkey: HOST, liveSession: SESSION, reason: 'spam' }, { ctx: true });
    expect(waited).toHaveLength(1);
    await Promise.all(waited);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it('holds on a comment report too, and keeps the first report time', async () => {
    db.raw.prepare('UPDATE live_sessions SET report_hold_at = 5 WHERE id = ?').run(SESSION);
    await post({
      eventId: COMMENT_ID,
      pubkey: COMMENTER,
      liveSession: SESSION,
      reason: 'other'
    });
    expect(holdOf()).toBe(5);
  });

  it('throttles a second alert for the same session, but never a child-safety one', async () => {
    await post({ pubkey: HOST, liveSession: SESSION, reason: 'nsfw' });
    await post({ pubkey: HOST, liveSession: SESSION, reason: 'spam' });
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    await post({ pubkey: HOST, liveSession: SESSION, reason: 'child_safety' });
    await post({ pubkey: HOST, liveSession: SESSION, reason: 'child_safety' });
    expect(mocks.publish).toHaveBeenCalledTimes(3);
  });

  it('does nothing for an unknown session, and refuses a malformed id', async () => {
    expect((await post({ pubkey: HOST, liveSession: 'cd'.repeat(16), reason: 'nsfw' })).status).toBe(
      200
    );
    expect(mocks.publish).not.toHaveBeenCalled();
    expect((await post({ pubkey: HOST, liveSession: 'nope', reason: 'nsfw' })).status).toBe(400);
    expect(holdOf()).toBeNull();
  });

  it('keeps two streams by the same host as two reports', async () => {
    const other = 'cd'.repeat(16);
    db.raw
      .prepare(
        "INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at) VALUES (?, ?, 'Other', '', 'ended', 1)"
      )
      .run(other, HOST);
    const a = await (await post({ pubkey: HOST, liveSession: SESSION, reason: 'nsfw' })).json();
    const b = await (await post({ pubkey: HOST, liveSession: other, reason: 'nsfw' })).json();
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(false);
  });

  it('leaves a report without a live session alone (Reads, Plated)', async () => {
    const res = await post({ pubkey: HOST, reason: 'nsfw' });
    expect(res.status).toBe(200);
    expect(holdOf()).toBeNull();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
