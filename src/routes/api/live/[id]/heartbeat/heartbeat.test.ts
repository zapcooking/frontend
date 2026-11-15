/**
 * Tests for the "watching now" routes: heartbeat, watching, stats, and the
 * count on the directory list. The presence Durable Object is the real
 * class from workers/live-presence, run in-process behind a fake namespace.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { createLiveDatabase } from '../../../../../test/liveDatabase';
import { LivePresence } from '../../../../../../workers/live-presence/index';
import { POST as heartbeatRoute } from './+server';
import { GET as watchingRoute } from '../watching/+server';
import { GET as statsRoute } from '../stats/+server';
import { GET as listRoute } from '../../+server';
import { presenceName } from '$lib/live/presence.server';

const ORIGIN = 'https://zap.cooking';
const hostSk = generateSecretKey();
const HOST = getPublicKey(hostSk);
const otherSk = generateSecretKey();
const LIVE = 'a'.repeat(32);
const CREATED = 'b'.repeat(32);
const ENDED = 'c'.repeat(32);
const code = (n: number) => n.toString(16).padStart(32, '0');

let db: ReturnType<typeof createLiveDatabase>;
let objects: Map<string, LivePresence>;
let env: Record<string, unknown>;

function fakeNamespace() {
  return {
    idFromName: (name: string) => name,
    get(id: unknown) {
      const name = id as string;
      if (!objects.has(name)) objects.set(name, new LivePresence());
      const obj = objects.get(name)!;
      return { fetch: (url: string, init?: RequestInit) => obj.fetch(new Request(url, init)) };
    }
  };
}

function insert(id: string, status: string, host = HOST) {
  db.raw
    .prepare(
      `INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at, started_at)
       VALUES (?, ?, 'T', 'x', ?, 1, 1)`
    )
    .run(id, host, status);
}

beforeEach(() => {
  db = createLiveDatabase();
  objects = new Map();
  env = { SCHEDULER_DB: db, LIVE_PRESENCE: fakeNamespace(), LIVE_INPUT_PREFIX: 'zc-live-preview-' };
  insert(LIVE, 'live');
  // One open session per host: the not-yet-live one belongs to someone else.
  insert(CREATED, 'created', getPublicKey(generateSecretKey()));
  insert(ENDED, 'ended');
});

async function beat(id: string, body: unknown, ip = '203.0.113.7') {
  const res = await heartbeatRoute({
    request: new Request(`${ORIGIN}/api/live/${id}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }),
    params: { id },
    platform: { env },
    getClientAddress: () => ip
  } as any);
  return { res, data: await res.json() };
}

const row = (id: string) =>
  db.raw.prepare('SELECT peak_watching, joins FROM live_sessions WHERE id = ?').get(id);

describe('POST /api/live/<id>/heartbeat', () => {
  it('counts distinct codes and raises the stored peak', async () => {
    expect((await beat(LIVE, { code: code(1) })).data).toEqual({ watching: 1 });
    expect((await beat(LIVE, { code: code(1) })).data).toEqual({ watching: 1 });
    expect((await beat(LIVE, { code: code(2) }, '198.51.100.1')).data).toEqual({ watching: 2 });
    expect(row(LIVE).peak_watching).toBe(2);
  });

  it('names the object by environment prefix and session', async () => {
    await beat(LIVE, { code: code(1) });
    expect([...objects.keys()]).toEqual([presenceName('zc-live-preview-', LIVE)]);
    expect(presenceName('zc-live-', LIVE)).not.toBe(presenceName('zc-live-preview-', LIVE));
  });

  it('stores nothing but the peak: no table or column changes besides it', async () => {
    const tables = () =>
      db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    const before = db.raw.prepare('SELECT * FROM live_sessions WHERE id = ?').get(LIVE);
    const tablesBefore = tables();
    await beat(LIVE, { code: code(1) });
    const after = db.raw.prepare('SELECT * FROM live_sessions WHERE id = ?').get(LIVE);
    expect(Object.keys(after).filter((k) => after[k] !== before[k])).toEqual(['peak_watching']);
    expect(tables()).toEqual(tablesBefore);
  });

  it('does not touch the guest cap, the pass ceiling or joins', async () => {
    for (let i = 0; i < 5; i++) await beat(LIVE, { code: code(i) });
    const r = db.raw
      .prepare(
        'SELECT guest_joins, pass_rejoins, cap_refusals, joins FROM live_sessions WHERE id = ?'
      )
      .get(LIVE);
    expect(r).toEqual({ guest_joins: 0, pass_rejoins: 0, cap_refusals: 0, joins: 0 });
  });

  it('makes no object for a session that is not live', async () => {
    expect((await beat(CREATED, { code: code(1) })).res.status).toBe(409);
    expect((await beat(ENDED, { code: code(1) })).res.status).toBe(410);
    expect((await beat('d'.repeat(32), { code: code(1) })).res.status).toBe(404);
    expect((await beat('nope', { code: code(1) })).res.status).toBe(404);
    expect(objects.size).toBe(0);
  });

  it('refuses a bad body', async () => {
    expect((await beat(LIVE, { code: 'short' })).res.status).toBe(400);
    expect((await beat(LIVE, 'not json')).res.status).toBe(400);
    expect((await beat(LIVE, { code: code(1), pad: 'x'.repeat(300) })).res.status).toBe(413);
  });

  it('rate limits one address adding many codes', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await beat(LIVE, { code: code(i) })).res.status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(20).every((s) => s === 429)).toBe(true);
    // Another address still counts.
    expect((await beat(LIVE, { code: code(99) }, '198.51.100.9')).data).toEqual({ watching: 21 });
  });

  it('answers 503 when the presence binding is missing', async () => {
    delete env.LIVE_PRESENCE;
    expect((await beat(LIVE, { code: code(1) })).res.status).toBe(503);
  });
});

describe('GET /api/live/<id>/watching and the list', () => {
  const watching = async (id: string) => {
    const res = await watchingRoute({ params: { id }, platform: { env } } as any);
    return { res, data: await res.json() };
  };

  it('reads the count without adding to it', async () => {
    await beat(LIVE, { code: code(1) });
    expect((await watching(LIVE)).data).toEqual({ watching: 1 });
    expect((await watching(LIVE)).data).toEqual({ watching: 1 });
    expect((await watching(ENDED)).data).toEqual({ watching: null });
    expect((await watching('d'.repeat(32))).res.status).toBe(404);
  });

  it('puts the count on each live session in the list', async () => {
    await beat(LIVE, { code: code(1) });
    await beat(LIVE, { code: code(2) }, '198.51.100.1');
    const res = await listRoute({ platform: { env } } as any);
    const data = await res.json();
    expect(data.sessions.map((s: any) => [s.id, s.watching])).toEqual([[LIVE, 2]]);
  });
});

describe('GET /api/live/<id>/stats', () => {
  async function stats(id: string, sk?: Uint8Array) {
    const url = `${ORIGIN}/api/live/${id}/stats`;
    const headers = new Headers();
    if (sk) {
      const ev = finalizeEvent(
        {
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['u', url],
            ['method', 'GET']
          ],
          content: ''
        },
        sk
      );
      headers.set('Authorization', `Nostr ${btoa(JSON.stringify(ev))}`);
    }
    const res = await statsRoute({
      request: new Request(url, { headers }),
      params: { id },
      platform: { env }
    } as any);
    return { res, data: await res.json() };
  }

  it('gives the host the peak and joins', async () => {
    db.raw
      .prepare('UPDATE live_sessions SET peak_watching = 7, joins = 31 WHERE id = ?')
      .run(ENDED);
    const { res, data } = await stats(ENDED, hostSk);
    expect(res.status).toBe(200);
    expect(data).toEqual({ peak_watching: 7, joins: 31 });
  });

  it('refuses anyone else, and an unsigned request', async () => {
    expect((await stats(ENDED, otherSk)).res.status).toBe(403);
    expect((await stats(ENDED)).res.status).toBe(401);
    expect((await stats('d'.repeat(32), hostSk)).res.status).toBe(404);
  });
});
