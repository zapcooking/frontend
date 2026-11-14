/**
 * Tests for the Go live publish relay and for End deleting the live input.
 *
 * Cloudflare is a stub at global fetch that behaves like the real thing
 * where it matters: create returns a uid, a publish URL carrying a secret
 * and a play URL carrying the uid; the WHIP reply carries Location, ETag
 * and Link headers that must never be forwarded. The database is real
 * SQLite running migration 0004. NIP-98 at create is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '$lib/nip98';
import { createLiveDatabase } from '../../../../../test/liveDatabase';

const mocks = vi.hoisted(() => ({
  checkMembership: vi.fn(),
  hosts: [] as string[]
}));
vi.mock('$lib/membershipApi.server', () => ({ checkMembership: mocks.checkMembership }));
vi.mock('$lib/live/config', async () => {
  const actual = (await vi.importActual('$lib/live/config')) as typeof import('$lib/live/config');
  return {
    ...actual,
    isLiveHost: (pubkey: string | null | undefined) => actual.isLiveHost(pubkey, mocks.hosts)
  };
});

import { POST as createRoute } from '../../+server';
import { GET as readRoute } from '../+server';
import { POST as endRoute } from '../end/+server';
import { POST as publishRoute } from './+server';

const ORIGIN = 'https://zap.cooking';
const ACCOUNT = '2d2f9386809ef6f9cda581aa16dff31c';
const STREAM_HOST = 'https://customer-abc123.cloudflarestream.com';
const OFFER =
  'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=candidate:1 1 udp 1 203.0.113.77 5000 typ host OFFER-PRIVATE-ADDRESS\r\n';
const ANSWER = 'v=0\r\no=- 9 9 IN IP4 0.0.0.0\r\na=ice-ufrag:abcd ANSWER-MARKER\r\n';

const hostSk = generateSecretKey();
const HOST = getPublicKey(hostSk);

// ── Cloudflare stub ─────────────────────────────────────────────────
interface FakeInput {
  uid: string;
  secret: string;
  publishes: number;
}
const cf = {
  inputs: new Map<string, FakeInput>(),
  calls: [] as string[],
  authHeaders: [] as (string | null)[],
  createStatus: 200,
  createBody: null as null | ((i: FakeInput) => unknown),
  createThrows: false,
  deleteStatus: 200,
  relayStatus: 201,
  relayGate: null as null | Promise<void>,
  everCreated: [] as FakeInput[]
};
const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');

function installCloudflare() {
  cf.inputs.clear();
  cf.calls = [];
  cf.authHeaders = [];
  cf.createStatus = 200;
  cf.createBody = null;
  cf.createThrows = false;
  cf.deleteStatus = 200;
  cf.relayStatus = 201;
  cf.relayGate = null;
  cf.everCreated = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      if (
        url.startsWith(
          `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/live_inputs`
        )
      ) {
        cf.authHeaders.push(new Headers(init.headers).get('Authorization'));
        if (method === 'POST') {
          cf.calls.push('create');
          if (cf.createThrows) throw new TypeError('network down');
          if (cf.createStatus !== 200) {
            return new Response(
              JSON.stringify({
                success: false,
                errors: [{ code: 10005, message: 'SECRET-MESSAGE' }]
              }),
              { status: cf.createStatus }
            );
          }
          const fake: FakeInput = { uid: hex(16), secret: hex(20), publishes: 0 };
          cf.inputs.set(fake.uid, fake);
          cf.everCreated.push(fake);
          const result = cf.createBody
            ? cf.createBody(fake)
            : {
                uid: fake.uid,
                webRTC: { url: `${STREAM_HOST}/${fake.secret}/webRTC/publish` },
                webRTCPlayback: { url: `${STREAM_HOST}/${fake.uid}/webRTC/play` }
              };
          return new Response(JSON.stringify({ success: true, result }), { status: 200 });
        }
        if (method === 'DELETE') {
          const uid = url.split('/').pop()!;
          cf.calls.push(`delete:${uid}`);
          if (cf.deleteStatus !== 200) return new Response('{}', { status: cf.deleteStatus });
          if (!cf.inputs.has(uid)) return new Response('{}', { status: 404 });
          cf.inputs.delete(uid);
          return new Response('{"success":true}', { status: 200 });
        }
      }
      if (url.startsWith(STREAM_HOST) && url.endsWith('/webRTC/publish') && method === 'POST') {
        const secret = new URL(url).pathname.split('/')[1];
        cf.calls.push('relay');
        if (cf.relayGate) await cf.relayGate;
        const fake = [...cf.inputs.values()].find((i) => i.secret === secret);
        if (!fake) return new Response('404 not found', { status: 404 });
        if (cf.relayStatus !== 201)
          return new Response('upstream says no', { status: cf.relayStatus });
        fake.publishes++;
        return new Response(ANSWER, {
          status: 201,
          headers: {
            'Content-Type': 'application/sdp',
            Location: `/${secret}/webRTC/publish/${hex(32)}`,
            ETag: `"${hex(32)}"`,
            Link: '<stun:stun.cloudflare.com:3478>; rel="ice-server"'
          }
        });
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    })
  );
}

// ── helpers ─────────────────────────────────────────────────────────
let db: ReturnType<typeof createLiveDatabase>;
let platformEnv: Record<string, unknown>;
let logged: string[];

async function nip98(url: string, body?: string): Promise<string> {
  const tags: string[][] = [
    ['u', normalizeUrl(url)],
    ['method', 'POST']
  ];
  if (body !== undefined) tags.push(['payload', await sha256Hex(new TextEncoder().encode(body))]);
  const template: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  };
  return `Nostr ${btoa(JSON.stringify(finalizeEvent(template, hostSk)))}`;
}

async function createSession(): Promise<{ id: string; token: string }> {
  const url = `${ORIGIN}/api/live`;
  const body = JSON.stringify({ title: 'Publish test' });
  const res = await createRoute({
    request: new Request(url, {
      method: 'POST',
      headers: { Authorization: await nip98(url, body) },
      body
    }),
    platform: { env: platformEnv }
  } as any);
  const data = await res.json();
  expect(res.status).toBe(201);
  return { id: data.id, token: data.host_token };
}

async function publish(
  id: string,
  opts: {
    token?: string | null;
    auth?: string;
    body?: string | null;
    contentType?: string | null;
  } = {}
) {
  const headers = new Headers();
  if (opts.auth) headers.set('Authorization', opts.auth);
  else if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`);
  if (opts.contentType !== null) headers.set('Content-Type', opts.contentType ?? 'application/sdp');
  const res = await publishRoute({
    request: new Request(`${ORIGIN}/api/live/${id}/publish`, {
      method: 'POST',
      headers,
      body: opts.body === null ? undefined : (opts.body ?? OFFER)
    }),
    params: { id },
    platform: { env: platformEnv }
  } as any);
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* SDP */
  }
  return { res, text, data };
}

async function end(id: string, token: string) {
  const res = await endRoute({
    request: new Request(`${ORIGIN}/api/live/${id}/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    }),
    params: { id },
    platform: { env: platformEnv }
  } as any);
  return { res, data: await res.json() };
}

const rowOf = (id: string) => db.raw.prepare('SELECT * FROM live_sessions WHERE id = ?').get(id);
const headerDump = (res: Response) => JSON.stringify([...res.headers]);

/** Nothing that must stay server-side may appear in a reply. */
function expectNoLeak(res: Response, text: string) {
  const all = text + headerDump(res);
  expect(res.headers.get('location')).toBeNull();
  expect(res.headers.get('etag')).toBeNull();
  expect(res.headers.get('link')).toBeNull();
  expect(all).not.toMatch(/cloudflarestream|webRTC|stun:/i);
  for (const fake of cf.everCreated) {
    expect(all).not.toContain(fake.uid);
    expect(all).not.toContain(fake.secret);
  }
}

beforeEach(() => {
  db = createLiveDatabase();
  platformEnv = {
    SCHEDULER_DB: db,
    MEMBERSHIP_ENABLED: 'true',
    RELAY_API_SECRET: 'relay-secret',
    CF_STREAM_ACCOUNT_ID: ACCOUNT,
    CF_STREAM_API_TOKEN: 'stream-token'
  };
  mocks.hosts = [HOST];
  mocks.checkMembership.mockReset().mockResolvedValue({ state: 'active', found: true });
  installCloudflare();
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(
        args
          .map((a) =>
            a instanceof Error
              ? `${a.name}: ${a.message}\n${a.stack}`
              : typeof a === 'string'
                ? a
                : JSON.stringify(a)
          )
          .join(' ')
      );
    });
  }
});

afterEach(() => {
  // Whatever happened in the test, nothing sensitive was logged.
  const all = logged.join('\n');
  expect(all).not.toContain('OFFER-PRIVATE-ADDRESS');
  expect(all).not.toContain('203.0.113.77');
  expect(all).not.toContain('ANSWER-MARKER');
  expect(all).not.toContain('SECRET-MESSAGE');
  expect(all).not.toMatch(/cloudflarestream|webRTC\/|stream-token/i);
  for (const fake of cf.everCreated) {
    expect(all).not.toContain(fake.uid);
    expect(all).not.toContain(fake.secret);
  }
  vi.restoreAllMocks();
});

describe('POST /api/live/<id>/publish', () => {
  it('relays the offer and returns the status and the SDP answer only', async () => {
    const s = await createSession();
    const { res, text } = await publish(s.id, { token: s.token });

    expect(res.status).toBe(201);
    expect(res.headers.get('Content-Type')).toBe('application/sdp');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(text).toBe(ANSWER);
    expect([...res.headers.keys()].sort()).toEqual(['cache-control', 'content-type']);
    expectNoLeak(res, text);

    expect(cf.calls).toEqual(['create', 'relay']);
    expect(cf.inputs.size).toBe(1);
    const [input] = cf.inputs.values();
    expect(input.publishes).toBe(1);

    const row = rowOf(s.id);
    expect(row.status).toBe('live');
    expect(row.cf_input_uid).toBe(input.uid);
    expect(row.cf_play_url).toBe(`${STREAM_HOST}/${input.uid}/webRTC/play`);
    expect(typeof row.started_at).toBe('number');
    expect(row.publish_lock).toBeNull();
    expect(row.reconnects).toBe(1);
    // The publish URL is stored nowhere.
    expect(JSON.stringify(row)).not.toContain(input.secret);
  });

  it('sends the trimmed Stream token and the offer bytes unchanged', async () => {
    platformEnv.CF_STREAM_API_TOKEN = '  stream-token\n';
    const s = await createSession();
    let relayedBody = '';
    const inner = globalThis.fetch as any;
    vi.stubGlobal('fetch', async (u: any, init: any = {}) => {
      if (String(u).endsWith('/webRTC/publish')) {
        relayedBody = new TextDecoder().decode(init.body);
        expect(new Headers(init.headers).get('Content-Type')).toBe('application/sdp');
      }
      return inner(u, init);
    });
    expect((await publish(s.id, { token: s.token })).res.status).toBe(201);
    expect(relayedBody).toBe(OFFER);
    expect(cf.authHeaders.every((h) => h === 'Bearer stream-token')).toBe(true);
  });

  it('keeps the public read free of relay state once live', async () => {
    const s = await createSession();
    await publish(s.id, { token: s.token });
    const res = await readRoute({ params: { id: s.id }, platform: { env: platformEnv } } as any);
    const text = await res.text();
    expect(JSON.parse(text).status).toBe('live');
    expectNoLeak(res, text);
    expect(text).not.toMatch(/cf_|publish_lock|reconnects/);
  });

  it('accepts the host token only', async () => {
    const s = await createSession();
    const url = `${ORIGIN}/api/live/${s.id}/publish`;
    const attempts = [
      await publish(s.id, {}),
      await publish(s.id, { token: 'a'.repeat(64) }),
      await publish(s.id, { auth: s.token }),
      // A valid NIP-98 signature from the host is NOT accepted here.
      await publish(s.id, { auth: await nip98(url, OFFER) })
    ];
    for (const { res, data } of attempts) {
      expect(res.status).toBe(401);
      expect(data.error).toBe('auth_failed');
    }
    expect(cf.calls).toEqual([]);
    expect(rowOf(s.id).reconnects).toBe(0);
  });

  it('refuses an ended session and an unknown id', async () => {
    const s = await createSession();
    await end(s.id, s.token);
    const ended = await publish(s.id, { token: s.token });
    expect(ended.res.status).toBe(409);
    expect(ended.data).toEqual({ error: 'ended' });
    expect((await publish('c'.repeat(32), { token: s.token })).res.status).toBe(404);
    expect((await publish('new', { token: s.token })).res.status).toBe(404);
    expect(cf.calls).toEqual([]);
  });

  it('refuses a host who is no longer on the host list', async () => {
    const s = await createSession();
    mocks.hosts = [];
    const { res, data } = await publish(s.id, { token: s.token });
    expect(res.status).toBe(403);
    expect(data).toEqual({ error: 'not_allowed' });
    expect(cf.calls).toEqual([]);
  });

  it('validates the offer before calling Cloudflare', async () => {
    const s = await createSession();
    const cases: [Parameters<typeof publish>[1], number, string][] = [
      [{ contentType: 'application/json' }, 415, 'unsupported_media_type'],
      [{ contentType: null }, 415, 'unsupported_media_type'],
      [{ body: 'x'.repeat(33 * 1024) }, 413, 'too_large'],
      [{ body: null }, 400, 'bad_offer'],
      [{ body: '{"sdp":"v=0"}' }, 400, 'bad_offer'],
      [{ body: 'v=' }, 400, 'bad_offer']
    ];
    for (const [opts, status, error] of cases) {
      const { res, data } = await publish(s.id, { token: s.token, ...opts });
      expect(res.status).toBe(status);
      expect(data.error).toBe(error);
    }
    expect(
      (await publish(s.id, { token: s.token, contentType: 'application/sdp; charset=utf-8' })).res
        .status
    ).toBe(201);
    expect(cf.calls).toEqual(['create', 'relay']);
  });

  it('two simultaneous publishes: one 201, one 409, one input, one broadcast', async () => {
    const s = await createSession();
    // Hold the first publish inside its relay call, so the second one
    // arrives while the lock is held.
    let open!: () => void;
    cf.relayGate = new Promise<void>((resolve) => (open = resolve));
    const first = publish(s.id, { token: s.token });
    while (!cf.calls.includes('relay')) await new Promise((r) => setTimeout(r, 1));

    const second = await publish(s.id, { token: s.token });
    expect(second.res.status).toBe(409);
    expect(second.data).toEqual({ error: 'publish_in_progress', retry: true });
    expect(second.res.headers.get('Retry-After')).toBe('2');

    open();
    expect((await first).res.status).toBe(201);

    expect(cf.everCreated.length).toBe(1);
    expect(cf.inputs.size).toBe(1);
    expect(cf.everCreated[0].publishes).toBe(1);
    expect(rowOf(s.id).status).toBe('live');
    // The refused attempt did not use up a publish attempt.
    expect(rowOf(s.id).reconnects).toBe(1);
  });

  it('many publishes fired at once never put two broadcasts on one input', async () => {
    const s = await createSession();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => publish(s.id, { token: s.token }))
    );
    const statuses = results.map((r) => r.res.status);
    expect(statuses.every((c) => c === 201 || c === 409)).toBe(true);
    expect(statuses).toContain(201);
    // However they interleaved: one input left, and none ever carried two.
    expect(cf.inputs.size).toBe(1);
    expect(cf.everCreated.every((i) => i.publishes <= 1)).toBe(true);
    const row = rowOf(s.id);
    expect(row.status).toBe('live');
    expect(row.cf_input_uid).toBe([...cf.inputs.keys()][0]);
    expect(row.publish_lock).toBeNull();
  });

  it('a reconnect deletes the old input before creating the new one', async () => {
    const s = await createSession();
    await publish(s.id, { token: s.token });
    const first = rowOf(s.id);
    cf.calls = [];

    const again = await publish(s.id, { token: s.token });
    expect(again.res.status).toBe(201);
    expect(cf.calls).toEqual([`delete:${first.cf_input_uid}`, 'create', 'relay']);

    const row = rowOf(s.id);
    expect(row.status).toBe('live');
    expect(row.cf_input_uid).not.toBe(first.cf_input_uid);
    expect(row.started_at).toBe(first.started_at);
    expect(row.reconnects).toBe(2);
    expect(cf.inputs.size).toBe(1);
    // No input ever carried more than one broadcast.
    expect(cf.everCreated.every((i) => i.publishes <= 1)).toBe(true);
  });

  it('does not start a second broadcast when the old input cannot be deleted', async () => {
    const s = await createSession();
    await publish(s.id, { token: s.token });
    const first = rowOf(s.id);
    cf.calls = [];
    cf.deleteStatus = 500;

    const { res, data } = await publish(s.id, { token: s.token });
    expect(res.status).toBe(503);
    expect(data).toEqual({ error: 'stream_unavailable', retry: true });
    expect(res.headers.get('Retry-After')).toBe('2');
    expect(cf.calls).toEqual([`delete:${first.cf_input_uid}`]);

    const row = rowOf(s.id);
    expect(row.cf_input_uid).toBe(first.cf_input_uid);
    expect(row.publish_lock).toBeNull();

    // The lock was released, so the retry goes straight through.
    cf.deleteStatus = 200;
    expect((await publish(s.id, { token: s.token })).res.status).toBe(201);
    expect(cf.inputs.size).toBe(1);
  });

  it('treats an already-deleted old input as deleted', async () => {
    const s = await createSession();
    await publish(s.id, { token: s.token });
    cf.inputs.clear(); // Cloudflare no longer has it: DELETE answers 404
    expect((await publish(s.id, { token: s.token })).res.status).toBe(201);
    expect(cf.inputs.size).toBe(1);
  });

  it('answers try-again, not 500, when Cloudflare cannot create an input', async () => {
    const s = await createSession();
    for (const breakIt of [
      () => (cf.createStatus = 500),
      () => (cf.createStatus = 403),
      () => (cf.createThrows = true)
    ]) {
      cf.createStatus = 200;
      cf.createThrows = false;
      breakIt();
      const { res, data } = await publish(s.id, { token: s.token });
      expect(res.status).toBe(503);
      expect(data).toEqual({ error: 'stream_unavailable', retry: true });
      const row = rowOf(s.id);
      expect(row.status).toBe('created');
      expect(row.cf_input_uid).toBeNull();
      expect(row.publish_lock).toBeNull();
    }
    expect(cf.inputs.size).toBe(0);
  });

  it('is not reported live after a reconnect whose create fails', async () => {
    const s = await createSession();
    await publish(s.id, { token: s.token });
    cf.createStatus = 500;
    expect((await publish(s.id, { token: s.token })).res.status).toBe(503);
    const row = rowOf(s.id);
    // The old input is gone and no new one exists: not live.
    expect(row.status).toBe('created');
    expect(row.cf_input_uid).toBeNull();
    expect(row.cf_play_url).toBeNull();
    expect(cf.inputs.size).toBe(0);
  });

  it('deletes the new input and reports try-again when the relay fails', async () => {
    const s = await createSession();
    cf.relayStatus = 502;
    const { res, data } = await publish(s.id, { token: s.token });
    expect(res.status).toBe(503);
    expect(data).toEqual({ error: 'stream_unavailable', retry: true });
    expect(cf.inputs.size).toBe(0);
    const row = rowOf(s.id);
    expect(row.status).toBe('created');
    expect(row.cf_input_uid).toBeNull();
    expect(row.publish_lock).toBeNull();
  });

  it('reports offer_rejected, and leaves no input, when Cloudflare refuses the offer', async () => {
    const s = await createSession();
    cf.relayStatus = 400;
    const { res, data, text } = await publish(s.id, { token: s.token });
    expect(res.status).toBe(422);
    expect(data).toEqual({ error: 'offer_rejected' });
    expect(text).not.toContain('upstream says no');
    expect(cf.inputs.size).toBe(0);
    expect(rowOf(s.id).status).toBe('created');
  });

  it('keeps a record of an input it could neither use nor delete', async () => {
    const s = await createSession();
    cf.relayStatus = 502;
    cf.deleteStatus = 500;
    expect((await publish(s.id, { token: s.token })).res.status).toBe(503);

    // The input still exists at Cloudflare, and the row says which one.
    const row = rowOf(s.id);
    expect(cf.inputs.size).toBe(1);
    expect(row.cf_input_uid).toBe([...cf.inputs.keys()][0]);
    expect(row.status).toBe('created');
    expect(row.publish_lock).toBeNull();

    // The next attempt deletes it first.
    cf.relayStatus = 201;
    cf.deleteStatus = 200;
    expect((await publish(s.id, { token: s.token })).res.status).toBe(201);
    expect(cf.inputs.size).toBe(1);
    expect(rowOf(s.id).cf_input_uid).toBe([...cf.inputs.keys()][0]);
  });

  it('deletes an input that Cloudflare created but returned in an unusable form', async () => {
    const s = await createSession();
    cf.createBody = (i) => ({
      uid: i.uid,
      webRTC: { url: 'https://evil.example/publish' },
      webRTCPlayback: { url: `${STREAM_HOST}/${i.uid}/webRTC/play` }
    });
    const { res } = await publish(s.id, { token: s.token });
    expect(res.status).toBe(503);
    expect(cf.inputs.size).toBe(0);
    expect(cf.calls.filter((c) => c === 'relay')).toEqual([]);
  });

  it('answers try-again without taking the lock when Stream is not configured', async () => {
    const s = await createSession();
    for (const env of [
      { CF_STREAM_API_TOKEN: undefined },
      { CF_STREAM_API_TOKEN: '  ' },
      { CF_STREAM_ACCOUNT_ID: undefined },
      { CF_STREAM_ACCOUNT_ID: 'not-an-account' }
    ]) {
      const saved = { ...platformEnv };
      platformEnv = { ...platformEnv, ...env };
      const { res, data } = await publish(s.id, { token: s.token });
      expect(res.status).toBe(503);
      expect(data).toEqual({ error: 'stream_unavailable', retry: true });
      platformEnv = saved;
    }
    expect(cf.calls).toEqual([]);
    expect(rowOf(s.id).reconnects).toBe(0);
  });

  it('honours a fresh lock and takes over a lock older than 30 seconds', async () => {
    const s = await createSession();
    const now = Math.floor(Date.now() / 1000);
    const hold = db.raw.prepare(
      'UPDATE live_sessions SET publish_lock = ?, publish_lock_at = ? WHERE id = ?'
    );

    hold.run('someone-else', now - 10, s.id);
    const busy = await publish(s.id, { token: s.token });
    expect(busy.res.status).toBe(409);
    expect(busy.data).toEqual({ error: 'publish_in_progress', retry: true });
    expect(cf.calls).toEqual([]);

    hold.run('someone-else', now - 31, s.id);
    expect((await publish(s.id, { token: s.token })).res.status).toBe(201);
    expect(rowOf(s.id).publish_lock).toBeNull();
  });

  it('an End that lands mid-publish wins: nothing is left live', async () => {
    const s = await createSession();
    let open!: () => void;
    cf.relayGate = new Promise<void>((resolve) => (open = resolve));

    const publishing = publish(s.id, { token: s.token });
    // Wait until the publish is parked inside the relay call.
    while (!cf.calls.includes('relay')) await new Promise((r) => setTimeout(r, 1));
    const ended = await end(s.id, s.token);
    expect(ended.res.status).toBe(200);
    open();

    const { res, data } = await publishing;
    expect(res.status).toBe(409);
    expect(data).toEqual({ error: 'ended' });
    expect(cf.inputs.size).toBe(0);
    const row = rowOf(s.id);
    expect(row.status).toBe('ended');
    expect(row.cf_input_uid).toBeNull();
    expect(row.cf_play_url).toBeNull();
  });

  it('stops at the publish attempt limit', async () => {
    const s = await createSession();
    db.raw.prepare('UPDATE live_sessions SET reconnects = 30 WHERE id = ?').run(s.id);
    const { res, data } = await publish(s.id, { token: s.token });
    expect(res.status).toBe(429);
    expect(data).toEqual({ error: 'publish_limit' });
    expect(cf.calls).toEqual([]);
  });

  it('answers try-again when the database fails mid-publish', async () => {
    const s = await createSession();
    const realPrepare = db.prepare.bind(db);
    let armed = false;
    (db as any).prepare = (sql: string) => {
      if (armed && sql.includes('SET cf_input_uid = ?3')) throw new Error('D1_ERROR: boom');
      return realPrepare(sql);
    };
    armed = true;
    const { res, data } = await publish(s.id, { token: s.token });
    expect(res.status).toBe(503);
    expect(data).toEqual({ error: 'stream_unavailable', retry: true });
    expect(rowOf(s.id).status).toBe('created');
  });
});

describe('POST /api/live/<id>/end with a live input', () => {
  it('deletes the live input and ends the session', async () => {
    const s = await createSession();
    await publish(s.id, { token: s.token });
    expect(cf.inputs.size).toBe(1);

    const { res, data } = await end(s.id, s.token);
    expect(res.status).toBe(200);
    expect(data).toEqual({ id: s.id, status: 'ended' });
    expect(cf.inputs.size).toBe(0);
    const row = rowOf(s.id);
    expect(row.status).toBe('ended');
    expect(row.cf_input_uid).toBeNull();
    expect(row.cf_play_url).toBeNull();
  });

  it('still ends the session when the delete fails, and keeps the input on record', async () => {
    const s = await createSession();
    await publish(s.id, { token: s.token });
    const uid = rowOf(s.id).cf_input_uid;
    cf.deleteStatus = 500;

    const { res, data } = await end(s.id, s.token);
    expect(res.status).toBe(200);
    expect(data).toEqual({ id: s.id, status: 'ended' });

    const row = rowOf(s.id);
    expect(row.status).toBe('ended');
    expect(row.host_token_hash).toBe('');
    // Nobody new can join, and the sweep can see what is left to delete.
    expect(row.cf_play_url).toBeNull();
    expect(row.cf_input_uid).toBe(uid);
    expect(logged.join('\n')).toContain('left recorded for the sweep');
  });

  it('still ends the session when Stream is not configured', async () => {
    const s = await createSession();
    await publish(s.id, { token: s.token });
    const uid = rowOf(s.id).cf_input_uid;
    platformEnv = { ...platformEnv, CF_STREAM_API_TOKEN: undefined };
    const { res } = await end(s.id, s.token);
    expect(res.status).toBe(200);
    expect(rowOf(s.id).status).toBe('ended');
    expect(rowOf(s.id).cf_input_uid).toBe(uid);
  });

  it('makes no Cloudflare call for a session that never published', async () => {
    const s = await createSession();
    expect((await end(s.id, s.token)).res.status).toBe(200);
    expect(cf.calls).toEqual([]);
  });
});
