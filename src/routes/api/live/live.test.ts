/**
 * Tests for the Go live session routes: create, read, end.
 *
 * NIP-98 runs for real (signed kind-27235 headers). The database is real
 * SQLite running migration 0004 (src/test/liveDatabase.ts), so the partial
 * unique index and the conditional updates behave as they do on D1. The
 * membership lookup and the host list are stubbed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '$lib/nip98';
import { createLiveDatabase } from '../../../test/liveDatabase';

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

import { POST as createRoute, GET as listRoute } from './+server';
import { GET as readRoute } from './[id]/+server';
import { POST as endRoute } from './[id]/end/+server';
import {
  createSession,
  endSession,
  hashHostToken,
  isOneActiveViolation
} from '$lib/live/sessions.server';

const ORIGIN = 'https://zap.cooking';
const CREATE_URL = `${ORIGIN}/api/live`;

const hostSk = generateSecretKey();
const HOST = getPublicKey(hostSk);
const otherSk = generateSecretKey();
const OTHER = getPublicKey(otherSk);
const RECIPE_AUTHOR = getPublicKey(generateSecretKey());

/** Every granular verifier reason — none may ever appear in a response. */
const GRANULAR_REASONS = [
  'missing-header',
  'malformed-header',
  'invalid-signature',
  'wrong-kind',
  'stale-timestamp',
  'url-mismatch',
  'method-mismatch',
  'payload-mismatch',
  'missing-payload-tag',
  'pubkey-mismatch'
];

/** Columns that must never appear in any response. */
const PRIVATE_FIELDS = [
  'host_token_hash',
  'cf_input_uid',
  'cf_play_url',
  'publish_lock',
  'publish_lock_at',
  'guest_joins',
  'cap_refusals',
  'pass_rejoins',
  'disconnected_streak',
  'end_reason'
];

const nowSec = () => Math.floor(Date.now() / 1000);

async function nip98(opts: {
  url: string;
  method?: string;
  body?: string;
  secretKey?: Uint8Array;
}): Promise<string> {
  const tags: string[][] = [
    ['u', normalizeUrl(opts.url)],
    ['method', opts.method ?? 'POST']
  ];
  if (opts.body !== undefined) {
    tags.push(['payload', await sha256Hex(new TextEncoder().encode(opts.body))]);
  }
  const template: EventTemplate = { kind: 27235, created_at: nowSec(), tags, content: '' };
  return `Nostr ${btoa(JSON.stringify(finalizeEvent(template, opts.secretKey ?? hostSk)))}`;
}

let db: ReturnType<typeof createLiveDatabase>;
let platformEnv: Record<string, unknown>;

async function create(
  body: unknown = { title: 'Sunday sourdough' },
  opts: { auth?: string | null; secretKey?: Uint8Array; rawBody?: string } = {}
) {
  const raw = opts.rawBody ?? JSON.stringify(body);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const auth =
    opts.auth === undefined
      ? await nip98({ url: CREATE_URL, body: raw, secretKey: opts.secretKey })
      : opts.auth;
  if (auth) headers.set('Authorization', auth);
  const res = await createRoute({
    request: new Request(CREATE_URL, { method: 'POST', headers, body: raw }),
    platform: { env: platformEnv }
  } as any);
  const text = await res.text();
  return { res, text, data: JSON.parse(text) };
}

async function read(id: string) {
  const res = await readRoute({ params: { id }, platform: { env: platformEnv } } as any);
  const text = await res.text();
  return { res, text, data: JSON.parse(text) };
}

async function end(id: string, opts: { auth?: string | null; url?: string; body?: string } = {}) {
  const url = opts.url ?? `${ORIGIN}/api/live/${id}/end`;
  const headers = new Headers();
  if (opts.auth) headers.set('Authorization', opts.auth);
  const res = await endRoute({
    request: new Request(url, { method: 'POST', headers, body: opts.body }),
    params: { id },
    platform: { env: platformEnv }
  } as any);
  const text = await res.text();
  return { res, text, data: JSON.parse(text) };
}

const rowOf = (id: string) => db.raw.prepare('SELECT * FROM live_sessions WHERE id = ?').get(id);
const rowCount = () => db.raw.prepare('SELECT COUNT(*) AS c FROM live_sessions').get().c as number;

beforeEach(() => {
  db = createLiveDatabase();
  platformEnv = { SCHEDULER_DB: db, MEMBERSHIP_ENABLED: 'true', RELAY_API_SECRET: 'relay-secret' };
  mocks.hosts = [HOST];
  mocks.checkMembership.mockReset().mockResolvedValue({ state: 'active', found: true });
});

describe('migration 0004', () => {
  const sql = readFileSync('migrations/scheduler/0004_create_live_sessions.sql', 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('is additive only: creates, and nothing else', () => {
    expect(sql).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE|INSERT|REPLACE)\b/i);
  });

  it('prefixes every table and index with live_', () => {
    const names = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(\w+)/gi)].map(
      (m) => m[1]
    );
    expect(names.length).toBe(4);
    for (const name of names) expect(name.startsWith('live_')).toBe(true);
    const targets = [...sql.matchAll(/\bON\s+(\w+)\s*\(/gi)].map((m) => m[1]);
    expect(new Set(targets)).toEqual(new Set(['live_sessions']));
  });
});

describe('migration 0005', () => {
  const sql = readFileSync('migrations/scheduler/0005_add_live_pass_rejoins.sql', 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();

  it('only adds pass_rejoins to live_sessions, with a default of 0', () => {
    expect(sql).toBe(
      'ALTER TABLE live_sessions ADD COLUMN pass_rejoins INTEGER NOT NULL DEFAULT 0;'
    );
  });

  it('gives a row created before it 0', () => {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const old = new DatabaseSync(':memory:');
    old.exec(readFileSync('migrations/scheduler/0004_create_live_sessions.sql', 'utf8'));
    old
      .prepare(
        "INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, created_at) VALUES ('a', 'b', 't', 'h', 1)"
      )
      .run();
    old.exec(readFileSync('migrations/scheduler/0005_add_live_pass_rejoins.sql', 'utf8'));
    expect(old.prepare('SELECT pass_rejoins FROM live_sessions').get().pass_rejoins).toBe(0);
  });
});

describe('POST /api/live (create)', () => {
  it('creates a session for an allowed, active-member host', async () => {
    const { res, data } = await create({ title: '  Sunday sourdough  ' });
    expect(res.status).toBe(201);
    expect(Object.keys(data).sort()).toEqual(['host_token', 'id', 'status']);
    expect(data.id).toMatch(/^[0-9a-f]{32}$/);
    expect(data.host_token).toMatch(/^[0-9a-f]{64}$/);
    expect(data.status).toBe('created');

    const row = rowOf(data.id);
    expect(row.host_pubkey).toBe(HOST);
    expect(row.title).toBe('Sunday sourdough');
    expect(row.recipe_a).toBeNull();
    expect(row.status).toBe('created');
    expect(row.cf_input_uid).toBeNull();
    // Only a hash of the token is stored.
    expect(row.host_token_hash).toBe(await hashHostToken(data.host_token));
    expect(JSON.stringify(row)).not.toContain(data.host_token);
  });

  it('takes the host from the signature, never from the body', async () => {
    const { data } = await create({ title: 'Mine', host_pubkey: OTHER, pubkey: OTHER });
    expect(rowOf(data.id).host_pubkey).toBe(HOST);
  });

  it('refuses without a signature, with a coarse 401 that names no granular reason', async () => {
    const attempts = [
      await create(undefined, { auth: null }),
      await create(undefined, { auth: 'Nostr not-base64!' }),
      await create(undefined, {
        auth: await nip98({ url: CREATE_URL, body: '{"title":"other"}' })
      }),
      await create(undefined, { auth: await nip98({ url: CREATE_URL }) }),
      await create(undefined, {
        auth: await nip98({ url: `${ORIGIN}/api/schedule`, body: '{"title":"Sunday sourdough"}' })
      })
    ];
    for (const { res, text, data } of attempts) {
      expect(res.status).toBe(401);
      expect(data.error).toBe('auth_failed');
      for (const reason of GRANULAR_REASONS) expect(text).not.toContain(reason);
    }
    expect(rowCount()).toBe(0);
    expect(mocks.checkMembership).not.toHaveBeenCalled();
  });

  it('refuses a signer who is not on the host list', async () => {
    const { res, data } = await create(undefined, { secretKey: otherSk });
    expect(res.status).toBe(403);
    expect(data).toEqual({ error: 'not_allowed' });
    expect(rowCount()).toBe(0);
    expect(mocks.checkMembership).not.toHaveBeenCalled();
  });

  it('refuses everyone when the host list is empty (the feature is dark)', async () => {
    mocks.hosts = [];
    expect((await create()).res.status).toBe(403);
    expect(rowCount()).toBe(0);
  });

  it('answers 503, not "not a member", when membership cannot be checked', async () => {
    mocks.checkMembership.mockResolvedValue({ state: 'unknown', reason: 'TimeoutError: pantry' });
    const { res, data, text } = await create();
    expect(res.status).toBe(503);
    expect(data).toEqual({ error: 'membership_unavailable' });
    expect(text).not.toContain('membership_required');
    expect(text).not.toContain('pantry');
    expect(rowCount()).toBe(0);
  });

  it('answers 503 when the membership check is not configured', async () => {
    for (const env of [
      { RELAY_API_SECRET: undefined },
      { RELAY_API_SECRET: '   ' },
      { MEMBERSHIP_ENABLED: 'false' }
    ]) {
      platformEnv = { ...platformEnv, ...env };
      const { res, data } = await create();
      expect(res.status).toBe(503);
      expect(data).toEqual({ error: 'membership_unavailable' });
      platformEnv = {
        SCHEDULER_DB: db,
        MEMBERSHIP_ENABLED: 'true',
        RELAY_API_SECRET: 'relay-secret'
      };
    }
    expect(mocks.checkMembership).not.toHaveBeenCalled();
    expect(rowCount()).toBe(0);
  });

  it('answers 403 membership_required only for a real non-member', async () => {
    mocks.checkMembership.mockResolvedValue({
      state: 'inactive',
      found: false,
      reason: 'not-found'
    });
    const { res, data } = await create();
    expect(res.status).toBe(403);
    expect(data).toEqual({ error: 'membership_required' });
    expect(rowCount()).toBe(0);
  });

  it('trims whitespace around secrets before using them', async () => {
    platformEnv = {
      ...platformEnv,
      RELAY_API_SECRET: '  relay-secret\n',
      MEMBERSHIP_ENABLED: ' true \n'
    };
    expect((await create()).res.status).toBe(201);
    expect(mocks.checkMembership).toHaveBeenCalledWith(HOST, 'relay-secret');
  });

  it('rejects a missing, empty, over-long or control-character title', async () => {
    for (const title of [undefined, '', '   ', 'x'.repeat(121), 42, 'two\nlines']) {
      const { res, data } = await create({ title });
      expect(res.status).toBe(400);
      expect(data).toEqual({ error: 'bad_title' });
    }
    expect((await create({ title: 'x'.repeat(120) })).res.status).toBe(201);
  });

  it('rejects a body that is not a JSON object', async () => {
    for (const rawBody of ['', 'not json', '[]', '"title"', 'null']) {
      const { res, data } = await create(undefined, { rawBody });
      expect(res.status).toBe(400);
      expect(data).toEqual({ error: 'bad_request' });
    }
  });

  it("attaches a recipe address, the host's own or another cook's", async () => {
    const own = await create({ title: 'Own', recipe_a: `30023:${HOST}:sourdough-loaf` });
    expect(own.res.status).toBe(201);
    expect(rowOf(own.data.id).recipe_a).toBe(`30023:${HOST}:sourdough-loaf`);
    await end(own.data.id, { auth: `Bearer ${own.data.host_token}` });

    const theirs = await create({
      title: 'Theirs',
      recipe_a: `35000:${RECIPE_AUTHOR.toUpperCase()}:a:b c`
    });
    expect(theirs.res.status).toBe(201);
    // Pubkey normalized to lowercase; a `d` containing ':' and spaces is kept whole.
    expect(rowOf(theirs.data.id).recipe_a).toBe(`35000:${RECIPE_AUTHOR}:a:b c`);
  });

  it('rejects a malformed recipe address', async () => {
    const bad = [
      `1:${HOST}:note`,
      `30023:${HOST}:`,
      `30023:${HOST}`,
      `30023:nothex:slug`,
      `030023:${HOST}:slug`,
      `30023:${HOST}:${'d'.repeat(201)}`,
      12345,
      'naddr1qqxnzd3e'
    ];
    for (const recipe_a of bad) {
      const { res, data } = await create({ title: 'T', recipe_a });
      expect(res.status).toBe(400);
      expect(data).toEqual({ error: 'bad_recipe' });
    }
    expect(rowCount()).toBe(0);
  });

  it('allows one active session per host and reports the existing one', async () => {
    const first = await create();
    const second = await create({ title: 'Another' });
    expect(second.res.status).toBe(409);
    expect(second.data).toEqual({ error: 'already_active', id: first.data.id });
    expect(second.text).not.toContain(first.data.host_token);
    expect(rowCount()).toBe(1);
  });

  it('two simultaneous creates: one 201, one 409, one row', async () => {
    const [a, b] = await Promise.all([create({ title: 'A' }), create({ title: 'B' })]);
    expect([a.res.status, b.res.status].sort()).toEqual([201, 409]);
    expect(rowCount()).toBe(1);
  });

  it('lets a host create again once their session has ended', async () => {
    const first = await create();
    await end(first.data.id, { auth: `Bearer ${first.data.host_token}` });
    expect((await create({ title: 'Round two' })).res.status).toBe(201);
    expect(rowCount()).toBe(2);
  });

  it('limits creates per host per rolling hour, counting ended sessions', async () => {
    const insert = db.raw.prepare(
      "INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at) VALUES (?, ?, 't', '', 'ended', ?)"
    );
    const now = nowSec();
    for (let i = 0; i < 5; i++) insert.run(`${i}`.repeat(32), HOST, now - 60 * (i + 1));
    insert.run('f'.repeat(32), HOST, now - 3 * 3600); // older than the window
    insert.run('e'.repeat(32), OTHER, now - 30); // another host

    const sixth = await create({ title: 'Sixth' });
    expect(sixth.res.status).toBe(201);
    await end(sixth.data.id, { auth: `Bearer ${sixth.data.host_token}` });

    const seventh = await create({ title: 'Seventh' });
    expect(seventh.res.status).toBe(429);
    expect(seventh.data).toEqual({ error: 'rate_limited' });
  });

  it('refuses an oversized body before checking the signature', async () => {
    const big = JSON.stringify({ title: 'x', pad: 'p'.repeat(5000) });
    const call = (headers: Record<string, string>, body: string) =>
      createRoute({
        request: new Request(CREATE_URL, { method: 'POST', headers, body }),
        platform: { env: platformEnv }
      } as any);

    // Declared too large: refused on the header alone, unsigned or signed.
    const declared = await call({ 'Content-Length': '5000' }, '{}');
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({ error: 'too_large' });

    // No usable Content-Length: refused on the byte length. An unsigned
    // request gets 413, not 401, which shows the cap runs before NIP-98.
    const unsigned = await call({}, big);
    expect(unsigned.status).toBe(413);
    const lying = await call({ 'Content-Length': '2' }, big);
    expect(lying.status).toBe(413);

    // A correctly signed oversized body is refused all the same.
    const signed = await call({ Authorization: await nip98({ url: CREATE_URL, body: big }) }, big);
    expect(signed.status).toBe(413);

    expect(rowCount()).toBe(0);
    expect(mocks.checkMembership).not.toHaveBeenCalled();
  });

  it('stops reading a chunked body as soon as it passes the cap', async () => {
    // No Content-Length: 200 chunks of 1 KB offered, the cap is 4 KB.
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 200) controller.close();
        else controller.enqueue(new Uint8Array(1024).fill(120));
      },
      cancel() {
        cancelled = true;
      }
    });
    const res = await createRoute({
      request: new Request(CREATE_URL, { method: 'POST', body: stream, duplex: 'half' } as any),
      platform: { env: platformEnv }
    } as any);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too_large' });
    expect(cancelled).toBe(true);
    // It read just past the cap and stopped, far short of the 200 on offer.
    expect(pulled).toBeLessThan(10);
    expect(rowCount()).toBe(0);
  });

  it('accepts a body just under the cap', async () => {
    const pad = 'p'.repeat(4096 - JSON.stringify({ title: 'Edge', pad: '' }).length);
    const { res } = await create({ title: 'Edge', pad });
    expect(res.status).toBe(201);
  });

  it('reports not_configured when the database is not bound', async () => {
    platformEnv = { MEMBERSHIP_ENABLED: 'true', RELAY_API_SECRET: 'relay-secret' };
    const { res, data } = await create();
    expect(res.status).toBe(500);
    expect(data).toEqual({ error: 'not_configured' });
  });
});

describe('createSession', () => {
  it('reports already_active only for the one-active-session index', async () => {
    const first = await createSession(db, { hostPubkey: HOST, title: 'One', recipeA: null });
    expect(first.ok).toBe(true);
    const second = await createSession(db, { hostPubkey: HOST, title: 'Two', recipeA: null });
    expect(second).toEqual({ ok: false, reason: 'already_active' });
  });

  it('rethrows an id collision instead of calling it already_active', async () => {
    // Force every random draw to the same bytes, so two hosts get the same id.
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf: any) => {
      (buf as Uint8Array).fill(7);
      return buf;
    });
    try {
      const first = await createSession(db, { hostPubkey: HOST, title: 'One', recipeA: null });
      expect(first.ok).toBe(true);
      await expect(
        createSession(db, { hostPubkey: OTHER, title: 'Two', recipeA: null })
      ).rejects.toThrow(/UNIQUE constraint failed: live_sessions\.id/);
    } finally {
      spy.mockRestore();
    }
    expect(rowCount()).toBe(1);
  });

  it('rethrows any other constraint error', async () => {
    await expect(
      createSession(db, { hostPubkey: HOST, title: null as any, recipeA: null })
    ).rejects.toThrow(/NOT NULL constraint failed: live_sessions\.title/);
    expect(rowCount()).toBe(0);
  });

  it('enforces the hourly limit in the insert itself', async () => {
    const insert = db.raw.prepare(
      "INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at) VALUES (?, ?, 't', '', 'ended', ?)"
    );
    const now = nowSec();
    for (let i = 0; i < 6; i++) insert.run(`${i}`.repeat(32), HOST, now - 60 * (i + 1));
    expect(
      await createSession(db, { hostPubkey: HOST, title: 'Seventh', recipeA: null, now })
    ).toEqual({
      ok: false,
      reason: 'rate_limited'
    });
    expect(rowCount()).toBe(6);
    // Another host is unaffected, and the window slides.
    expect(
      (await createSession(db, { hostPubkey: OTHER, title: 'Other', recipeA: null, now })).ok
    ).toBe(true);
    expect(
      (
        await createSession(db, {
          hostPubkey: HOST,
          title: 'Later',
          recipeA: null,
          now: now + 3600
        })
      ).ok
    ).toBe(true);
  });

  it('cannot be raced past the hourly limit by a stale count', async () => {
    // The reviewer's case: five recent ended sessions, then two creates
    // that would both have read "five". Each insert now counts for itself.
    const insert = db.raw.prepare(
      "INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at) VALUES (?, ?, 't', '', 'ended', ?)"
    );
    const now = nowSec();
    for (let i = 0; i < 5; i++) insert.run(`${i}`.repeat(32), HOST, now - 60 * (i + 1));

    const sixth = await createSession(db, { hostPubkey: HOST, title: 'Sixth', recipeA: null, now });
    expect(sixth.ok).toBe(true);
    // The host ends it before the second create's insert runs.
    if (sixth.ok) await endSession(db, sixth.session.id, 'host', now);
    const seventh = await createSession(db, {
      hostPubkey: HOST,
      title: 'Seventh',
      recipeA: null,
      now
    });
    expect(seventh).toEqual({ ok: false, reason: 'rate_limited' });
    expect(rowCount()).toBe(6);
  });

  it('reports already_active, not rate_limited, when both would apply below the limit', async () => {
    const first = await createSession(db, {
      hostPubkey: HOST,
      title: 'One',
      recipeA: null,
      maxPerHour: 2
    });
    expect(first.ok).toBe(true);
    expect(
      await createSession(db, { hostPubkey: HOST, title: 'Two', recipeA: null, maxPerHour: 2 })
    ).toEqual({
      ok: false,
      reason: 'already_active'
    });
  });

  it('recognises the violation message in SQLite and D1 forms, and nothing else', () => {
    const yes = [
      'UNIQUE constraint failed: live_sessions.host_pubkey',
      'D1_ERROR: UNIQUE constraint failed: live_sessions.host_pubkey: SQLITE_CONSTRAINT'
    ];
    const no = [
      'UNIQUE constraint failed: live_sessions.id',
      'D1_ERROR: UNIQUE constraint failed: live_sessions.id: SQLITE_CONSTRAINT',
      'NOT NULL constraint failed: live_sessions.host_pubkey',
      'UNIQUE constraint failed: live_sessions.host_pubkey_other',
      'UNIQUE constraint failed: other_table.host_pubkey',
      'constraint',
      'UNIQUE'
    ];
    for (const m of yes) expect(isOneActiveViolation(new Error(m))).toBe(true);
    for (const m of no) expect(isOneActiveViolation(new Error(m))).toBe(false);
    expect(isOneActiveViolation('UNIQUE constraint failed: live_sessions.host_pubkey')).toBe(false);
  });

  it('turns a rethrown database error into a 500 at the route, not a 409', async () => {
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf: any) => {
      (buf as Uint8Array).fill(9);
      return buf;
    });
    try {
      expect((await create()).res.status).toBe(201);
      mocks.hosts = [HOST, OTHER];
      const clash = await create({ title: 'Clash' }, { secretKey: otherSk });
      expect(clash.res.status).toBe(500);
      expect(clash.data).toEqual({ error: 'internal' });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('GET /api/live/<id> (read)', () => {
  it('returns the public shape and nothing else', async () => {
    const created = await create({
      title: 'Paella night',
      recipe_a: `30023:${RECIPE_AUTHOR}:paella`
    });
    // Fill the columns later PRs use, to prove they are never returned.
    db.raw
      .prepare(
        "UPDATE live_sessions SET cf_input_uid = 'INPUTUIDSECRET', cf_play_url = 'https://customer-x.cloudflarestream.com/INPUTUIDSECRET/webRTC/play', publish_lock = 'LOCKNONCE', publish_lock_at = 1, guest_joins = 7, cap_refusals = 3 WHERE id = ?"
      )
      .run(created.data.id);

    const { res, data, text } = await read(created.data.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(Object.keys(data).sort()).toEqual(
      [
        'created_at',
        'ended_at',
        'host_pubkey',
        'id',
        'recipe_a',
        'started_at',
        'status',
        'title'
      ].sort()
    );
    expect(data).toMatchObject({
      id: created.data.id,
      status: 'created',
      title: 'Paella night',
      recipe_a: `30023:${RECIPE_AUTHOR}:paella`,
      host_pubkey: HOST,
      started_at: null,
      ended_at: null
    });
    for (const field of PRIVATE_FIELDS) expect(text).not.toContain(field);
    for (const secret of [
      'INPUTUIDSECRET',
      'cloudflarestream',
      'LOCKNONCE',
      created.data.host_token,
      rowOf(created.data.id).host_token_hash
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('shows ended once the session has ended', async () => {
    const created = await create();
    await end(created.data.id, { auth: `Bearer ${created.data.host_token}` });
    const { data } = await read(created.data.id);
    expect(data.status).toBe('ended');
    expect(typeof data.ended_at).toBe('number');
  });

  it('answers 404 for an unknown or malformed id', async () => {
    for (const id of ['a'.repeat(32), 'new', '', 'A'.repeat(32), "' OR 1=1 --", 'a'.repeat(33)]) {
      const { res, data } = await read(id);
      expect(res.status).toBe(404);
      expect(data).toEqual({ error: 'not_found' });
    }
  });
});

describe('POST /api/live/<id>/end', () => {
  it('ends the session with the host token and expires the token', async () => {
    const created = await create();
    const { res, data } = await end(created.data.id, { auth: `Bearer ${created.data.host_token}` });
    expect(res.status).toBe(200);
    expect(data).toEqual({ id: created.data.id, status: 'ended' });

    const row = rowOf(created.data.id);
    expect(row.status).toBe('ended');
    expect(row.end_reason).toBe('host');
    expect(typeof row.ended_at).toBe('number');
    expect(row.host_token_hash).toBe('');
  });

  it('is idempotent: a second End changes nothing', async () => {
    const created = await create();
    await end(created.data.id, { auth: `Bearer ${created.data.host_token}` });
    db.raw.prepare('UPDATE live_sessions SET ended_at = 111 WHERE id = ?').run(created.data.id);

    for (const auth of [`Bearer ${created.data.host_token}`, null]) {
      const { res, data } = await end(created.data.id, { auth });
      expect(res.status).toBe(200);
      expect(data).toEqual({ id: created.data.id, status: 'ended' });
    }
    expect(rowOf(created.data.id).ended_at).toBe(111);
  });

  it('refuses a missing, wrong or malformed token', async () => {
    const created = await create();
    const wrong = 'a'.repeat(64);
    for (const auth of [
      null,
      `Bearer ${wrong}`,
      'Bearer short',
      `Basic ${created.data.host_token}`,
      created.data.host_token
    ]) {
      const { res, data } = await end(created.data.id, { auth });
      expect(res.status).toBe(401);
      expect(data.error).toBe('auth_failed');
    }
    expect(rowOf(created.data.id).status).toBe('created');
  });

  it('accepts the token from the Authorization header only', async () => {
    const created = await create();
    const token = created.data.host_token;
    const inUrl = await end(created.data.id, {
      url: `${ORIGIN}/api/live/${created.data.id}/end?token=${token}&host_token=${token}`
    });
    const inBody = await end(created.data.id, {
      body: JSON.stringify({ host_token: token, token })
    });
    expect(inUrl.res.status).toBe(401);
    expect(inBody.res.status).toBe(401);
    expect(rowOf(created.data.id).status).toBe('created');
  });

  it("refuses another session's token", async () => {
    const mine = await create();
    mocks.hosts = [HOST, OTHER];
    const theirs = await create({ title: 'Theirs' }, { secretKey: otherSk });
    const { res } = await end(mine.data.id, { auth: `Bearer ${theirs.data.host_token}` });
    expect(res.status).toBe(401);
    expect(rowOf(mine.data.id).status).toBe('created');
  });

  it('lets the host end it with NIP-98 from another device', async () => {
    const created = await create();
    const url = `${ORIGIN}/api/live/${created.data.id}/end`;
    const { res, data } = await end(created.data.id, { auth: await nip98({ url }) });
    expect(res.status).toBe(200);
    expect(data.status).toBe('ended');
    expect(rowOf(created.data.id).end_reason).toBe('host');
  });

  it('refuses NIP-98 from someone who is not the host', async () => {
    const created = await create();
    const url = `${ORIGIN}/api/live/${created.data.id}/end`;
    const { res, data } = await end(created.data.id, {
      auth: await nip98({ url, secretKey: otherSk })
    });
    expect(res.status).toBe(403);
    expect(data).toEqual({ error: 'not_host' });
    expect(rowOf(created.data.id).status).toBe('created');
  });

  it('refuses a NIP-98 header signed for a different session or method', async () => {
    const created = await create();
    const elsewhere = await end(created.data.id, {
      auth: await nip98({ url: `${ORIGIN}/api/live/${'b'.repeat(32)}/end` })
    });
    const wrongMethod = await end(created.data.id, {
      auth: await nip98({ url: `${ORIGIN}/api/live/${created.data.id}/end`, method: 'GET' })
    });
    for (const { res, text, data } of [elsewhere, wrongMethod]) {
      expect(res.status).toBe(401);
      expect(data.error).toBe('auth_failed');
      for (const reason of GRANULAR_REASONS) expect(text).not.toContain(reason);
    }
    expect(rowOf(created.data.id).status).toBe('created');
  });

  it('refuses an oversized body on the NIP-98 path before any signature work', async () => {
    const created = await create();
    const url = `${ORIGIN}/api/live/${created.data.id}/end`;
    const big = 'x'.repeat(5000);

    // Not even a real signature: the reviewer's case.
    const junk = await end(created.data.id, { auth: 'Nostr invalid', body: big });
    expect(junk.res.status).toBe(413);
    expect(junk.data).toEqual({ error: 'too_large' });

    // A correctly signed oversized body is refused the same way.
    const signed = await end(created.data.id, { auth: await nip98({ url, body: big }), body: big });
    expect(signed.res.status).toBe(413);

    // Chunked, no Content-Length: reading stops just past the 1 KB cap.
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 200) controller.close();
        else controller.enqueue(new Uint8Array(1024).fill(120));
      },
      cancel() {
        cancelled = true;
      }
    });
    const res = await endRoute({
      request: new Request(url, {
        method: 'POST',
        headers: { Authorization: 'Nostr invalid' },
        body: stream,
        duplex: 'half'
      } as any),
      params: { id: created.data.id },
      platform: { env: platformEnv }
    } as any);
    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(10);

    expect(rowOf(created.data.id).status).toBe('created');
  });

  it('never reads the body on the host-token path', async () => {
    const created = await create();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024));
        if (pulled > 50) controller.close();
      }
    });
    const res = await endRoute({
      request: new Request(`${ORIGIN}/api/live/${created.data.id}/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${created.data.host_token}` },
        body: stream,
        duplex: 'half'
      } as any),
      params: { id: created.data.id },
      platform: { env: platformEnv }
    } as any);
    expect(res.status).toBe(200);
    expect(pulled).toBeLessThanOrEqual(1);
    expect(rowOf(created.data.id).status).toBe('ended');
  });

  it('still accepts a small signed body on the NIP-98 path', async () => {
    const created = await create();
    const url = `${ORIGIN}/api/live/${created.data.id}/end`;
    const body = '{}';
    const { res } = await end(created.data.id, { auth: await nip98({ url, body }), body });
    expect(res.status).toBe(200);
  });

  it('answers 404 for an unknown or malformed id', async () => {
    for (const id of ['c'.repeat(32), 'new']) {
      const { res } = await end(id, { auth: `Bearer ${'a'.repeat(64)}` });
      expect(res.status).toBe(404);
    }
  });
});

describe('GET /api/live (list)', () => {
  async function list() {
    const res = await listRoute({ platform: { env: platformEnv } } as any);
    const text = await res.text();
    return { res, text, data: JSON.parse(text) };
  }

  it('lists live sessions only, newest first, in the public shape', async () => {
    const thirdHostSk = generateSecretKey();
    mocks.hosts = [HOST, OTHER, getPublicKey(thirdHostSk)];
    const a = await create({ title: 'Older' });
    const b = await create({ title: 'Newer' }, { secretKey: otherSk });
    const c = await create({ title: 'Not started' }, { secretKey: thirdHostSk });
    db.raw
      .prepare(
        "UPDATE live_sessions SET status = 'live', started_at = ?, cf_input_uid = 'INPUTUIDSECRET', cf_play_url = 'https://customer-x.cloudflarestream.com/INPUTUIDSECRET/webRTC/play', guest_joins = 9 WHERE id = ?"
      )
      .run(1000, a.data.id);
    db.raw
      .prepare("UPDATE live_sessions SET status = 'live', started_at = ? WHERE id = ?")
      .run(2000, b.data.id);

    const { res, data, text } = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=10');
    expect(data.sessions.map((x: any) => x.id)).toEqual([b.data.id, a.data.id]);
    expect(data.sessions.map((x: any) => x.id)).not.toContain(c.data.id);
    expect(Object.keys(data.sessions[0]).sort()).toEqual(
      [
        'created_at',
        'ended_at',
        'host_pubkey',
        'id',
        'recipe_a',
        'started_at',
        'status',
        'title'
      ].sort()
    );
    expect(text).not.toMatch(/INPUTUIDSECRET|cloudflarestream|guest_joins|host_token/);
  });

  it('omits ended sessions', async () => {
    const a = await create({ title: 'Done' });
    db.raw
      .prepare(
        "UPDATE live_sessions SET status = 'ended', started_at = 1, ended_at = 2 WHERE id = ?"
      )
      .run(a.data.id);
    expect((await list()).data.sessions).toEqual([]);
  });

  it('is empty while Go live is switched off', async () => {
    const a = await create({ title: 'Live' });
    db.raw
      .prepare("UPDATE live_sessions SET status = 'live', started_at = 1 WHERE id = ?")
      .run(a.data.id);
    platformEnv.GATED_CONTENT = { get: async (k: string) => (k === 'live:off' ? '1' : null) };
    expect((await list()).data.sessions).toEqual([]);
  });

  it('answers 500 without a database', async () => {
    delete platformEnv.SCHEDULER_DB;
    expect((await list()).res.status).toBe(500);
  });
});
