/**
 * Tests for the pre-signed "ended" announcement routes, and for the End
 * route publishing it. Real SQLite (migration 0011), real signatures.
 * The global WebSocket is a scripted fake and LIVE_ENDED_RELAYS points
 * at a made-up address: nothing here opens a connection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { createLiveDatabase } from '../../../../../test/liveDatabase';
import { endedTwinTemplate, type SignedEvent } from '$lib/live/endedEvent';
import { liveAnnouncementTemplate } from '$lib/live/liveNote';
import { hashHostToken } from '$lib/live/sessions.server';
import { DELETE, GET, POST } from './+server';
import { POST as endRoute } from '../end/+server';

const ORIGIN = 'https://zap.cooking';
const ID = 'ab'.repeat(16);
const TOKEN = 'f'.repeat(64);
const TEST_RELAY = 'ws://relay.test';
const hostSk = generateSecretKey();
const HOST = getPublicKey(hostSk);
const now = () => Math.floor(Date.now() / 1000);

let db: ReturnType<typeof createLiveDatabase>;
let sockets: { url: string; sent: any[] }[];
let waited: Promise<unknown>[];

function twin(at = now() - 5, sk = hostSk): SignedEvent {
  const live = liveAnnouncementTemplate(
    {
      sessionId: ID,
      name: 'Sunday roast',
      hostPubkey: HOST,
      joinUrl: `${ORIGIN}/api/live/${ID}/join`,
      watchUrl: `${ORIGIN}/live/s/${ID}`,
      startedAt: at - 60,
      status: 'live'
    },
    at * 1000
  );
  return JSON.parse(JSON.stringify(finalizeEvent(endedTwinTemplate(live) as never, sk)));
}

const platform = () =>
  ({
    env: { SCHEDULER_DB: db, LIVE_ENDED_RELAYS: TEST_RELAY },
    ctx: { waitUntil: (p: Promise<unknown>) => void waited.push(p) }
  }) as never;

async function call(
  handler: any,
  method: string,
  opts: { token?: string | null; body?: unknown; id?: string; path?: string } = {}
) {
  const id = opts.id ?? ID;
  const headers: Record<string, string> = {};
  if (opts.token !== null) headers.Authorization = `Bearer ${opts.token ?? TOKEN}`;
  const res: Response = await handler({
    request: new Request(`${ORIGIN}/api/live/${id}/${opts.path ?? 'ended-event'}`, {
      method,
      headers,
      body:
        opts.body === undefined
          ? undefined
          : typeof opts.body === 'string'
            ? opts.body
            : JSON.stringify(opts.body)
    }),
    params: { id },
    platform: platform()
  });
  return { status: res.status, data: (await res.json()) as any, res };
}
const rowOf = () => db.raw.prepare('SELECT * FROM live_sessions WHERE id = ?').get(ID);

beforeEach(async () => {
  db = createLiveDatabase();
  sockets = [];
  waited = [];
  db.raw
    .prepare(
      `INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at, started_at)
       VALUES (?, ?, 't', ?, 'live', ?, ?)`
    )
    .run(ID, HOST, await hashHostToken(TOKEN), now() - 700, now() - 600);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.stubGlobal(
    'WebSocket',
    class {
      private listeners: Record<string, ((ev: any) => void)[]> = {};
      private record: { url: string; sent: any[] };
      constructor(url: string) {
        this.record = { url, sent: [] };
        sockets.push(this.record);
        queueMicrotask(() => this.fire('open'));
      }
      private fire(type: string, ev: any = {}) {
        (this.listeners[type] ?? []).forEach((l) => l(ev));
      }
      addEventListener(type: string, listener: (ev: any) => void) {
        (this.listeners[type] ??= []).push(listener);
      }
      send(data: string) {
        const event = JSON.parse(data)[1];
        this.record.sent.push(event);
        queueMicrotask(() => this.fire('message', { data: JSON.stringify(['OK', event.id, true, '']) }));
      }
      close() {}
    }
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/live/<id>/ended-event', () => {
  it('holds the host-signed twin, with the host token', async () => {
    const event = twin();
    const { status, data, res } = await call(POST, 'POST', {
      body: { event, relays: ['wss://relay.example.com', 'wss://192.168.0.2'] }
    });
    expect(status).toBe(200);
    expect(data).toEqual({ id: ID, event_id: event.id });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(JSON.parse(rowOf().ended_event)).toEqual(event);
    expect(JSON.parse(rowOf().ended_event_relays)).toEqual(['wss://relay.example.com']);
    expect(sockets).toEqual([]); // held, not published
  });

  it('needs the host token', async () => {
    for (const token of [null, 'e'.repeat(64)]) {
      const { status, data } = await call(POST, 'POST', { token, body: { event: twin() } });
      expect(status).toBe(401);
      expect(data.error).toBe('auth_failed');
    }
    expect(rowOf().ended_event).toBeNull();
  });

  it('refuses what is not this session\'s ended announcement by its host', async () => {
    const other = twin(now() - 5, generateSecretKey());
    const good = twin();
    const cases: [unknown, string][] = [
      [{ event: other }, 'pubkey'],
      [{ event: { ...good, content: 'changed' } }, 'signature'],
      [{ event: { ...good, tags: good.tags.map((t) => (t[0] === 'status' ? ['status', 'live'] : t)) } }, 'status'],
      [{ event: twin(now() + 3600) }, 'future'],
      [{ event: null }, 'shape'],
      [{}, 'shape']
    ];
    for (const [body, detail] of cases) {
      const { status, data } = await call(POST, 'POST', { body });
      expect(status, detail).toBe(400);
      expect(data).toEqual({ error: 'bad_request', detail });
    }
    expect((await call(POST, 'POST', { body: 'not json' })).status).toBe(400);
    expect((await call(POST, 'POST', { body: { event: good, pad: 'x'.repeat(17000) } })).status).toBe(413);
    expect(rowOf().ended_event).toBeNull();
  });

  it('keeps only the newest, and nothing once the session has ended', async () => {
    const first = twin(now() - 50);
    const later = twin(now() - 5);
    expect((await call(POST, 'POST', { body: { event: later } })).status).toBe(200);
    const older = await call(POST, 'POST', { body: { event: first } });
    expect(older.status).toBe(409);
    expect(older.data.error).toBe('not_newer');
    expect(JSON.parse(rowOf().ended_event).id).toBe(later.id);

    db.raw.prepare("UPDATE live_sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(now(), ID);
    const after = await call(POST, 'POST', { body: { event: twin(now()) } });
    expect(after.status).toBe(409);
    expect(after.data.error).toBe('ended');
    expect((await call(POST, 'POST', { id: 'cd'.repeat(16), body: { event: later } })).status).toBe(404);
  });
});

describe('DELETE and GET /api/live/<id>/ended-event', () => {
  it('the host can withdraw it while the session is open', async () => {
    await call(POST, 'POST', { body: { event: twin() } });
    expect((await call(DELETE, 'DELETE', { token: 'e'.repeat(64) })).status).toBe(401);
    expect((await call(DELETE, 'DELETE')).data).toEqual({ id: ID, dropped: true });
    expect(rowOf().ended_event).toBeNull();
    expect((await call(DELETE, 'DELETE')).data).toEqual({ id: ID, dropped: false });
  });

  it('nobody can read it until the session has ended; anyone can after', async () => {
    const event = twin();
    await call(POST, 'POST', { body: { event } });
    for (const token of [null, TOKEN]) {
      expect((await call(GET, 'GET', { token })).status).toBe(404);
    }
    db.raw.prepare("UPDATE live_sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(now(), ID);
    const read = await call(GET, 'GET', { token: null });
    expect(read.status).toBe(200);
    expect(read.data).toEqual({ id: ID, event });
    expect((await call(GET, 'GET', { token: null, id: 'nope' })).status).toBe(404);
  });
});

describe('POST /api/live/<id>/end publishes the held event', () => {
  it('after the reply, to the configured relays, exactly as signed', async () => {
    const event = twin();
    await call(POST, 'POST', { body: { event } });
    const ended = await call(endRoute, 'POST', { path: 'end' });
    expect(ended.status).toBe(200);
    expect(ended.data.status).toBe('ended');
    expect(waited).toHaveLength(1);
    await Promise.all(waited);
    expect(sockets).toEqual([{ url: TEST_RELAY, sent: [event] }]);
    expect(rowOf().ended_publish_state).toBe('published');
    expect(rowOf().end_reason).toBe('host');
  });

  it('ends as before when nothing is held', async () => {
    const ended = await call(endRoute, 'POST', { path: 'end' });
    expect(ended.status).toBe(200);
    await Promise.all(waited);
    expect(sockets).toEqual([]);
    expect(rowOf().ended_publish_state).toBeNull();
  });
});
