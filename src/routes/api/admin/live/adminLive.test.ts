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
import { approveHosts, createLiveDatabase } from '../../../../test/liveDatabase';
import { createKvFake } from '../../../../test/liveStreamStub';

const mocks = vi.hoisted(() => ({
  checkMembership: vi.fn(),
  admin: ''
}));
vi.mock('$lib/adminAuth', () => ({
  get ADMIN_PUBKEY() {
    return mocks.admin;
  },
  isAdmin: (pubkey: string | null | undefined) => !!pubkey && pubkey === mocks.admin
}));
vi.mock('$lib/membershipApi.server', () => ({ checkMembership: mocks.checkMembership }));

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
const rowOfApproved = (pk: string) =>
  db.raw.prepare('SELECT * FROM live_approved_hosts WHERE pubkey = ?').get(pk);

beforeEach(() => {
  db = createLiveDatabase();
  approveHosts(db, ...HOSTS);
  kv = createKvFake();
  env = {
    SCHEDULER_DB: db,
    GATED_CONTENT: kv,
    MEMBERSHIP_ENABLED: 'true',
    RELAY_API_SECRET: 'relay-secret',
    CF_STREAM_ACCOUNT_ID: ACCOUNT,
    CF_STREAM_API_TOKEN: 'stream-token'
  };
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

describe('host block', () => {
  it('blocks a host: ends its live session, deletes the input, and refuses new creates', async () => {
    const s = await createLive(0);
    const other = await createLive(1);
    const { res, data } = await admin({ action: 'block', pubkey: HOSTS[0].toUpperCase() });
    expect(res.status).toBe(200);
    expect(data).toEqual({ pubkey: HOSTS[0], blocked: true, ended: 1, inputs_pending: 0 });
    expect(rowOf(s.id).status).toBe('ended');
    expect(rowOf(s.id).end_reason).toBe('admin');
    expect(rowOf(s.id).cf_input_uid).toBeNull();
    // Only the blocked host's session ended.
    expect(rowOf(other.id).status).toBe('live');
    expect(cf.inputs.size).toBe(1);

    const url = `${ORIGIN}/api/live`;
    const body = JSON.stringify({ title: 'Again' });
    const again = await createRoute({
      request: new Request(url, {
        method: 'POST',
        headers: { Authorization: await nip98(url, 'POST', body, hostSks[0]) },
        body
      }),
      platform: { env }
    } as any);
    expect(again.status).toBe(403);
    expect(await again.json()).toEqual({ error: 'blocked' });

    const list = await adminList();
    expect(list.data.blocked.map((b: { pubkey: string }) => b.pubkey)).toEqual([HOSTS[0]]);
  });

  it('blocks an account with no session, and is idempotent', async () => {
    expect((await admin({ action: 'block', pubkey: HOSTS[2] })).data.ended).toBe(0);
    expect((await admin({ action: 'block', pubkey: HOSTS[2] })).res.status).toBe(200);
    expect((await adminList()).data.blocked).toHaveLength(1);
  });

  it('unblocks: the host can go live again, and nothing is restarted', async () => {
    const s = await createLive(0);
    await admin({ action: 'block', pubkey: HOSTS[0] });
    const { res, data } = await admin({ action: 'unblock', pubkey: HOSTS[0] });
    expect(res.status).toBe(200);
    expect(data).toEqual({ pubkey: HOSTS[0], blocked: false });
    expect(rowOf(s.id).status).toBe('ended');
    expect((await adminList()).data.blocked).toEqual([]);
    await createLive(0);
  });

  it('rejects a malformed pubkey, and a non-admin', async () => {
    for (const pubkey of [undefined, '', 'npub1abc', 'zz'.repeat(32), 'ab'.repeat(31)]) {
      expect((await admin({ action: 'block', pubkey })).res.status).toBe(400);
    }
    expect((await admin({ action: 'block', pubkey: HOSTS[1] }, { sk: hostSks[0] })).res.status).toBe(
      403
    );
    expect((await adminList()).data.blocked).toEqual([]);
  });
});

describe('staged rollout', () => {
  const tryCreate = async (i: number) => {
    const url = `${ORIGIN}/api/live`;
    const body = JSON.stringify({ title: 'Try' });
    return createRoute({
      request: new Request(url, {
        method: 'POST',
        headers: { Authorization: await nip98(url, 'POST', body, hostSks[i]) },
        body
      }),
      platform: { env }
    } as any);
  };

  it('approves and removes hosts, and logs both with the admin as actor', async () => {
    db.raw.prepare('DELETE FROM live_approved_hosts WHERE pubkey = ?').run(HOSTS[1]);
    expect((await tryCreate(1)).status).toBe(403);

    const added = await admin({ action: 'approve', pubkey: HOSTS[1] });
    expect(added.data).toEqual({ pubkey: HOSTS[1], approved: true, changed: true });
    expect((await adminList()).data.approved.map((a: any) => a.pubkey)).toContain(HOSTS[1]);
    expect(rowOfApproved(HOSTS[1]).added_by).toBe(mocks.admin);
    expect((await tryCreate(1)).status).toBe(201);

    const removed = await admin({ action: 'unapprove', pubkey: HOSTS[1] });
    expect(removed.data).toEqual({ pubkey: HOSTS[1], approved: false, changed: true });

    const log = (await adminList()).data.actions;
    expect(log.map((a: any) => [a.action, a.actor, a.target_pubkey])).toEqual([
      ['unapprove', mocks.admin, HOSTS[1]],
      ['approve', mocks.admin, HOSTS[1]]
    ]);
  });

  it('removing a host does not end their running stream', async () => {
    const s = await createLive(0);
    await admin({ action: 'unapprove', pubkey: HOSTS[0] });
    expect(rowOf(s.id).status).toBe('live');
  });

  it('switches the hosting mode without a deploy, and logs old and new', async () => {
    db.raw.prepare('DELETE FROM live_approved_hosts WHERE pubkey = ?').run(HOSTS[2]);
    expect((await adminList()).data.mode).toBe('approved');
    const { data } = await admin({ action: 'mode', mode: 'members' });
    expect(data).toEqual({ mode: 'members' });
    expect(kv.data.get('live:hosting_mode')).toBe('members');
    expect((await tryCreate(2)).status).toBe(201);
    expect((await adminList()).data.actions[0]).toMatchObject({
      action: 'mode',
      actor: mocks.admin,
      detail: 'approved -> members'
    });
    expect((await admin({ action: 'mode', mode: 'everyone' })).res.status).toBe(400);
  });

  it('says so when the mode cannot be written, and logs nothing', async () => {
    kv.failWrites = true;
    const { res } = await admin({ action: 'mode', mode: 'members' });
    expect(res.status).toBe(503);
    expect((await adminList()).data.actions).toEqual([]);
  });
});

describe('action log', () => {
  it('logs end, block, unblock and off with time and actor', async () => {
    const s = await createLive(0);
    await admin({ action: 'end', id: s.id });
    await admin({ action: 'block', pubkey: HOSTS[1] });
    await admin({ action: 'unblock', pubkey: HOSTS[1] });
    await admin({ action: 'off', on: true });
    const log = (await adminList()).data.actions;
    expect(log.map((a: any) => a.action).sort()).toEqual(['block', 'end', 'off', 'unblock']);
    for (const a of log) {
      expect(a.actor).toBe(mocks.admin);
      expect(a.occurred_at).toBeGreaterThan(1_700_000_000);
    }
    expect(log.find((a: any) => a.action === 'end')).toMatchObject({
      session_id: s.id,
      target_pubkey: HOSTS[0]
    });
  });

  it('flags a reply when the log could not be written; the action still happens', async () => {
    const s = await createLive(0);
    db.raw.exec('DROP TABLE live_actions');
    const { res, data } = await admin({ action: 'end', id: s.id });
    expect(res.status).toBe(200);
    expect(data.logged).toBe(false);
    expect(rowOf(s.id).status).toBe('ended');
  });

  it('logs nothing for a refused (non-admin) call', async () => {
    await admin({ action: 'block', pubkey: HOSTS[1] }, { sk: hostSks[0] });
    expect(db.raw.prepare('SELECT COUNT(*) AS c FROM live_actions').get().c).toBe(0);
  });
});

describe('report hold', () => {
  it('lists a held ended session with its incident, and release clears the hold and is logged', async () => {
    const s = await createLive(0);
    await admin({ action: 'end', id: s.id });
    expect((await adminList()).data.sessions).toEqual([]);

    db.raw
      .prepare(
        "INSERT INTO live_reports (id, session_id, reporter_hash, reason, details, created_at) VALUES ('r1', ?, ?, 'nudity', 'saw it', 5)"
      )
      .run(s.id, 'f'.repeat(64));
    db.raw
      .prepare(
        "INSERT INTO live_holds (session_id, opened_at, status, snapshot_json) VALUES (?, 5, 'open', ?)"
      )
      .run(s.id, JSON.stringify({ title: 'Session 0', host_pubkey: HOSTS[0] }));

    const list = await adminList();
    expect(list.data.sessions).toHaveLength(1);
    expect(list.data.sessions[0]).toMatchObject({ id: s.id, hold_status: 'open' });
    expect(list.data.incidents).toEqual([
      {
        session_id: s.id,
        status: 'open',
        opened_at: 5,
        released_at: null,
        released_by: null,
        title: 'Session 0',
        host_pubkey: HOSTS[0],
        reports: [
          { reason: 'nudity', details: 'saw it', comment_id: null, comment_pubkey: null, created_at: 5 }
        ],
        report_count: 1
      }
    ]);
    // Reporter hashes never leave the server.
    expect(list.text).not.toContain('f'.repeat(64));

    const { data } = await admin({ action: 'release', id: s.id });
    expect(data).toEqual({ id: s.id, released: true });
    const after = await adminList();
    expect(after.data.incidents[0]).toMatchObject({ status: 'released', released_by: mocks.admin });
    expect(after.data.actions[0]).toMatchObject({ action: 'release_hold', session_id: s.id });
    expect((await admin({ action: 'release_hold', id: s.id })).data.released).toBe(false);
    expect((await admin({ action: 'release', id: 'nope' })).res.status).toBe(400);
  });
});

describe('access requests', () => {
  const insertRequest = (id: string, pubkey: string, note = '') =>
    db.raw
      .prepare(
        "INSERT INTO live_access_requests (id, pubkey, note, status, created_at) VALUES (?, ?, ?, 'pending', 10)"
      )
      .run(id, pubkey, note);
  const ID1 = '11111111-1111-4111-8111-111111111111';
  const ID2 = '22222222-2222-4222-8222-222222222222';
  const requestRow = (id: string) =>
    db.raw.prepare('SELECT status, decided_at FROM live_access_requests WHERE id = ?').get(id);

  it('lists pending requests with note and membership', async () => {
    db.raw.prepare('DELETE FROM live_approved_hosts WHERE pubkey = ?').run(HOSTS[1]);
    insertRequest(ID1, HOSTS[1], 'Sunday roasts');
    mocks.checkMembership.mockResolvedValue({ state: 'inactive', found: true });
    const { data } = await adminList();
    expect(data.requests).toEqual([
      {
        id: ID1,
        pubkey: HOSTS[1],
        note: 'Sunday roasts',
        status: 'pending',
        created_at: 10,
        decided_at: null,
        membership: 'inactive'
      }
    ]);
  });

  it('approve adds the account to the approved list, and is logged', async () => {
    db.raw.prepare('DELETE FROM live_approved_hosts WHERE pubkey = ?').run(HOSTS[1]);
    insertRequest(ID1, HOSTS[1]);
    const { data } = await admin({ action: 'approve_request', id: ID1 });
    expect(data).toEqual({ id: ID1, pubkey: HOSTS[1], status: 'approved' });
    expect(requestRow(ID1).status).toBe('approved');
    expect(rowOfApproved(HOSTS[1]).added_by).toBe(mocks.admin);
    const list = await adminList();
    expect(list.data.requests).toEqual([]);
    expect(list.data.actions[0]).toMatchObject({
      action: 'approve',
      actor: mocks.admin,
      target_pubkey: HOSTS[1],
      detail: 'access request'
    });
    expect((await admin({ action: 'approve_request', id: ID1 })).res.status).toBe(409);
  });

  it('decline leaves the approved list alone, and is logged', async () => {
    db.raw.prepare('DELETE FROM live_approved_hosts WHERE pubkey = ?').run(HOSTS[1]);
    insertRequest(ID2, HOSTS[1]);
    const { data } = await admin({ action: 'decline_request', id: ID2 });
    expect(data).toEqual({ id: ID2, pubkey: HOSTS[1], status: 'declined' });
    expect(typeof requestRow(ID2).decided_at).toBe('number');
    expect(rowOfApproved(HOSTS[1])).toBeUndefined();
    expect((await adminList()).data.actions[0]).toMatchObject({ action: 'decline', target_pubkey: HOSTS[1] });
  });

  it('a direct approve also closes the pending request', async () => {
    db.raw.prepare('DELETE FROM live_approved_hosts WHERE pubkey = ?').run(HOSTS[1]);
    insertRequest(ID1, HOSTS[1]);
    await admin({ action: 'approve', pubkey: HOSTS[1] });
    expect(requestRow(ID1).status).toBe('approved');
  });

  it('approval is one transaction: if adding the host fails, the request stays pending (review #977)', async () => {
    db.raw.prepare('DELETE FROM live_approved_hosts WHERE pubkey = ?').run(HOSTS[1]);
    insertRequest(ID1, HOSTS[1]);
    db.raw.exec('DROP TABLE live_approved_hosts');
    const { res } = await admin({ action: 'approve_request', id: ID1 });
    expect(res.status).toBe(500);
    expect(requestRow(ID1).status).toBe('pending');
  });

  it('GET ?incident= returns every report of one incident', async () => {
    const s0 = await createLive(0);
    for (let i = 0; i < 3; i++) {
      db.raw
        .prepare(
          "INSERT INTO live_reports (id, session_id, reporter_hash, reason, created_at) VALUES (?, ?, ?, 'spam', ?)"
        )
        .run(`r${i}`, s0.id, String(i).repeat(64), i);
    }
    const res = await GET({
      request: new Request(`${ADMIN_URL}?incident=${s0.id}`, {
        headers: { Authorization: await nip98(`${ADMIN_URL}?incident=${s0.id}`, 'GET', undefined, adminSk) }
      }),
      platform: { env }
    } as any);
    const data = await res.json();
    expect(data.reports).toHaveLength(3);
    expect(JSON.stringify(data)).not.toContain('0'.repeat(64));
  });

  it('refuses a malformed id and a non-admin', async () => {
    insertRequest(ID1, HOSTS[1]);
    expect((await admin({ action: 'approve_request', id: 'nope' })).res.status).toBe(400);
    expect((await admin({ action: 'approve_request', id: ID1 }, { sk: hostSks[1] })).res.status).toBe(403);
    expect(requestRow(ID1).status).toBe('pending');
  });
});

describe('environments share one KV namespace', () => {
  it('preview switches its own off flag and mode, never production’s', async () => {
    env.LIVE_INPUT_PREFIX = 'zc-live-preview-';
    await admin({ action: 'off', on: true });
    await admin({ action: 'mode', mode: 'members' });
    expect(kv.data.get('live:preview:off')).toBe('1');
    expect(kv.data.get('live:preview:hosting_mode')).toBe('members');
    expect(kv.data.has('live:off')).toBe(false);
    expect(kv.data.has('live:hosting_mode')).toBe(false);
  });

  it('production does not read preview keys', async () => {
    kv.data.set('live:preview:off', '1');
    kv.data.set('live:preview:hosting_mode', 'members');
    const list = await adminList();
    expect(list.data.off).toBe(false);
    expect(list.data.mode).toBe('approved');
    await createLive(0); // production create still works
  });

  it('preview does not read production keys', async () => {
    kv.data.set('live:off', '1');
    env.LIVE_INPUT_PREFIX = 'zc-live-preview-';
    expect((await adminList()).data.off).toBe(false);
  });
});

describe('mode display', () => {
  it('reports the mode last switched to (mode_set) even when the KV read is stale', async () => {
    expect((await adminList()).data.mode_set).toBeNull();
    await admin({ action: 'mode', mode: 'members' });
    await admin({ action: 'mode', mode: 'approved' });
    // Simulate a stale KV read at this location: it still says members.
    kv.data.set('live:hosting_mode', 'members');
    const { data } = await adminList();
    expect(data.mode).toBe('members');
    expect(data.mode_set).toBe('approved');
  });

  it('a failed switch is an error reply and leaves mode_set alone', async () => {
    await admin({ action: 'mode', mode: 'members' });
    kv.failWrites = true;
    const { res, data } = await admin({ action: 'mode', mode: 'approved' });
    expect(res.status).toBe(503);
    expect(data).toEqual({ error: 'not_written' });
    kv.failWrites = false;
    expect((await adminList()).data.mode_set).toBe('members');
  });
});

describe('off switch display (off_set)', () => {
  it('reports the last switch from the log, over a stale KV read', async () => {
    expect((await adminList()).data.off_set).toBeNull();
    await admin({ action: 'off', on: true });
    expect((await adminList()).data.off_set).toBe(true);
    await admin({ action: 'off', on: false });
    kv.data.set('live:off', '1'); // a stale read here still says off
    const { data } = await adminList();
    expect(data.off).toBe(true);
    expect(data.off_set).toBe(false);
  });

  it('ignores a switch whose flag could not be written', async () => {
    await admin({ action: 'off', on: false });
    kv.failWrites = true;
    const { data } = await admin({ action: 'off', on: true });
    expect(data.flag_written).toBe(false);
    kv.failWrites = false;
    expect((await adminList()).data.off_set).toBe(false);
  });
});
