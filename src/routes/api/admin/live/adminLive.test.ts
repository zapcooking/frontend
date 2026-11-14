/**
 * Tests for the Go live admin kill switch and the global off flag.
 *
 * NIP-98 is real. ADMIN_PUBKEY is replaced by a test key, because nobody
 * can sign as the real admin in a test. Sessions go live through the real
 * create and publish routes against a Cloudflare stub.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '$lib/nip98';
import { createLiveDatabase } from '../../../../test/liveDatabase';
import { createKvFake } from '../../../../test/liveStreamStub';

const mocks = vi.hoisted(() => ({
  checkMembership: vi.fn(),
  hosts: [] as string[],
  admin: ''
}));
vi.mock('$lib/adminAuth', () => ({
  get ADMIN_PUBKEY() {
    return mocks.admin;
  },
  isAdmin: (pubkey: string | null | undefined) => !!pubkey && pubkey === mocks.admin
}));
vi.mock('$lib/membershipApi.server', () => ({ checkMembership: mocks.checkMembership }));
vi.mock('$lib/live/config', async () => {
  const actual = (await vi.importActual('$lib/live/config')) as typeof import('$lib/live/config');
  return {
    ...actual,
    isLiveHost: (pubkey: string | null | undefined) => actual.isLiveHost(pubkey, mocks.hosts)
  };
});

import { POST as createRoute } from '../../live/+server';
import { POST as publishRoute } from '../../live/[id]/publish/+server';
import { POST as joinRoute } from '../../live/[id]/join/+server';
import { GET, POST } from './+server';

const ORIGIN = 'https://zap.cooking';
const ADMIN_URL = `${ORIGIN}/api/admin/live`;
const ACCOUNT = '2d2f9386809ef6f9cda581aa16dff31c';
const STREAM_HOST = 'https://customer-abc123.cloudflarestream.com';
const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';

const adminSk = generateSecretKey();
mocks.admin = getPublicKey(adminSk);
const hostSks = [generateSecretKey(), generateSecretKey(), generateSecretKey()];
const HOSTS = hostSks.map((sk) => getPublicKey(sk));
const strangerSk = generateSecretKey();

const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');

const cf = { inputs: new Map<string, string>(), everCreated: [] as string[], deleteStatus: 200 };
function installCloudflare() {
  cf.inputs.clear();
  cf.everCreated = [];
  cf.deleteStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (target: string | URL | Request, init: RequestInit = {}) => {
      const url = String(target);
      const method = init.method ?? 'GET';
      if (
        url.startsWith(
          `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/live_inputs`
        )
      ) {
        if (method === 'POST') {
          const uid = hex(16);
          const secret = hex(20);
          cf.inputs.set(uid, secret);
          cf.everCreated.push(uid, secret);
          return new Response(
            JSON.stringify({
              result: {
                uid,
                webRTC: { url: `${STREAM_HOST}/${secret}/webRTC/publish` },
                webRTCPlayback: { url: `${STREAM_HOST}/${uid}/webRTC/play` }
              }
            }),
            { status: 200 }
          );
        }
        if (method === 'DELETE') {
          if (cf.deleteStatus !== 200) return new Response('{}', { status: cf.deleteStatus });
          return new Response('{}', {
            status: cf.inputs.delete(url.split('/').pop()!) ? 200 : 404
          });
        }
      }
      if (url.startsWith(STREAM_HOST) && method === 'POST')
        return new Response('v=0\r\nanswer\r\n', { status: 201 });
      throw new Error(`unexpected fetch ${method} ${url}`);
    })
  );
}

let db: ReturnType<typeof createLiveDatabase>;
let kv: ReturnType<typeof createKvFake>;
let env: Record<string, unknown>;

async function nip98(url: string, method: string, body: string | undefined, sk: Uint8Array) {
  const tags: string[][] = [
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

async function createLive(i: number, goLive = true): Promise<{ id: string; token: string }> {
  const url = `${ORIGIN}/api/live`;
  const body = JSON.stringify({ title: `Session ${i}` });
  const res = await createRoute({
    request: new Request(url, {
      method: 'POST',
      headers: { Authorization: await nip98(url, 'POST', body, hostSks[i]) },
      body
    }),
    platform: { env }
  } as any);
  const data = await res.json();
  expect(res.status).toBe(201);
  if (goLive) expect((await publish(data.id, data.host_token)).status).toBe(201);
  return { id: data.id, token: data.host_token };
}

const publish = (id: string, token: string) =>
  publishRoute({
    request: new Request(`${ORIGIN}/api/live/${id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/sdp' },
      body: SDP
    }),
    params: { id },
    platform: { env }
  } as any);

const join = (id: string) =>
  joinRoute({
    request: new Request(`${ORIGIN}/api/live/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: SDP
    }),
    params: { id },
    platform: { env }
  } as any);

async function admin(
  body: unknown,
  opts: { sk?: Uint8Array; auth?: string | null; rawBody?: string } = {}
) {
  const raw = opts.rawBody ?? JSON.stringify(body);
  const auth =
    opts.auth === undefined ? await nip98(ADMIN_URL, 'POST', raw, opts.sk ?? adminSk) : opts.auth;
  const res = await POST({
    request: new Request(ADMIN_URL, {
      method: 'POST',
      headers: auth ? { Authorization: auth } : {},
      body: raw
    }),
    platform: { env }
  } as any);
  const text = await res.text();
  return { res, text, data: JSON.parse(text) };
}

async function adminList(sk: Uint8Array | null = adminSk) {
  const res = await GET({
    request: new Request(ADMIN_URL, {
      headers: sk ? { Authorization: await nip98(ADMIN_URL, 'GET', undefined, sk) } : {}
    }),
    platform: { env }
  } as any);
  const text = await res.text();
  return { res, text, data: JSON.parse(text) };
}

const rowOf = (id: string) => db.raw.prepare('SELECT * FROM live_sessions WHERE id = ?').get(id);

beforeEach(() => {
  db = createLiveDatabase();
  kv = createKvFake();
  env = {
    SCHEDULER_DB: db,
    GATED_CONTENT: kv,
    MEMBERSHIP_ENABLED: 'true',
    RELAY_API_SECRET: 'relay-secret',
    CF_STREAM_ACCOUNT_ID: ACCOUNT,
    CF_STREAM_API_TOKEN: 'stream-token'
  };
  mocks.hosts = [...HOSTS];
  mocks.checkMembership.mockReset().mockResolvedValue({ state: 'active', found: true });
  installCloudflare();
  for (const level of ['log', 'warn', 'error'] as const)
    vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('admin only', () => {
  it('refuses everyone but the admin, on every call', async () => {
    const s = await createLive(0);
    const body = { action: 'end', id: s.id };
    const raw = JSON.stringify(body);
    const attempts = [
      await admin(body, { auth: null }),
      await admin(body, { sk: hostSks[0] }), // the session's own host
      await admin(body, { sk: strangerSk }),
      await admin(body, { auth: `Bearer ${s.token}` }), // the host token
      await admin(body, {
        auth: await nip98(ADMIN_URL, 'POST', '{"action":"off","on":false}', adminSk)
      }), // admin, other body
      await admin(body, { auth: await nip98(ADMIN_URL, 'POST', undefined, adminSk) }), // admin, no payload tag
      await admin(body, { auth: await nip98(`${ORIGIN}/api/admin/promos`, 'POST', raw, adminSk) }) // admin, other route
    ];
    for (const { res, data } of attempts) {
      expect(res.status).toBe(403);
      expect(data).toEqual({ error: 'forbidden' });
    }
    expect((await adminList(null)).res.status).toBe(403);
    expect((await adminList(hostSks[0])).res.status).toBe(403);
    expect(rowOf(s.id).status).toBe('live');
    expect(cf.inputs.size).toBe(1);
    expect(kv.data.size).toBe(0);
  });

  it('refuses an oversized body before any signature work', async () => {
    const big = JSON.stringify({ action: 'end', id: 'a'.repeat(32), pad: 'p'.repeat(2000) });
    const { res, data } = await admin(null, { rawBody: big });
    expect(res.status).toBe(413);
    expect(data).toEqual({ error: 'too_large' });
  });
});

describe('end one session', () => {
  it('ends the session and deletes its input', async () => {
    const s = await createLive(0);
    const other = await createLive(1);
    const { res, data } = await admin({ action: 'end', id: s.id });
    expect(res.status).toBe(200);
    expect(data).toEqual({ id: s.id, status: 'ended', ended: true, input: 'deleted' });

    const row = rowOf(s.id);
    expect(row.status).toBe('ended');
    expect(row.end_reason).toBe('admin');
    expect(row.cf_input_uid).toBeNull();
    expect(row.host_token_hash).toBe('');
    expect(cf.inputs.size).toBe(1);
    expect(rowOf(other.id).status).toBe('live');

    // The host can no longer publish, and nobody can join.
    expect((await publish(s.id, s.token)).status).toBe(409);
    expect((await join(s.id)).status).toBe(410);
  });

  it('reports a delete that could not be confirmed, and retries it on a second call', async () => {
    const s = await createLive(0);
    cf.deleteStatus = 500;
    const first = await admin({ action: 'end', id: s.id });
    expect(first.data).toEqual({ id: s.id, status: 'ended', ended: true, input: 'pending' });
    expect(rowOf(s.id).status).toBe('ended');
    expect(rowOf(s.id).cf_input_uid).not.toBeNull();

    cf.deleteStatus = 200;
    const second = await admin({ action: 'end', id: s.id });
    expect(second.data).toEqual({ id: s.id, status: 'ended', ended: false, input: 'deleted' });
    expect(rowOf(s.id).cf_input_uid).toBeNull();
    expect(cf.inputs.size).toBe(0);
  });

  it('ends a session that never went live', async () => {
    const s = await createLive(0, false);
    const { data } = await admin({ action: 'end', id: s.id });
    expect(data).toEqual({ id: s.id, status: 'ended', ended: true, input: 'none' });
  });

  it('answers 404 for an unknown id and 400 for a malformed request', async () => {
    expect((await admin({ action: 'end', id: 'f'.repeat(32) })).res.status).toBe(404);
    for (const body of [
      { action: 'end', id: 'new' },
      { action: 'end' },
      { action: 'destroy' },
      { action: 'off' },
      { action: 'off', on: 'yes' },
      []
    ]) {
      expect((await admin(body)).res.status).toBe(400);
    }
  });
});

describe('list', () => {
  it('shows open sessions and pending inputs, with no input id, token or lock', async () => {
    const live = await createLive(0);
    const waiting = await createLive(1, false);
    const stuck = await createLive(2);
    cf.deleteStatus = 500;
    await admin({ action: 'end', id: stuck.id });

    const { res, data, text } = await adminList();
    expect(res.status).toBe(200);
    expect(data.off).toBe(false);
    const byId = Object.fromEntries(data.sessions.map((s: any) => [s.id, s]));
    expect(byId[live.id]).toMatchObject({
      status: 'live',
      input_recorded: true,
      host_pubkey: HOSTS[0],
      title: 'Session 0'
    });
    expect(byId[waiting.id]).toMatchObject({ status: 'created', input_recorded: false });
    expect(byId[stuck.id]).toMatchObject({ status: 'ended', input_recorded: true });
    expect(text).not.toMatch(/cf_input_uid|cf_play_url|host_token|publish_lock|cloudflarestream/);
    for (const secret of cf.everCreated) expect(text).not.toContain(secret);
  });
});

describe('global off flag', () => {
  it('switching off sets the flag, ends every open session and deletes every input', async () => {
    const a = await createLive(0);
    const b = await createLive(1);
    const c = await createLive(2, false);
    const { res, data } = await admin({ action: 'off', on: true });
    expect(res.status).toBe(200);
    expect(data).toEqual({ off: true, flag_written: true, ended: 3, inputs_pending: 0 });
    expect(kv.data.get('live:off')).toBe('1');
    for (const s of [a, b, c]) {
      expect(rowOf(s.id).status).toBe('ended');
      expect(rowOf(s.id).end_reason).toBe('admin');
      expect(rowOf(s.id).cf_input_uid).toBeNull();
    }
    expect(cf.inputs.size).toBe(0);
    expect((await adminList()).data.off).toBe(true);
  });

  it('while off, create, publish and join all refuse with live_off', async () => {
    const live = await createLive(0);
    const waiting = await createLive(1, false);
    kv.data.set('live:off', '1'); // the flag alone, without ending anything

    const url = `${ORIGIN}/api/live`;
    const body = JSON.stringify({ title: 'Nope' });
    const create = await createRoute({
      request: new Request(url, {
        method: 'POST',
        headers: { Authorization: await nip98(url, 'POST', body, hostSks[2]) },
        body
      }),
      platform: { env }
    } as any);
    const pub = await publish(waiting.id, waiting.token);
    const viewer = await join(live.id);
    for (const res of [create, pub, viewer]) {
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data).toEqual({ error: 'live_off' });
      expect(res.headers.get('Retry-After')).toBeNull();
    }
    expect(db.raw.prepare('SELECT COUNT(*) AS c FROM live_sessions').get().c).toBe(2);
    expect(rowOf(live.id).guest_joins).toBe(0);
  });

  it('create refuses while off even without a signature', async () => {
    kv.data.set('live:off', '1');
    const res = await createRoute({
      request: new Request(`${ORIGIN}/api/live`, { method: 'POST', body: '{}' }),
      platform: { env }
    } as any);
    expect(res.status).toBe(503);
  });

  it('switching back on clears the flag and restarts nothing', async () => {
    const s = await createLive(0);
    await admin({ action: 'off', on: true });
    const { data } = await admin({ action: 'off', on: false });
    expect(data).toEqual({ off: false, flag_written: true, ended: 0, inputs_pending: 0 });
    expect(kv.data.has('live:off')).toBe(false);
    expect(rowOf(s.id).status).toBe('ended');
    // A new session can be created again.
    expect((await createLive(0)).id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('still ends every session when the flag cannot be written, and says so', async () => {
    const s = await createLive(0);
    kv.failWrites = true;
    const { data } = await admin({ action: 'off', on: true });
    expect(data).toEqual({ off: true, flag_written: false, ended: 1, inputs_pending: 0 });
    expect(rowOf(s.id).status).toBe('ended');

    env.GATED_CONTENT = undefined;
    const t = await createLive(1);
    expect((await admin({ action: 'off', on: true })).data).toMatchObject({
      flag_written: false,
      ended: 1
    });
    expect(rowOf(t.id).status).toBe('ended');
  });

  it('reports inputs whose delete could not be confirmed', async () => {
    await createLive(0);
    await createLive(1);
    cf.deleteStatus = 500;
    const { data } = await admin({ action: 'off', on: true });
    expect(data).toEqual({ off: true, flag_written: true, ended: 2, inputs_pending: 2 });
  });

  it('a flag that cannot be read does not switch Go live off', async () => {
    const s = await createLive(0);
    kv.data.set('live:off', '1');
    kv.failReads = true;
    expect((await join(s.id)).status).toBe(201);
  });

  it('only the exact value switches it off', async () => {
    const s = await createLive(0);
    for (const value of ['0', 'true', '']) {
      kv.data.set('live:off', value);
      expect((await join(s.id)).status).toBe(201);
    }
  });
});
