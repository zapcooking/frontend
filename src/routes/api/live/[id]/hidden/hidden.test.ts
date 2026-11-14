/**
 * Hidden commenters: GET (public) and POST (NIP-98, host for their own
 * list, admin for any). Real SQLite running the Go live migrations, real
 * NIP-98; the admin key is a test key.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '$lib/nip98';
import { createLiveDatabase } from '../../../../../test/liveDatabase';

const keys = vi.hoisted(() => ({ admin: '' }));
vi.mock('$lib/adminAuth', () => ({
  get ADMIN_PUBKEY() {
    return keys.admin;
  }
}));

import { GET, POST } from './+server';

const ORIGIN = 'https://zap.cooking';
const ID = 'a'.repeat(32);
const hostSk = generateSecretKey();
const HOST = getPublicKey(hostSk);
const adminSk = generateSecretKey();
keys.admin = getPublicKey(adminSk);
const otherHostSk = generateSecretKey();
const OTHER_HOST = getPublicKey(otherHostSk);
const strangerSk = generateSecretKey();
const TROLL = 'b'.repeat(64);
const SPAMMER = 'c'.repeat(64);

let db: ReturnType<typeof createLiveDatabase>;
let platformEnv: Record<string, unknown>;

function insertSession(id: string, host: string, status = 'live') {
  db.raw
    .prepare(
      "INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at) VALUES (?, ?, 't', 'h', ?, 1)"
    )
    .run(id, host, status);
}

async function nip98(url: string, body: string, sk: Uint8Array): Promise<string> {
  const tags = [
    ['u', normalizeUrl(url)],
    ['method', 'POST'],
    ['payload', await sha256Hex(new TextEncoder().encode(body))]
  ];
  const template: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  };
  return `Nostr ${btoa(JSON.stringify(finalizeEvent(template, sk)))}`;
}

async function get(id = ID) {
  const res = await GET({ params: { id }, platform: { env: platformEnv } } as any);
  return { res, data: await res.json() };
}

async function post(body: unknown, sk: Uint8Array | null, id = ID) {
  const url = `${ORIGIN}/api/live/${id}/hidden`;
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (sk) headers.set('Authorization', await nip98(url, raw, sk));
  const res = await POST({
    request: new Request(url, { method: 'POST', headers, body: raw }),
    params: { id },
    platform: { env: platformEnv }
  } as any);
  return { res, data: await res.json() };
}

beforeEach(() => {
  db = createLiveDatabase();
  platformEnv = { SCHEDULER_DB: db };
  insertSession(ID, HOST);
});

describe('hidden commenters', () => {
  it('starts empty, and the host hides and unhides in their own list', async () => {
    expect((await get()).data).toEqual({ hidden: [] });
    const hide = await post({ pubkey: TROLL, hidden: true }, hostSk);
    expect(hide.res.status).toBe(200);
    expect(hide.data).toEqual({ pubkey: TROLL, hidden: true, scope: 'host' });
    expect((await get()).data.hidden).toEqual([{ pubkey: TROLL, scope: 'host' }]);
    // Again is fine (no duplicate).
    await post({ pubkey: TROLL, hidden: true }, hostSk);
    expect((await get()).data.hidden).toHaveLength(1);
    expect((await post({ pubkey: TROLL, hidden: false }, hostSk)).res.status).toBe(200);
    expect((await get()).data.hidden).toEqual([]);
  });

  it("a host's list follows the host to their other sessions, and not to other hosts", async () => {
    await post({ pubkey: TROLL, hidden: true }, hostSk);
    const later = 'd'.repeat(32);
    const other = 'e'.repeat(32);
    insertSession(later, HOST, 'ended'); // one open session per host
    insertSession(other, OTHER_HOST);
    expect((await get(later)).data.hidden).toEqual([{ pubkey: TROLL, scope: 'host' }]);
    expect((await get(other)).data.hidden).toEqual([]);
  });

  it('the admin hides everywhere; global entries show in every session', async () => {
    const r = await post({ pubkey: SPAMMER, hidden: true, scope: 'global' }, adminSk);
    expect(r.res.status).toBe(200);
    const other = 'e'.repeat(32);
    insertSession(other, OTHER_HOST);
    expect((await get()).data.hidden).toEqual([{ pubkey: SPAMMER, scope: 'global' }]);
    expect((await get(other)).data.hidden).toEqual([{ pubkey: SPAMMER, scope: 'global' }]);
    expect(
      (await post({ pubkey: SPAMMER, hidden: false, scope: 'global' }, adminSk)).res.status
    ).toBe(200);
    expect((await get(other)).data.hidden).toEqual([]);
  });

  it("the admin can unhide from a host's list", async () => {
    await post({ pubkey: TROLL, hidden: true }, hostSk);
    expect((await post({ pubkey: TROLL, hidden: false }, adminSk)).res.status).toBe(200);
    expect((await get()).data.hidden).toEqual([]);
  });

  it('refuses others: a stranger, another host, a host going global', async () => {
    expect((await post({ pubkey: TROLL, hidden: true }, strangerSk)).res.status).toBe(403);
    expect((await post({ pubkey: TROLL, hidden: true }, otherHostSk)).res.status).toBe(403);
    expect((await post({ pubkey: TROLL, hidden: true, scope: 'global' }, hostSk)).res.status).toBe(
      403
    );
    expect((await post({ pubkey: TROLL, hidden: true }, null)).res.status).toBe(401);
    expect((await get()).data.hidden).toEqual([]);
  });

  it('refuses bad input, and hiding the host or the admin', async () => {
    for (const body of [
      { pubkey: 'nope', hidden: true },
      { pubkey: TROLL },
      { pubkey: TROLL, hidden: 'yes' },
      { pubkey: TROLL, hidden: true, scope: 'site' },
      { pubkey: HOST, hidden: true },
      { pubkey: keys.admin, hidden: true, scope: 'global' }
    ]) {
      expect((await post(body, adminSk)).res.status).toBe(400);
    }
    expect((await post('x'.repeat(2000), hostSk)).res.status).toBe(413);
  });

  it('answers 404 for an unknown session', async () => {
    expect((await get('f'.repeat(32))).res.status).toBe(404);
    expect((await post({ pubkey: TROLL, hidden: true }, hostSk, 'f'.repeat(32))).res.status).toBe(
      404
    );
  });
});
