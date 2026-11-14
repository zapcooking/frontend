/**
 * Staged rollout: GET /api/live/hosting (can this account host) and
 * POST /api/live/hosting (Request access → admin DM). NIP-98 is real; the
 * membership lookup and the DM publisher are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip04, type EventTemplate } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { normalizeUrl, sha256Hex } from '$lib/nip98';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { approveHosts, createLiveDatabase } from '../../../../test/liveDatabase';
import { createKvFake } from '../../../../test/liveStreamStub';

const mocks = vi.hoisted(() => ({ publish: vi.fn(), checkMembership: vi.fn() }));
vi.mock('$lib/rawPublish', () => ({ publishEventRaw: mocks.publish }));
vi.mock('$lib/membershipApi.server', () => ({ checkMembership: mocks.checkMembership }));

import { GET, POST } from './+server';

const URL_ = 'https://zap.cooking/api/live/hosting';
const memberSk = generateSecretKey();
const MEMBER = getPublicKey(memberSk);
const senderSk = generateSecretKey();

let db: ReturnType<typeof createLiveDatabase>;
let kv: ReturnType<typeof createKvFake>;
let env: Record<string, unknown>;

async function nip98(body: string, sk = memberSk) {
  const template: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', normalizeUrl(URL_)],
      ['method', 'POST'],
      ['payload', await sha256Hex(new TextEncoder().encode(body))]
    ],
    content: ''
  };
  return `Nostr ${btoa(JSON.stringify(finalizeEvent(template, sk)))}`;
}

async function status(pubkey: string) {
  const res = await GET({ url: new URL(`${URL_}?pubkey=${pubkey}`), platform: { env } } as any);
  return { res, data: await res.json() };
}

async function ask(profile: unknown = { name: 'Ana', nip05: 'ana@example.com' }, auth?: string | null) {
  const body = JSON.stringify(profile);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const a = auth === undefined ? await nip98(body) : auth;
  if (a) headers.Authorization = a;
  const res = await POST({
    request: new Request(URL_, { method: 'POST', headers, body }),
    platform: { env }
  } as any);
  return { res, data: await res.json() };
}

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
  it("in 'approved' mode answers by the list", async () => {
    expect((await status(MEMBER)).data).toEqual({ mode: 'approved', approved: false });
    approveHosts(db, MEMBER);
    expect((await status(MEMBER)).data).toEqual({ mode: 'approved', approved: true });
    expect((await status(ADMIN_PUBKEY)).data.approved).toBe(true); // the seed
  });

  it("in 'members' mode everyone is approved (membership is checked at create)", async () => {
    kv.data.set('live:hosting_mode', 'members');
    expect((await status(MEMBER)).data).toEqual({ mode: 'members', approved: true });
  });

  it('never discloses a block', async () => {
    approveHosts(db, MEMBER);
    db.raw.prepare('INSERT INTO live_blocked_hosts (pubkey, created_at) VALUES (?, 1)').run(MEMBER);
    expect((await status(MEMBER)).data).toEqual({ mode: 'approved', approved: true });
  });

  it('refuses a malformed key', async () => {
    expect((await status('nope')).res.status).toBe(400);
  });
});

describe('POST /api/live/hosting (Request access)', () => {
  it('DMs the admin the npub, profile link and self-reported name', async () => {
    const { res, data } = await ask();
    expect(res.status).toBe(200);
    expect(data).toEqual({ ok: true });
    const [event] = mocks.publish.mock.calls[0] as [any];
    expect(event.tags).toEqual([['p', ADMIN_PUBKEY]]);
    expect(event.pubkey).toBe(getPublicKey(senderSk));
    // The admin key is not ours in tests; check the plaintext through the sender's side.
    const text = nip04.decrypt(senderSk, ADMIN_PUBKEY, event.content);
    expect(text).toContain('Go live access request');
    expect(text).toContain('Name: Ana (from their profile)');
    expect(text).toContain('/admin/live');
  });

  it('strips control characters and caps the profile text', async () => {
    await ask({ name: 'A\nB\u0007' + 'x'.repeat(200), nip05: 7 });
    const [event] = mocks.publish.mock.calls[0] as [any];
    const text = nip04.decrypt(senderSk, ADMIN_PUBKEY, event.content);
    const nameLine = text.split('\n').find((l: string) => l.startsWith('Name:'))!;
    expect(nameLine).not.toMatch(/[\u0000-\u001f]/);
    expect(nameLine.length).toBeLessThan(120);
    expect(text).not.toContain('NIP-05');
  });

  it('sends one request per account per day', async () => {
    expect((await ask()).res.status).toBe(200);
    const again = await ask();
    expect(again.res.status).toBe(409);
    expect(again.data).toEqual({ error: 'already_requested' });
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for an account already approved', async () => {
    approveHosts(db, MEMBER);
    expect((await ask()).data).toEqual({ ok: true, approved: true });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('is for members only, and an outage is "try again"', async () => {
    mocks.checkMembership.mockResolvedValueOnce({ state: 'inactive', found: true });
    expect((await ask()).data).toEqual({ error: 'membership_required' });
    mocks.checkMembership.mockResolvedValueOnce({ state: 'unknown', reason: 'timeout' });
    expect((await ask()).res.status).toBe(503);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('needs a valid signature over this request', async () => {
    expect((await ask(undefined, null)).res.status).toBe(401);
    expect((await ask({ name: 'x' }, await nip98('{"name":"other"}'))).res.status).toBe(401);
  });

  it('says so, and sets no throttle, when the DM cannot be sent', async () => {
    mocks.publish.mockRejectedValueOnce(new Error('no relay'));
    expect((await ask()).res.status).toBe(503);
    expect((await ask()).res.status).toBe(200);
  });
});
