/**
 * Tests for /api/admin/live/metrics. NIP-98 is real; the admin keys are
 * test keys. Rows go straight into real SQLite (migrations 0004–0010).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '$lib/nip98';
import { createLiveDatabase } from '../../../../../test/liveDatabase';

const mocks = vi.hoisted(() => ({ admin: '', backup: '' }));
vi.mock('$lib/adminAuth', () => ({
  get ADMIN_PUBKEY() {
    return mocks.admin;
  },
  get ADMIN_PUBKEYS() {
    return [mocks.admin, mocks.backup];
  },
  isAdmin: (pk: string | null | undefined) => !!pk && (pk === mocks.admin || pk === mocks.backup)
}));

import { GET, POST } from './+server';
import { dailySeries } from '$lib/live/metricsView';

const URL_ = 'https://zap.cooking/api/admin/live/metrics';
const adminSk = generateSecretKey();
mocks.admin = getPublicKey(adminSk);
const backupSk = generateSecretKey();
mocks.backup = getPublicKey(backupSk);
const strangerSk = generateSecretKey();
const HOST = 'a'.repeat(64);

let db: ReturnType<typeof createLiveDatabase>;

async function nip98(method: string, body: string | undefined, sk: Uint8Array) {
  const tags: string[][] = [
    ['u', normalizeUrl(URL_)],
    ['method', method]
  ];
  if (body !== undefined) tags.push(['payload', await sha256Hex(new TextEncoder().encode(body))]);
  const t: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  };
  return `Nostr ${btoa(JSON.stringify(finalizeEvent(t, sk)))}`;
}

const get = async (sk?: Uint8Array) =>
  GET({
    request: new Request(URL_, {
      headers: sk ? { Authorization: await nip98('GET', undefined, sk) } : {}
    }),
    platform: { env: { SCHEDULER_DB: db } }
  } as any);

const post = async (body: string, sk: Uint8Array = adminSk) =>
  POST({
    request: new Request(URL_, {
      method: 'POST',
      headers: { Authorization: await nip98('POST', body, sk), 'Content-Type': 'application/json' },
      body
    }),
    platform: { env: { SCHEDULER_DB: db } }
  } as any);

function insert(id: string, started: number | null, ended: number | null, status = 'ended') {
  db.raw
    .prepare(
      `INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at, started_at, ended_at)
       VALUES (?, ?, 'Soup', '', ?, ?, ?, ?)`
    )
    .run(id, HOST, status, (started ?? ended ?? 0) - 10, started, ended);
}

beforeEach(() => {
  db = createLiveDatabase();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('GET /api/admin/live/metrics', () => {
  it('refuses anyone but an admin', async () => {
    expect((await get()).status).toBe(403);
    expect((await get(strangerSk)).status).toBe(403);
    expect((await get(backupSk)).status).toBe(200);
  });

  it('returns this and last month, 30 days of streams and the waiting count', async () => {
    const now = Math.floor(Date.now() / 1000);
    insert('1'.repeat(32), now - 3600, now - 600);
    insert('2'.repeat(32), now - 40 * 86400, now - 40 * 86400 + 600); // older than 30 days
    insert('3'.repeat(32), null, now - 100); // never live
    db.raw
      .prepare(
        `INSERT INTO live_host_monthly (host_pubkey, month, streams, updated_at) VALUES (?, '2001-01', 9, 1)`
      )
      .run(HOST);
    const res = await get(adminSk);
    const data = await res.json();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(data.this_month).toMatch(/^\d{4}-\d{2}$/);
    expect(data.monthly).toEqual([]); // 2001-01 is neither month
    expect(data.streams.map((s: { id: string }) => s.id)).toEqual(['1'.repeat(32)]);
    expect(data.streams[0]).toMatchObject({ viewer_seconds: null, metrics_at: null });
    expect(data.waiting).toBe(3); // every ended session not recorded, never-started included
    expect(data.usd_per_1000_minutes).toBe(1);
  });
});

describe('draining the queue', () => {
  it('records the whole backlog in one press, not 5', async () => {
    const now = Math.floor(Date.now() / 1000);
    // Twelve never-started sessions: nothing to read, so all can be recorded.
    for (let i = 0; i < 12; i++) insert(i.toString(16).padStart(32, 'c'), null, now - 600 - i);
    const res = await post(JSON.stringify({ action: 'record' }));
    expect(await res.json()).toEqual({ recorded: 12, gaveUp: 0, retry: 0, waiting: 0 });
    expect((await (await get(adminSk)).json()).waiting).toBe(0);
  });
});

describe('the 30-day window', () => {
  it("starts at 00:00 UTC of the charts' first day, so table, CSV and charts hold the same streams", async () => {
    const now = Math.floor(Date.now() / 1000);
    const firstDay = Math.floor(now / 86400) * 86400 - 29 * 86400;
    insert('a'.repeat(32), firstDay + 60, firstDay + 600); // early on the first charted day
    insert('b'.repeat(32), firstDay - 60, firstDay + 600); // the day before: not charted, not listed
    const data = await (await get(adminSk)).json();
    expect(data.since).toBe(firstDay);
    expect(data.streams.map((s: { id: string }) => s.id)).toEqual(['a'.repeat(32)]);
    expect(dailySeries(data.streams, now, 1)[0].streams).toBe(1);
    expect(data.truncated).toBe(false);
  });
});

describe('POST /api/admin/live/metrics', () => {
  it('records ended streams now', async () => {
    const now = Math.floor(Date.now() / 1000);
    insert('1'.repeat(32), now - 3600, now - 600);
    const res = await post(JSON.stringify({ action: 'record' }));
    // No presence binding in the test: the object reads as unreachable, so
    // the stream waits (it ended 10 minutes ago, under the 1-hour give-up).
    expect(await res.json()).toEqual({ recorded: 0, gaveUp: 0, retry: 1, waiting: 1 });
  });

  it('records a never-started stream and refuses other actions and strangers', async () => {
    insert('3'.repeat(32), null, Math.floor(Date.now() / 1000) - 600);
    expect(await (await post(JSON.stringify({ action: 'record' }))).json()).toMatchObject({
      recorded: 1
    });
    expect((await post(JSON.stringify({ action: 'drop' }))).status).toBe(400);
    expect((await post(JSON.stringify({ action: 'record' }), strangerSk)).status).toBe(403);
  });
});
