/**
 * Staged rollout: GET /api/live/hosting (signed: about the signer only)
 * and POST /api/live/hosting (Request access: saved queue + admin DM).
 * NIP-98 is real; the membership lookup and the DM publisher are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip04,
  type EventTemplate
} from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { normalizeUrl, sha256Hex } from '$lib/nip98';
import { ADMIN_PUBKEY, ADMIN_PUBKEYS, BACKUP_ADMIN_PUBKEY } from '$lib/adminAuth';
// One DM per admin (primary and backup) for every alert.
const DMS = ADMIN_PUBKEYS.length;
import { approveHosts, createLiveDatabase } from '../../../../test/liveDatabase';
import { createKvFake } from '../../../../test/liveStreamStub';

const mocks = vi.hoisted(() => ({ publish: vi.fn(), checkMembership: vi.fn() }));
vi.mock('$lib/rawPublish', () => ({ publishEventRaw: mocks.publish }));
vi.mock('$lib/membershipApi.server', () => ({ checkMembership: mocks.checkMembership }));

import { GET, POST } from './+server';

const URL_ = 'https://zap.cooking/api/live/hosting';
const memberSk = generateSecretKey();
const MEMBER = getPublicKey(memberSk);
const otherSk = generateSecretKey();
const senderSk = generateSecretKey();
const DAY = 86400;

let db: ReturnType<typeof createLiveDatabase>;
let kv: ReturnType<typeof createKvFake>;
let env: Record<string, unknown>;

async function nip98(method: 'GET' | 'POST', body: string | undefined, sk = memberSk, url = URL_) {
  const tags = [
    ['u', normalizeUrl(url)],
    ['method', method]
  ];
  if (body !== undefined) tags.push(['payload', await sha256Hex(new TextEncoder().encode(body))]);
  const template: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  };
  return `Nostr ${btoa(JSON.stringify(finalizeEvent(template, sk)))}`;
}

async function status(sk: Uint8Array | null = memberSk, url = URL_) {
  const headers: Record<string, string> = {};
  if (sk) headers.Authorization = await nip98('GET', undefined, sk, URL_);
  const res = await GET({ request: new Request(url, { headers }), platform: { env } } as any);
  return { res, data: await res.json() };
}

async function ask(profile: unknown = { note: 'Weeknight pasta, Tuesdays' }, sk = memberSk) {
  const body = JSON.stringify(profile);
  const res = await POST({
    request: new Request(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await nip98('POST', body, sk) },
      body
    }),
    platform: { env }
  } as any);
  return { res, data: await res.json() };
}

const requests = () =>
  db.raw.prepare('SELECT pubkey, note, status, decided_at FROM live_access_requests ORDER BY rowid').all();
/** The DM text of the nth alert, as the primary admin reads it. */
const dmText = (alert = 0) => {
  const toPrimary = mocks.publish.mock.calls
    .map((c: any) => (c as [any])[0])
    .filter((e: any) => e.tags[0][1] === ADMIN_PUBKEY);
  return nip04.decrypt(senderSk, ADMIN_PUBKEY, toPrimary[alert].content);
};

beforeEach(() => {
  db = createLiveDatabase();
  kv = createKvFake();
  env = {
    SCHEDULER_DB: db,
    GATED_CONTENT: kv,
    MEMBERSHIP_ENABLED: 'true',
    RELAY_API_SECRET: 'relay-secret',
    NOTIFICATION_PRIVATE_KEY: bytesToHex(senderSk)
  };
  mocks.publish.mockReset().mockResolvedValue(2);
  mocks.checkMembership.mockReset().mockResolvedValue({ state: 'active', found: true });
  for (const level of ['info', 'warn', 'error'] as const)
    vi.spyOn(console, level).mockImplementation(() => {});
});

describe('GET /api/live/hosting', () => {
  it('answers only about the signer', async () => {
    expect((await status()).data).toEqual({
      mode: 'approved',
      approved: false,
      request: { status: 'none', created_at: null, decided_at: null, retry_at: null }
    });
    approveHosts(db, MEMBER);
    expect((await status()).data.approved).toBe(true);
    // No way to ask about another account: a ?pubkey= is ignored and the
    // answer is about the signer (not approved).
    const other = await status(otherSk, `${URL_}?pubkey=${MEMBER}`);
    expect(other.res.status).toBe(200);
    expect(other.data.approved).toBe(false);
  });

  it('needs a signature', async () => {
    expect((await status(null)).res.status).toBe(401);
  });

  it("in 'members' mode everyone is approved (membership is checked at create)", async () => {
    kv.data.set('live:hosting_mode', 'members');
    expect((await status()).data).toMatchObject({ mode: 'members', approved: true });
  });

  it('shows the own pending request, and a decline with when to ask again', async () => {
    await ask();
    expect((await status()).data.request).toMatchObject({ status: 'pending', retry_at: null });
    const decidedAt = Math.floor(Date.now() / 1000);
    db.raw
      .prepare("UPDATE live_access_requests SET status = 'declined', decided_at = ?")
      .run(decidedAt);
    expect((await status()).data.request).toMatchObject({
      status: 'declined',
      retry_at: decidedAt + 30 * DAY
    });
  });

  it('never discloses a block', async () => {
    approveHosts(db, MEMBER);
    db.raw.prepare('INSERT INTO live_blocked_hosts (pubkey, created_at) VALUES (?, 1)').run(MEMBER);
    expect((await status()).data).toMatchObject({ approved: true });
    expect(JSON.stringify((await status()).data)).not.toContain('block');
  });
});

describe('POST /api/live/hosting (Request access)', () => {
  it('saves a pending request with the note and DMs the admin', async () => {
    const { res, data } = await ask();
    expect(res.status).toBe(200);
    expect(data).toEqual({ ok: true, status: 'pending' });
    expect(requests()).toEqual([
      { pubkey: MEMBER, note: 'Weeknight pasta, Tuesdays', status: 'pending', decided_at: null }
    ]);
    const text = dmText();
    expect(text).toContain('New Go live access request (1 pending)');
    expect(text).toContain('Note: "Weeknight pasta, Tuesdays"');
    expect(text).toContain('/admin/live');
  });

  it('DMs every admin, the backup included, the same text', async () => {
    await ask();
    const events = mocks.publish.mock.calls.map((c: any) => (c as [any])[0]);
    expect(events.map((e: any) => e.tags)).toEqual(ADMIN_PUBKEYS.map((pk) => [['p', pk]]));
    expect(ADMIN_PUBKEYS).toContain(BACKUP_ADMIN_PUBKEY);
    const backupCopy = events.find((e: any) => e.tags[0][1] === BACKUP_ADMIN_PUBKEY);
    expect(nip04.decrypt(senderSk, BACKUP_ADMIN_PUBKEY, backupCopy.content)).toBe(dmText());
  });

  it('allows one open request per account', async () => {
    await ask();
    const again = await ask({ note: 'again' });
    expect(again.res.status).toBe(409);
    expect(again.data).toEqual({ error: 'already_pending' });
    expect(requests()).toHaveLength(1);
  });

  it('throttles the admin DM, but saves every request', async () => {
    await ask();
    await ask({ note: 'me too' }, otherSk);
    expect(requests()).toHaveLength(2);
    expect(mocks.publish).toHaveBeenCalledTimes(1 * DMS);
  });

  it('accepts no note, strips control characters and refuses a note over 280', async () => {
    expect((await ask({})).res.status).toBe(200);
    expect(requests()[0].note).toBe('');
    db.raw.exec('DELETE FROM live_access_requests');
    await ask({ note: 'Line one\nline two\u0007' });
    expect(requests()[0].note).toBe('Line one\nline two');
    db.raw.exec('DELETE FROM live_access_requests');
    expect((await ask({ note: 'x'.repeat(281) })).res.status).toBe(400);
    expect((await ask({ note: 5 })).res.status).toBe(400);
  });

  it('a declined account may ask again only 30 days after the decision', async () => {
    const now = Math.floor(Date.now() / 1000);
    db.raw
      .prepare(
        "INSERT INTO live_access_requests (id, pubkey, status, created_at, decided_at) VALUES ('r', ?, 'declined', ?, ?)"
      )
      .run(MEMBER, now - 10 * DAY, now - 10 * DAY);
    const early = await ask();
    expect(early.res.status).toBe(409);
    expect(early.data).toEqual({ error: 'declined_recently', retry_at: now - 10 * DAY + 30 * DAY });
    db.raw.prepare('UPDATE live_access_requests SET decided_at = ?').run(now - 31 * DAY);
    expect((await ask()).res.status).toBe(200);
  });

  it('saves nothing for an account already approved', async () => {
    approveHosts(db, MEMBER);
    expect((await ask()).data).toEqual({ ok: true, approved: true });
    expect(requests()).toEqual([]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('is for members only, and an outage is "try again"', async () => {
    mocks.checkMembership.mockResolvedValueOnce({ state: 'inactive', found: true });
    expect((await ask()).data).toEqual({ error: 'membership_required' });
    mocks.checkMembership.mockResolvedValueOnce({ state: 'unknown', reason: 'timeout' });
    expect((await ask()).res.status).toBe(503);
    expect(requests()).toEqual([]);
  });

  it('on preview, throttles with the preview key only', async () => {
    env.LIVE_INPUT_PREFIX = 'zc-live-preview-';
    kv.data.set('live:access-alert', '1'); // a production throttle
    await ask();
    expect(mocks.publish).toHaveBeenCalledTimes(1 * DMS);
    expect(kv.data.has('live:preview:access-alert')).toBe(true);
  });

  it("reads the preview mode on preview: production's 'members' does not open it", async () => {
    kv.data.set('live:hosting_mode', 'members');
    env.LIVE_INPUT_PREFIX = 'zc-live-preview-';
    expect((await status()).data).toMatchObject({ mode: 'approved', approved: false });
    kv.data.set('live:preview:hosting_mode', 'members');
    expect((await status()).data).toMatchObject({ mode: 'members', approved: true });
  });

  it('keeps the request when the DM cannot be sent, and the next one alerts', async () => {
    // Every admin's copy fails (one copy reaching anyone counts as sent).
    for (let i = 0; i < DMS; i++) mocks.publish.mockRejectedValueOnce(new Error('no relay'));
    expect((await ask()).res.status).toBe(200);
    expect(requests()).toHaveLength(1);
    await ask({}, otherSk);
    expect(mocks.publish).toHaveBeenCalledTimes(2 * DMS);
    expect(dmText(1)).toContain('(2 pending)');
  });
});
