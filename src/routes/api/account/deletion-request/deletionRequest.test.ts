/**
 * Unit tests for account deletion requests:
 *   POST/GET /api/account/deletion-request      (member)
 *   GET/POST /api/admin/deletion-requests       (staff)
 *
 * NIP-98 runs for real (signed kind-27235 headers). D1 is a thin
 * adapter over node:sqlite running the checked-in migrations, so the
 * upsert and purge statements are exercised as SQLite executes them,
 * not as a fake interprets them. Stripe is mocked at the module.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from '$lib/nip98';
import { env } from '../../../../test/envMock';

const stripeMock = vi.hoisted(() => ({
  search: vi.fn(),
  update: vi.fn()
}));
// The real admin key is not ours to hold; tests sign as a stand-in admin.
const adminKeys = vi.hoisted(() => ({ sk: new Uint8Array(32).fill(7), pubkey: '' }));
vi.mock('$lib/adminAuth', async () => {
  const { getPublicKey } = await import('nostr-tools');
  adminKeys.pubkey = getPublicKey(adminKeys.sk);
  return { ADMIN_PUBKEY: adminKeys.pubkey };
});
vi.mock('stripe', () => ({
  default: class {
    subscriptions = { search: stripeMock.search, update: stripeMock.update };
  }
}));

// Imported after the mock so the routes' dynamic import('stripe') sees it.
const { POST, GET } = await import('./+server');
const admin = await import('../../admin/deletion-requests/+server');

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

const ENDPOINT = 'https://zap.cooking/api/account/deletion-request';
const ADMIN_ENDPOINT = 'https://zap.cooking/api/admin/deletion-requests';

const sk = generateSecretKey();
const PUBKEY = getPublicKey(sk);
const otherSk = generateSecretKey();
const OTHER_PUBKEY = getPublicKey(otherSk);

const nowSec = () => Math.floor(Date.now() / 1000);

// ── D1 over node:sqlite ─────────────────────────────────────────────

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of [
    'migrations/scheduler/0001_create_scheduled_events.sql',
    'migrations/scheduler/0002_create_account_deletion_requests.sql'
  ]) {
    sqlite.exec(readFileSync(file, 'utf8'));
  }
  const db = {
    sqlite,
    prepare(query: string) {
      const stmt = sqlite.prepare(query);
      return {
        bind(...values: unknown[]) {
          return {
            first: async () => stmt.get(...values) ?? null,
            all: async () => ({ results: stmt.all(...values) }),
            run: async () => ({ meta: { changes: Number(stmt.run(...values).changes) } })
          };
        }
      };
    }
  };
  return db;
}
type Db = ReturnType<typeof d1>;

function scheduleRow(db: Db, id: string, pubkey: string, status: string) {
  db.sqlite
    .prepare(
      `INSERT INTO scheduled_events
         (id, pubkey, kind, publish_at, relay_mode, ciphertext, iv, status, created_at, updated_at)
       VALUES (?, ?, 1, ?, 'all', 'c', 'i', ?, ?, ?)`
    )
    .run(id, pubkey, nowSec() + 3600, status, nowSec(), nowSec());
}

function remainingScheduled(db: Db) {
  return db.sqlite.prepare('SELECT id FROM scheduled_events ORDER BY id').all().map((r: any) => r.id);
}

// ── request builders ────────────────────────────────────────────────

async function nip98Header(opts: {
  url: string;
  method: string;
  body?: string;
  secretKey?: Uint8Array;
}): Promise<string> {
  const tags: string[][] = [
    ['u', normalizeUrl(opts.url)],
    ['method', opts.method]
  ];
  if (opts.body !== undefined) {
    tags.push(['payload', await sha256Hex(new TextEncoder().encode(opts.body))]);
  }
  const template: EventTemplate = { kind: 27235, created_at: nowSec(), tags, content: '' };
  return `Nostr ${btoa(JSON.stringify(finalizeEvent(template, opts.secretKey ?? sk)))}`;
}

const platformFor = (db: Db | null) => ({ env: db ? { SCHEDULER_DB: db } : {} });

async function request(
  db: Db | null,
  body: string,
  opts: { secretKey?: Uint8Array; auth?: string | null } = {}
) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const auth =
    opts.auth === undefined
      ? await nip98Header({ url: ENDPOINT, method: 'POST', body, secretKey: opts.secretKey })
      : opts.auth;
  if (auth) headers.set('Authorization', auth);
  const res = await POST({
    request: new Request(ENDPOINT, { method: 'POST', headers, body }),
    platform: platformFor(db)
  } as any);
  return { res, data: await res.json() };
}

async function status(db: Db, secretKey: Uint8Array = sk) {
  const headers = new Headers({
    Authorization: await nip98Header({ url: ENDPOINT, method: 'GET', secretKey })
  });
  const res = await GET({
    request: new Request(ENDPOINT, { method: 'GET', headers }),
    platform: platformFor(db)
  } as any);
  return { res, data: await res.json() };
}

beforeEach(() => {
  stripeMock.search.mockReset().mockResolvedValue({ data: [] });
  stripeMock.update.mockReset().mockResolvedValue({});
  env.STRIPE_SECRET_KEY = 'sk_test_x';
});

// ── member endpoint ─────────────────────────────────────────────────

describe('POST /api/account/deletion-request', () => {
  it('records a pending request for the NIP-98 signer', async () => {
    const db = d1();
    const { res, data } = await request(db, JSON.stringify({ source: 'ios' }));
    expect(res.status).toBe(202);
    expect(data).toMatchObject({ status: 'pending', billing: 'none', scheduled_posts_removed: 0 });

    const row: any = db.sqlite.prepare('SELECT * FROM account_deletion_requests').get();
    expect(row).toMatchObject({ pubkey: PUBKEY, status: 'pending', source: 'ios', billing: 'none' });
  });

  it('refuses without a valid signature, and records nothing', async () => {
    const db = d1();
    const body = JSON.stringify({});
    for (const auth of [null, 'Nostr garbage']) {
      const { res, data } = await request(db, body, { auth });
      expect(res.status).toBe(401);
      expect(data.error).toBe('auth_failed');
    }
    // A header signed for a different body cannot be replayed onto this one.
    const swapped = await nip98Header({ url: ENDPOINT, method: 'POST', body: '{"source":"web"}' });
    const { res } = await request(db, body, { auth: swapped });
    expect(res.status).toBe(401);

    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM account_deletion_requests').get()).toEqual({ n: 0 });
    expect(stripeMock.search).not.toHaveBeenCalled();
  });

  it('takes identity from the signer, never from the body', async () => {
    const db = d1();
    await request(db, JSON.stringify({ pubkey: OTHER_PUBKEY }));
    const rows = db.sqlite.prepare('SELECT pubkey FROM account_deletion_requests').all();
    expect(rows).toEqual([{ pubkey: PUBKEY }]);
  });

  it('maps an unknown source to other', async () => {
    const db = d1();
    await request(db, JSON.stringify({ source: 'fax' }));
    expect(db.sqlite.prepare('SELECT source FROM account_deletion_requests').get()).toEqual({
      source: 'other'
    });
  });

  it('rejects a body that is not a JSON object', async () => {
    for (const body of ['not json', '[]', 'null']) {
      const { res } = await request(d1(), body);
      expect(res.status).toBe(400);
    }
  });

  it('deletes only the signer’s scheduled posts, and not one mid-broadcast', async () => {
    const db = d1();
    scheduleRow(db, 'a-pending', PUBKEY, 'pending');
    scheduleRow(db, 'b-sent', PUBKEY, 'sent');
    scheduleRow(db, 'c-publishing', PUBKEY, 'publishing');
    scheduleRow(db, 'd-other', OTHER_PUBKEY, 'pending');

    const { data } = await request(db, '{}');
    expect(data.scheduled_posts_removed).toBe(2);
    expect(remainingScheduled(db)).toEqual(['c-publishing', 'd-other']);
  });

  it('stops renewal on renewing subscriptions only', async () => {
    stripeMock.search.mockResolvedValue({
      data: [
        { id: 'sub_active', status: 'active', cancel_at_period_end: false },
        { id: 'sub_already', status: 'active', cancel_at_period_end: true },
        { id: 'sub_gone', status: 'canceled', cancel_at_period_end: false }
      ]
    });
    const { data } = await request(d1(), '{}');
    expect(data.billing).toBe('cancelled');
    expect(stripeMock.search.mock.calls[0][0].query).toBe(`metadata['pubkey']:'${PUBKEY}'`);
    expect(stripeMock.update).toHaveBeenCalledTimes(1);
    expect(stripeMock.update).toHaveBeenCalledWith('sub_active', { cancel_at_period_end: true });
  });

  it('still records the request when Stripe fails, and says so', async () => {
    stripeMock.search.mockRejectedValue(new Error('stripe down'));
    const db = d1();
    const { res, data } = await request(db, '{}');
    expect(res.status).toBe(202);
    expect(data.billing).toBe('error');
    expect(db.sqlite.prepare('SELECT billing FROM account_deletion_requests').get()).toEqual({
      billing: 'error'
    });
  });

  it('reports billing unavailable when Stripe is not configured', async () => {
    delete env.STRIPE_SECRET_KEY;
    const { data } = await request(d1(), '{}');
    expect(data.billing).toBe('unavailable');
    expect(stripeMock.search).not.toHaveBeenCalled();
  });

  it('folds a repeat while pending into one row, keeping the 30-day clock', async () => {
    const db = d1();
    await request(db, '{}');
    db.sqlite.prepare('UPDATE account_deletion_requests SET requested_at = 1').run();
    scheduleRow(db, 'late-post', PUBKEY, 'pending');
    const { res, data } = await request(db, JSON.stringify({ source: 'ios' }));
    expect(res.status).toBe(202);
    expect(data.requested_at).toBe(1);

    const rows: any[] = db.sqlite.prepare('SELECT * FROM account_deletion_requests').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'pending',
      source: 'ios',
      attempts: 2,
      requested_at: 1,
      scheduled_posts_removed: 1
    });
  });

  it('does not cancel a subscription twice across repeats', async () => {
    const sub = { id: 'sub_1', status: 'active', cancel_at_period_end: false };
    stripeMock.search.mockImplementation(async () => ({ data: [{ ...sub }] }));
    stripeMock.update.mockImplementation(async () => {
      sub.cancel_at_period_end = true;
      return {};
    });
    const db = d1();
    expect((await request(db, '{}')).data.billing).toBe('cancelled');
    expect((await request(db, '{}')).data.billing).toBe('cancelled');
    expect(stripeMock.update).toHaveBeenCalledTimes(1);
  });

  it('after completion, a repeat opens a new request and keeps the completed record', async () => {
    const { completeDeletionRequest } = await import('$lib/accountDeletion.server');
    const db = d1();
    await request(db, '{}');
    expect(await completeDeletionRequest(db as any, PUBKEY, 100)).toBe(true);

    // Restored from an exported key, deletes again.
    const { res } = await request(db, '{}');
    expect(res.status).toBe(202);

    const rows: any[] = db.sqlite
      .prepare('SELECT status, completed_at FROM account_deletion_requests ORDER BY id')
      .all();
    expect(rows).toEqual([
      { status: 'completed', completed_at: 100 },
      { status: 'pending', completed_at: null }
    ]);
    expect((await status(db)).data.status).toBe('pending');
  });

  it('500s without a database', async () => {
    const { res } = await request(null, '{}');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/account/deletion-request', () => {
  it('returns the caller’s own request and 404s for anyone else', async () => {
    const db = d1();
    await request(db, '{}');

    const mine = await status(db);
    expect(mine.res.status).toBe(200);
    expect(mine.data).toMatchObject({ status: 'pending', billing: 'none' });

    const theirs = await status(db, otherSk);
    expect(theirs.res.status).toBe(404);
  });
});

// ── admin endpoint ──────────────────────────────────────────────────

describe('/api/admin/deletion-requests', () => {
  async function adminCall(db: Db, method: 'GET' | 'POST', body?: string, secretKey = sk) {
    const headers = new Headers({
      Authorization: await nip98Header({ url: ADMIN_ENDPOINT, method, body, secretKey })
    });
    const handler = method === 'GET' ? admin.GET : admin.POST;
    const res = await handler({
      request: new Request(ADMIN_ENDPOINT, { method, headers, body }),
      url: new URL(ADMIN_ENDPOINT),
      platform: platformFor(db)
    } as any);
    return { res, data: await res.json() };
  }

  it('refuses anyone but the admin pubkey', async () => {
    const db = d1();
    expect((await adminCall(db, 'GET')).res.status).toBe(403);
    expect((await adminCall(db, 'POST', JSON.stringify({ pubkey: PUBKEY }))).res.status).toBe(403);
  });

  it('lists pending requests oldest first and completes one', async () => {
    const { listDeletionRequests, completeDeletionRequest } = await import(
      '$lib/accountDeletion.server'
    );
    const db = d1();
    await request(db, '{}', { secretKey: otherSk });
    db.sqlite.prepare('UPDATE account_deletion_requests SET requested_at = 1').run();
    await request(db, '{}');

    const pending = await listDeletionRequests(db as any, 'pending');
    expect(pending.map((r) => r.pubkey)).toEqual([OTHER_PUBKEY, PUBKEY]);


    // Nothing was cancelled in Stripe (billing 'none'), so both need a human.
    const listed = await adminCall(db, 'GET', undefined, adminKeys.sk);
    expect(listed.res.status).toBe(200);
    expect(listed.data.requests.map((r: any) => r.needs_billing_check)).toEqual([true, true]);

    const done = await adminCall(db, 'POST', JSON.stringify({ pubkey: PUBKEY }), adminKeys.sk);
    expect(done.res.status).toBe(200);
    expect(await completeDeletionRequest(db as any, OTHER_PUBKEY, 5)).toBe(true);
    expect(await completeDeletionRequest(db as any, PUBKEY, 6)).toBe(false);
    expect((await listDeletionRequests(db as any, 'pending'))).toEqual([]);
    expect((await listDeletionRequests(db as any, 'completed'))).toHaveLength(2);
  });
});
