/**
 * Tests for the Go live play relay and guest cap.
 *
 * Sessions are made live through the real create and publish routes.
 * Cloudflare is a stub at global fetch that returns the real shapes: the
 * play (WHEP) reply carries Location (with the input id in it), ETag and
 * Link headers, none of which may be forwarded. The database is real
 * SQLite running migration 0004. NIP-98 is real.
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
import { POST as endRoute } from '../end/+server';
import { POST as publishRoute } from '../publish/+server';
import { POST as joinRoute } from './+server';

const ORIGIN = 'https://zap.cooking';
const ACCOUNT = '2d2f9386809ef6f9cda581aa16dff31c';
const STREAM_HOST = 'https://customer-abc123.cloudflarestream.com';
const HOST_OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
const VIEWER_OFFER =
  'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\na=candidate:1 1 udp 1 198.51.100.23 6000 typ host VIEWER-PRIVATE-ADDRESS\r\n';
const PLAY_ANSWER = 'v=0\r\no=- 8 8 IN IP4 0.0.0.0\r\na=ice-ufrag:wxyz PLAY-ANSWER-MARKER\r\n';

const hostSk = generateSecretKey();
const HOST = getPublicKey(hostSk);
const memberSk = generateSecretKey();
const MEMBER = getPublicKey(memberSk);
const strangerSk = generateSecretKey();
const STRANGER = getPublicKey(strangerSk);

// ── Cloudflare stub ─────────────────────────────────────────────────
const cf = {
  inputs: new Map<string, { uid: string; secret: string }>(),
  everCreated: [] as { uid: string; secret: string }[],
  plays: [] as { uid: string; body: string; auth: string | null }[],
  playStatus: 201,
  playThrows: false
};
const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');

function installCloudflare() {
  cf.inputs.clear();
  cf.everCreated = [];
  cf.plays = [];
  cf.playStatus = 201;
  cf.playThrows = false;
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
        if (method === 'POST') {
          const fake = { uid: hex(16), secret: hex(20) };
          cf.inputs.set(fake.uid, fake);
          cf.everCreated.push(fake);
          return new Response(
            JSON.stringify({
              success: true,
              result: {
                uid: fake.uid,
                webRTC: { url: `${STREAM_HOST}/${fake.secret}/webRTC/publish` },
                webRTCPlayback: { url: `${STREAM_HOST}/${fake.uid}/webRTC/play` }
              }
            }),
            { status: 200 }
          );
        }
        if (method === 'DELETE') {
          const uid = url.split('/').pop()!;
          const had = cf.inputs.delete(uid);
          return new Response('{}', { status: had ? 200 : 404 });
        }
      }
      if (url.startsWith(STREAM_HOST) && method === 'POST') {
        const [, first, , kind] = new URL(url).pathname.split('/');
        if (kind === 'publish') {
          return new Response('v=0\r\npublish-answer\r\n', {
            status: 201,
            headers: { Location: `/${first}/webRTC/publish/${hex(32)}` }
          });
        }
        if (kind === 'play') {
          if (cf.playThrows) throw new TypeError('network down');
          cf.plays.push({
            uid: first,
            body: new TextDecoder().decode(init.body as Uint8Array),
            auth: new Headers(init.headers).get('Authorization')
          });
          if (!cf.inputs.has(first)) return new Response('404 not found', { status: 404 });
          if (cf.playStatus !== 201) {
            return new Response('409 Conflict: Live broadcast not started yet', {
              status: cf.playStatus
            });
          }
          return new Response(PLAY_ANSWER, {
            status: 201,
            headers: {
              'Content-Type': 'application/sdp',
              Location: `/${first}/webRTC/play/${hex(32)}`,
              ETag: `"${hex(32)}"`,
              Link: '<stun:stun.cloudflare.com:3478>; rel="ice-server"'
            }
          });
        }
      }
      throw new Error(`unexpected fetch ${method} ${url}`);
    })
  );
}

// ── helpers ─────────────────────────────────────────────────────────
let db: ReturnType<typeof createLiveDatabase>;
let platformEnv: Record<string, unknown>;
let logged: string[];

async function nip98(url: string, body: string | undefined, sk: Uint8Array): Promise<string> {
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
  return `Nostr ${btoa(JSON.stringify(finalizeEvent(template, sk)))}`;
}

async function createSession(): Promise<{ id: string; token: string }> {
  const url = `${ORIGIN}/api/live`;
  const body = JSON.stringify({ title: 'Join test' });
  const res = await createRoute({
    request: new Request(url, {
      method: 'POST',
      headers: { Authorization: await nip98(url, body, hostSk) },
      body
    }),
    platform: { env: platformEnv }
  } as any);
  const data = await res.json();
  expect(res.status).toBe(201);
  return { id: data.id, token: data.host_token };
}

async function goLive(s: { id: string; token: string }) {
  const res = await publishRoute({
    request: new Request(`${ORIGIN}/api/live/${s.id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/sdp' },
      body: HOST_OFFER
    }),
    params: { id: s.id },
    platform: { env: platformEnv }
  } as any);
  expect(res.status).toBe(201);
}

async function liveSession() {
  const s = await createSession();
  await goLive(s);
  return s;
}

async function endSession(s: { id: string; token: string }) {
  await endRoute({
    request: new Request(`${ORIGIN}/api/live/${s.id}/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.token}` }
    }),
    params: { id: s.id },
    platform: { env: platformEnv }
  } as any);
}

async function join(
  id: string,
  opts: { auth?: string; body?: string | null; contentType?: string | null } = {}
) {
  const headers = new Headers();
  if (opts.auth) headers.set('Authorization', opts.auth);
  if (opts.contentType !== null) headers.set('Content-Type', opts.contentType ?? 'application/sdp');
  const res = await joinRoute({
    request: new Request(`${ORIGIN}/api/live/${id}/join`, {
      method: 'POST',
      headers,
      body: opts.body === null ? undefined : (opts.body ?? VIEWER_OFFER)
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

const memberAuth = (
  id: string,
  sk: Uint8Array = memberSk,
  body: string | undefined = VIEWER_OFFER
) => nip98(`${ORIGIN}/api/live/${id}/join`, body, sk);

const rowOf = (id: string) => db.raw.prepare('SELECT * FROM live_sessions WHERE id = ?').get(id);

function expectNoLeak(res: Response, text: string) {
  const all = text + JSON.stringify([...res.headers]);
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
  // The host and MEMBER are active members; everyone else is not.
  mocks.checkMembership
    .mockReset()
    .mockImplementation(async (pubkey: string) =>
      pubkey === HOST || pubkey === MEMBER
        ? { state: 'active', found: true }
        : { state: 'inactive', found: false, reason: 'not-found' }
    );
  installCloudflare();
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(
        args
          .map((a) =>
            a instanceof Error
              ? `${a.name}: ${a.message}`
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
  const all = logged.join('\n');
  expect(all).not.toContain('VIEWER-PRIVATE-ADDRESS');
  expect(all).not.toContain('198.51.100.23');
  expect(all).not.toContain('PLAY-ANSWER-MARKER');
  expect(all).not.toMatch(/cloudflarestream|webRTC\//i);
  for (const key of [MEMBER, STRANGER]) expect(all).not.toContain(key);
  for (const fake of cf.everCreated) {
    expect(all).not.toContain(fake.uid);
    expect(all).not.toContain(fake.secret);
  }
  vi.restoreAllMocks();
});

describe('POST /api/live/<id>/join', () => {
  it('lets anyone watch: relays the offer and returns the status and the SDP answer only', async () => {
    const s = await liveSession();
    const before = rowOf(s.id);
    const { res, text } = await join(s.id);

    expect(res.status).toBe(201);
    expect(text).toBe(PLAY_ANSWER);
    expect([...res.headers.keys()].sort()).toEqual(['cache-control', 'content-type']);
    expect(res.headers.get('Content-Type')).toBe('application/sdp');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expectNoLeak(res, text);

    // The offer reached the session's own input unchanged, with no credential attached.
    expect(cf.plays).toEqual([{ uid: before.cf_input_uid, body: VIEWER_OFFER, auth: null }]);
  });

  it('stores nothing about the viewer: one integer changes and that is all', async () => {
    const s = await liveSession();
    const before = rowOf(s.id);
    const tables = () =>
      db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    const tablesBefore = tables();

    await join(s.id);
    await join(s.id, { auth: await memberAuth(s.id, strangerSk) });

    const after = rowOf(s.id);
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    expect(changed).toEqual(['guest_joins']);
    expect(after.guest_joins).toBe(2);
    expect(tables()).toEqual(tablesBefore);
    expect(db.raw.prepare('SELECT COUNT(*) AS c FROM live_sessions').get().c).toBe(1);
    expect(JSON.stringify(after)).not.toContain(STRANGER);
  });

  it('answers not_live (try again) before the host has gone live', async () => {
    const s = await createSession();
    const { res, data } = await join(s.id);
    expect(res.status).toBe(409);
    expect(data).toEqual({ error: 'not_live', retry: true });
    expect(res.headers.get('Retry-After')).toBe('2');
    expect(cf.plays).toEqual([]);
    expect(rowOf(s.id).guest_joins).toBe(0);
  });

  it('answers 410 for an ended session and 404 for an unknown id', async () => {
    const s = await liveSession();
    await endSession(s);
    const ended = await join(s.id);
    expect(ended.res.status).toBe(410);
    expect(ended.data).toEqual({ error: 'ended' });
    for (const id of ['d'.repeat(32), 'new', '']) expect((await join(id)).res.status).toBe(404);
    expect(cf.plays).toEqual([]);
  });

  it('validates the offer before counting anyone or calling Cloudflare', async () => {
    const s = await liveSession();
    const cases: [Parameters<typeof join>[1], number, string][] = [
      [{ contentType: 'application/json' }, 415, 'unsupported_media_type'],
      [{ contentType: null }, 415, 'unsupported_media_type'],
      [{ body: 'x'.repeat(33 * 1024) }, 413, 'too_large'],
      [{ body: null }, 400, 'bad_offer'],
      [{ body: '{"sdp":"v=0"}' }, 400, 'bad_offer']
    ];
    for (const [opts, status, error] of cases) {
      const { res, data } = await join(s.id, opts);
      expect(res.status).toBe(status);
      expect(data.error).toBe(error);
    }
    expect(cf.plays).toEqual([]);
    expect(rowOf(s.id).guest_joins).toBe(0);
  });

  it('stops reading a chunked offer as soon as it passes the cap', async () => {
    const s = await liveSession();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 500) controller.close();
        else controller.enqueue(new Uint8Array(1024).fill(120));
      }
    });
    const res = await joinRoute({
      request: new Request(`${ORIGIN}/api/live/${s.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: stream,
        duplex: 'half'
      } as any),
      params: { id: s.id },
      platform: { env: platformEnv }
    } as any);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(40);
  });
});

describe('guest cap', () => {
  it('admits guests up to the cap, then answers full and counts the refusal', async () => {
    platformEnv.LIVE_GUEST_CAP = '2';
    const s = await liveSession();
    expect((await join(s.id)).res.status).toBe(201);
    expect((await join(s.id)).res.status).toBe(201);

    const third = await join(s.id);
    expect(third.res.status).toBe(403);
    expect(third.data).toEqual({ error: 'full' });
    expectNoLeak(third.res, third.text);
    await join(s.id);

    const row = rowOf(s.id);
    expect(row.guest_joins).toBe(2);
    expect(row.cap_refusals).toBe(2);
    // The refused guests never reached Cloudflare.
    expect(cf.plays.length).toBe(2);
  });

  it('defaults to 200', async () => {
    const s = await liveSession();
    db.raw.prepare('UPDATE live_sessions SET guest_joins = 199 WHERE id = ?').run(s.id);
    expect((await join(s.id)).res.status).toBe(201);
    expect((await join(s.id)).res.status).toBe(403);
    expect(rowOf(s.id).guest_joins).toBe(200);
  });

  it('two guests arriving at the last slot: exactly one gets in', async () => {
    platformEnv.LIVE_GUEST_CAP = '5';
    const s = await liveSession();
    db.raw.prepare('UPDATE live_sessions SET guest_joins = 4 WHERE id = ?').run(s.id);
    const results = await Promise.all([join(s.id), join(s.id), join(s.id)]);
    expect(results.map((r) => r.res.status).sort()).toEqual([201, 403, 403]);
    expect(rowOf(s.id).guest_joins).toBe(5);
    expect(rowOf(s.id).cap_refusals).toBe(2);
  });

  it('counts per session: a host reconnect does not reset it', async () => {
    platformEnv.LIVE_GUEST_CAP = '2';
    const s = await liveSession();
    await join(s.id);
    await join(s.id);
    const firstInput = rowOf(s.id).cf_input_uid;

    await goLive(s); // reconnect: new input
    expect(rowOf(s.id).cf_input_uid).not.toBe(firstInput);
    expect(rowOf(s.id).guest_joins).toBe(2);
    expect((await join(s.id)).res.status).toBe(403);
  });

  it('after a reconnect, a join goes to the new input', async () => {
    const s = await liveSession();
    await goLive(s);
    const current = rowOf(s.id).cf_input_uid;
    expect((await join(s.id)).res.status).toBe(201);
    expect(cf.plays.at(-1)!.uid).toBe(current);
  });

  it('never counts a confirmed member, and admits them at a full cap', async () => {
    platformEnv.LIVE_GUEST_CAP = '1';
    const s = await liveSession();
    expect((await join(s.id)).res.status).toBe(201);
    expect((await join(s.id)).res.status).toBe(403);

    for (let i = 0; i < 3; i++) {
      const { res, text } = await join(s.id, { auth: await memberAuth(s.id) });
      expect(res.status).toBe(201);
      expect(text).toBe(PLAY_ANSWER);
    }
    const row = rowOf(s.id);
    expect(row.guest_joins).toBe(1);
    expect(row.cap_refusals).toBe(1);
    expect(mocks.checkMembership).toHaveBeenCalledWith(MEMBER, 'relay-secret');
  });

  it('admits the host as a member too', async () => {
    platformEnv.LIVE_GUEST_CAP = '0';
    const s = await liveSession();
    expect((await join(s.id)).res.status).toBe(403);
    expect((await join(s.id, { auth: await memberAuth(s.id, hostSk) })).res.status).toBe(201);
    expect(rowOf(s.id).guest_joins).toBe(0);
  });

  it('treats a signed non-member as a guest', async () => {
    platformEnv.LIVE_GUEST_CAP = '1';
    const s = await liveSession();
    expect((await join(s.id, { auth: await memberAuth(s.id, strangerSk) })).res.status).toBe(201);
    expect(rowOf(s.id).guest_joins).toBe(1);
    expect((await join(s.id, { auth: await memberAuth(s.id, strangerSk) })).res.status).toBe(403);
  });

  it('treats a member whose membership cannot be checked as a guest', async () => {
    platformEnv.LIVE_GUEST_CAP = '1';
    const s = await liveSession();
    mocks.checkMembership.mockResolvedValue({ state: 'unknown', reason: 'TimeoutError: pantry' });
    // Admitted while there is room, counted as a guest...
    expect((await join(s.id, { auth: await memberAuth(s.id) })).res.status).toBe(201);
    expect(rowOf(s.id).guest_joins).toBe(1);
    // ...and refused like any guest once it is full. Never an error.
    const full = await join(s.id, { auth: await memberAuth(s.id) });
    expect(full.res.status).toBe(403);
    expect(full.data).toEqual({ error: 'full' });
  });

  it('treats a member as a guest when the membership check is not configured or throws', async () => {
    platformEnv.LIVE_GUEST_CAP = '0';
    const s = await liveSession();
    mocks.checkMembership.mockClear();
    for (const env of [
      { RELAY_API_SECRET: undefined },
      { RELAY_API_SECRET: '  ' },
      { MEMBERSHIP_ENABLED: 'false' }
    ]) {
      const saved = { ...platformEnv };
      platformEnv = { ...platformEnv, ...env };
      expect((await join(s.id, { auth: await memberAuth(s.id) })).res.status).toBe(403);
      platformEnv = saved;
    }
    expect(mocks.checkMembership).not.toHaveBeenCalled();
    mocks.checkMembership.mockRejectedValue(new Error('boom'));
    expect((await join(s.id, { auth: await memberAuth(s.id) })).res.status).toBe(403);
  });

  it('treats a bad signature as a guest, not an error', async () => {
    platformEnv.LIVE_GUEST_CAP = '0';
    const s = await liveSession();
    const elsewhere = await nip98(
      `${ORIGIN}/api/live/${'e'.repeat(32)}/join`,
      VIEWER_OFFER,
      memberSk
    );
    const attempts = [
      'Nostr not-base64!',
      'Nostr ' + btoa('{"kind":27235}'),
      await memberAuth(s.id, memberSk, 'v=0 a different body'), // signed for other bytes
      // No payload tag. (Called directly: passing `undefined` to memberAuth
      // would fall back to its default body and produce a valid signature.)
      await nip98(`${ORIGIN}/api/live/${s.id}/join`, undefined, memberSk),
      elsewhere, // signed for another session
      `Bearer ${s.token}` // the host token is not a membership credential
    ];
    for (const [i, auth] of attempts.entries()) {
      const { res, data } = await join(s.id, { auth });
      expect(`case ${i}: ${res.status}`).toBe(`case ${i}: 403`);
      expect(data).toEqual({ error: 'full' });
    }
    expect(mocks.checkMembership.mock.calls.some((call: unknown[]) => call[0] === MEMBER)).toBe(
      false
    );
    // With room, the same bad signatures get in as guests.
    platformEnv.LIVE_GUEST_CAP = '10';
    expect((await join(s.id, { auth: 'Nostr not-base64!' })).res.status).toBe(201);
    expect(rowOf(s.id).guest_joins).toBe(1);
  });

  it('reads the cap from configuration, trimmed, and falls back to 200 for nonsense', async () => {
    const s = await liveSession();
    const full = async () => (await join(s.id)).res.status === 403;
    const set = db.raw.prepare('UPDATE live_sessions SET guest_joins = ? WHERE id = ?');

    platformEnv.LIVE_GUEST_CAP = ' 3\n';
    set.run(3, s.id);
    expect(await full()).toBe(true);

    for (const nonsense of ['', 'lots', '-5', '3.5', '1e3', '999999', undefined]) {
      platformEnv.LIVE_GUEST_CAP = nonsense;
      set.run(199, s.id);
      expect(await full()).toBe(false); // slot 200 of the default
      expect(await full()).toBe(true);
    }
  });
});

describe('when the relay does not succeed', () => {
  it('gives the guest slot back and says not_live while the broadcast has not started', async () => {
    const s = await liveSession();
    cf.playStatus = 409;
    const { res, data, text } = await join(s.id);
    expect(res.status).toBe(409);
    expect(data).toEqual({ error: 'not_live', retry: true });
    expect(res.headers.get('Retry-After')).toBe('2');
    expect(text).not.toContain('Conflict');
    expect(rowOf(s.id).guest_joins).toBe(0);
  });

  it('gives the slot back and says try again when Cloudflare fails', async () => {
    const s = await liveSession();
    for (const breakIt of [() => (cf.playStatus = 502), () => (cf.playThrows = true)]) {
      cf.playStatus = 201;
      cf.playThrows = false;
      breakIt();
      const { res, data } = await join(s.id);
      expect(res.status).toBe(503);
      expect(data).toEqual({ error: 'stream_unavailable', retry: true });
    }
    expect(rowOf(s.id).guest_joins).toBe(0);
    expect(rowOf(s.id).cap_refusals).toBe(0);
  });

  it('gives the slot back and says offer_rejected when Cloudflare refuses the offer', async () => {
    const s = await liveSession();
    cf.playStatus = 400;
    const { res, data } = await join(s.id);
    expect(res.status).toBe(422);
    expect(data).toEqual({ error: 'offer_rejected' });
    expect(rowOf(s.id).guest_joins).toBe(0);
  });

  it('says not_live when the input has gone at Cloudflare', async () => {
    const s = await liveSession();
    cf.inputs.clear();
    const { res, data } = await join(s.id);
    expect(res.status).toBe(409);
    expect(data).toEqual({ error: 'not_live', retry: true });
    expect(rowOf(s.id).guest_joins).toBe(0);
  });

  it("does not touch the guest count when a member's relay fails", async () => {
    const s = await liveSession();
    await join(s.id);
    cf.playStatus = 502;
    expect((await join(s.id, { auth: await memberAuth(s.id) })).res.status).toBe(503);
    expect(rowOf(s.id).guest_joins).toBe(1);
  });

  it('answers try-again when the database fails', async () => {
    const s = await liveSession();
    const realPrepare = db.prepare.bind(db);
    (db as any).prepare = (sql: string) => {
      if (sql.includes('guest_joins = guest_joins + 1')) throw new Error('D1_ERROR: boom');
      return realPrepare(sql);
    };
    const { res, data } = await join(s.id);
    expect(res.status).toBe(503);
    expect(data).toEqual({ error: 'stream_unavailable', retry: true });
  });
});
