import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../test/fixtures/pow-graphql.json';
import { createGithubClient } from './github.server';
import { FULL_RESYNC_MS, refreshPow } from './refresh.server';
import type { PowKV } from './store.server';
import type { PrRecord } from './types';
import { classifyDelivery, verifySignature } from './webhook.server';
import { POST } from '../../routes/api/pow/webhook/+server';
import { GET as HEAD_GET } from '../../routes/api/pow/head/+server';
import { GET as POW_GET } from '../../routes/api/pow/+server';

const SECRET = 'whsec_TEST_do_not_leak_7f3a';
const TOKEN = 'github_pat_TEST_SECRET_do_not_leak';
const NOW = new Date('2026-09-25T15:00:00Z');
const enc = new TextEncoder();

async function sign(body: Uint8Array | string, secret = SECRET): Promise<string> {
  const bytes = typeof body === 'string' ? enc.encode(body) : body;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  return 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function memoryKV() {
  const data = new Map<string, string>();
  let puts = 0;
  const kv: PowKV = {
    async get(key, type) {
      const v = data.get(key) ?? null;
      return v !== null && type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      puts += 1;
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    }
  };
  return { kv, data, puts: () => puts };
}

/**
 * GitHub for seeding (one PR per repo) and for fetchOne of PR #42 in
 * frontend, merged 2026-09-24 with three files, one of them a lockfile.
 */
function github() {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(init.body as string);
    const op = /query (\w+)/.exec(query)![1];
    calls.push(op);
    if (op === 'PowOnePr') {
      const node = structuredClone(fixture.listPage.data.repository.pullRequests.nodes[0]);
      Object.assign(node, {
        id: 'PR_new42',
        number: variables.number,
        title: 'Merged — via webhook',
        url: 'https://github.com/zapcooking/frontend/pull/42',
        mergedAt: '2026-09-24T20:00:00Z',
        updatedAt: '2026-09-24T20:00:01Z',
        additions: 130,
        deletions: 5,
        files: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { path: 'src/a.ts', additions: 20, deletions: 5 },
            { path: 'pnpm-lock.yaml', additions: 100, deletions: 0 },
            { path: 'src/b.ts', additions: 10, deletions: 0 }
          ]
        }
      });
      return new Response(JSON.stringify({ data: { repository: { pullRequest: node } } }), {
        status: 200
      });
    }
    const page = structuredClone(fixture.listPage);
    const pr = page.data.repository.pullRequests;
    pr.pageInfo.hasNextPage = false;
    pr.nodes = [pr.nodes[0]];
    pr.nodes[0].id = `PR_${variables.name}`;
    return new Response(JSON.stringify(page), { status: 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, spy: fetchImpl, calls };
}

/** KV with a complete summary for one PR per repo. */
async function seeded() {
  const store = memoryKV();
  const gh = github();
  const out = await refreshPow(store.kv, createGithubClient(TOKEN, gh.fetchImpl), NOW);
  expect(out.stored.complete).toBe(true);
  return store;
}

function payload(
  over: {
    action?: string;
    repo?: string;
    owner?: string;
    merged?: boolean;
    mergedAt?: string | null;
    title?: string;
    labels?: string[];
    number?: number;
    nodeId?: string;
  } = {}
) {
  return {
    action: over.action ?? 'closed',
    repository: { name: over.repo ?? 'frontend', owner: { login: over.owner ?? 'zapcooking' } },
    pull_request: {
      node_id: over.nodeId ?? 'PR_new42',
      number: over.number ?? 42,
      title: over.title ?? 'Merged — via webhook',
      merged: over.merged ?? true,
      merged_at: over.mergedAt === undefined ? '2026-09-24T20:00:00Z' : over.mergedAt,
      labels: (over.labels ?? []).map((name) => ({ name }))
    }
  };
}

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('test tried to reach the network');
    })
  );
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function deliver(
  env: Record<string, unknown>,
  body: unknown,
  opts: { event?: string; signature?: string | null; raw?: string; delivery?: string } = {}
) {
  const raw = opts.raw ?? JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-github-event': opts.event ?? 'pull_request',
    'x-github-delivery': opts.delivery ?? '72d3162e-cc78-11e3-81ab-4c9367dc0958'
  };
  const signature = opts.signature === undefined ? await sign(raw) : opts.signature;
  if (signature !== null) headers['x-hub-signature-256'] = signature;
  const waitUntil = vi.fn();
  const res = await (POST({
    request: new Request('https://zap.cooking/api/pow/webhook', {
      method: 'POST',
      headers,
      body: raw
    }),
    platform: { env, ctx: { waitUntil } }
  } as never) as Promise<Response>);
  if (waitUntil.mock.calls[0]) await waitUntil.mock.calls[0][0];
  return { res, waitUntil };
}

describe('verifySignature', () => {
  const body = enc.encode(JSON.stringify(payload()));

  it('accepts the HMAC-SHA256 of the exact bytes', async () => {
    expect(await verifySignature(body, await sign(body), SECRET)).toBe(true);
    expect(await verifySignature(body, (await sign(body)).toUpperCase().replace('SHA256=', 'sha256='), SECRET)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const sig = await sign(body);
    const tampered = body.slice();
    tampered[10] ^= 1;
    expect(await verifySignature(tampered, sig, SECRET)).toBe(false);
  });

  it('rejects the wrong secret', async () => {
    expect(await verifySignature(body, await sign(body, 'not-the-secret'), SECRET)).toBe(false);
  });

  it('rejects a missing header', async () => {
    expect(await verifySignature(body, null, SECRET)).toBe(false);
    expect(await verifySignature(body, '', SECRET)).toBe(false);
  });

  it('rejects a sha1= signature, even a correct one', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
    const sha1 = 'sha1=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await verifySignature(body, sha1, SECRET)).toBe(false);
    // …and a sha256 digest under a sha1= label.
    expect(await verifySignature(body, (await sign(body)).replace('sha256=', 'sha1='), SECRET)).toBe(false);
  });

  it('rejects a length mismatch or non-hex digest', async () => {
    const good = await sign(body);
    expect(await verifySignature(body, good.slice(0, -1), SECRET)).toBe(false); // 63 hex
    expect(await verifySignature(body, good + '0', SECRET)).toBe(false); // 65 hex
    expect(await verifySignature(body, good.slice(0, -2) + 'zz', SECRET)).toBe(false);
    expect(await verifySignature(body, ' ' + good, SECRET)).toBe(false);
  });
});

describe('classifyDelivery', () => {
  it('acts only on merged PRs in allowlisted zapcooking repos', () => {
    expect(classifyDelivery('pull_request', payload())).toMatchObject({
      kind: 'merged',
      repo: 'frontend',
      number: 42
    });
    expect(classifyDelivery('pull_request', payload({ repo: 'member-relay' }))).toMatchObject({
      kind: 'ignore',
      reason: 'repo_not_allowlisted'
    });
    expect(classifyDelivery('pull_request', payload({ owner: 'someone-else' }))).toMatchObject({
      kind: 'ignore',
      reason: 'repo_not_allowlisted'
    });
    expect(
      classifyDelivery('pull_request', payload({ merged: false, mergedAt: null }))
    ).toMatchObject({ kind: 'ignore', reason: 'not_merged' });
    // merged is authoritative even if a merged_at is somehow present.
    expect(classifyDelivery('pull_request', payload({ merged: false }))).toMatchObject({
      kind: 'ignore',
      reason: 'not_merged'
    });
    expect(
      classifyDelivery('pull_request', payload({ mergedAt: '2025-12-31T23:00:00Z' }))
    ).toMatchObject({ kind: 'ignore', reason: 'before_start' });
    expect(classifyDelivery('pull_request', payload({ action: 'opened' }))).toMatchObject({
      kind: 'ignore',
      reason: 'action'
    });
    expect(classifyDelivery('push', payload())).toMatchObject({ kind: 'ignore', reason: 'event' });
    expect(classifyDelivery('ping', {})).toEqual({ kind: 'ping' });
  });

  it('turns edits and label changes on merged PRs into payload patches', () => {
    expect(classifyDelivery('pull_request', payload({ action: 'edited', title: 'New' }))).toMatchObject({
      kind: 'patch',
      id: 'PR_new42',
      patch: { title: 'New' }
    });
    expect(
      classifyDelivery('pull_request', payload({ action: 'labeled', labels: ['a', 'b'] }))
    ).toMatchObject({ kind: 'patch', patch: { labels: ['a', 'b'] } });
    expect(
      classifyDelivery('pull_request', payload({ action: 'unlabeled', labels: [] }))
    ).toMatchObject({ kind: 'patch', patch: { labels: [] } });
    expect(
      classifyDelivery('pull_request', payload({ action: 'edited', merged: false, mergedAt: null }))
    ).toMatchObject({ kind: 'ignore', reason: 'not_merged' });
  });
});

describe('POST /api/pow/webhook', () => {
  it('503s without a secret, 401s (empty) on a bad signature, 200s a ping', async () => {
    const { kv } = memoryKV();
    expect((await deliver({ POW: kv }, payload())).res.status).toBe(503);

    const env = { POW: kv, POW_WEBHOOK_SECRET: SECRET, POW_GITHUB_TOKEN: TOKEN };
    for (const signature of [null, 'sha256=00', await sign('{}')]) {
      const { res } = await deliver(env, payload(), { signature });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe('');
    }
    expect((await deliver(env, { zen: 'hi' }, { event: 'ping' })).res.status).toBe(200);
  });

  it('a validly signed member-relay event is a 204 with no KV write', async () => {
    const store = await seeded();
    const before = store.puts();
    const env = { POW: store.kv, POW_WEBHOOK_SECRET: SECRET, POW_GITHUB_TOKEN: TOKEN };
    const { res, waitUntil } = await deliver(env, payload({ repo: 'member-relay' }));
    expect(res.status).toBe(204);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(store.puts()).toBe(before);
    expect(logs.at(-1)).toMatch(/repo=member-relay .*outcome=ignored_repo_not_allowlisted$/);
  });

  it('an unmerged close is a 204 with no KV write', async () => {
    const store = await seeded();
    const before = store.puts();
    const env = { POW: store.kv, POW_WEBHOOK_SECRET: SECRET, POW_GITHUB_TOKEN: TOKEN };
    const { res } = await deliver(env, payload({ merged: false, mergedAt: null }));
    expect(res.status).toBe(204);
    expect(store.puts()).toBe(before);
  });

  it('a merge is 202, then fetchOne → upsert → recompute → pow:head advances', async () => {
    const store = await seeded();
    const headBefore = JSON.parse(store.data.get('pow:head')!);
    const gh = github();
    vi.stubGlobal('fetch', gh.fetchImpl);
    const env = { POW: store.kv, POW_WEBHOOK_SECRET: SECRET, POW_GITHUB_TOKEN: TOKEN };

    const { res } = await deliver(env, payload());
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
    expect(gh.calls).toEqual(['PowOnePr']);

    const shard = JSON.parse(store.data.get('pow:prs:frontend:2026-09')!) as PrRecord[];
    expect(shard.find((r) => r.id === 'PR_new42')).toMatchObject({
      additions: 130,
      countedAdditions: 30 // the lockfile is excluded
    });
    const head = JSON.parse(store.data.get('pow:head')!);
    expect(head.etag).not.toBe(headBefore.etag);
    expect(JSON.parse(store.data.get('pow:summary')!).etag).toBe(head.etag);
    expect(JSON.parse(JSON.parse(store.data.get('pow:summary')!).body).totals.prs).toBe(4);
    expect(store.data.has('pow:lock')).toBe(false); // released
    expect(logs).toContain(
      '[pow] webhook event=pull_request action=closed repo=frontend pr=42 ' +
        'delivery=72d3162e-cc78-11e3-81ab-4c9367dc0958 outcome=applied'
    );
  });

  it('a duplicate delivery leaves KV byte-identical', async () => {
    const store = await seeded();
    vi.stubGlobal('fetch', github().fetchImpl);
    const env = { POW: store.kv, POW_WEBHOOK_SECRET: SECRET, POW_GITHUB_TOKEN: TOKEN };
    await deliver(env, payload());
    const snapshot = new Map(store.data);
    await deliver(env, payload());
    expect(new Map(store.data)).toEqual(snapshot);
    expect(logs.at(-1)).toMatch(/outcome=unchanged$/);
  });

  it('edited and labeled patch from the payload without calling GitHub', async () => {
    const store = await seeded();
    vi.stubGlobal('fetch', github().fetchImpl);
    const env = { POW: store.kv, POW_WEBHOOK_SECRET: SECRET, POW_GITHUB_TOKEN: TOKEN };
    await deliver(env, payload());

    const offline = vi.fn(async () => {
      throw new Error('no network');
    });
    vi.stubGlobal('fetch', offline);
    const headBefore = JSON.parse(store.data.get('pow:head')!).etag;
    await deliver(env, payload({ action: 'edited', title: 'Renamed — after merge' }));
    await deliver(env, payload({ action: 'labeled', labels: ['feature', 'ios'] }));
    expect(offline).not.toHaveBeenCalled();

    const rec = (JSON.parse(store.data.get('pow:prs:frontend:2026-09')!) as PrRecord[]).find(
      (r) => r.id === 'PR_new42'
    )!;
    expect(rec).toMatchObject({
      title: 'Renamed — after merge',
      labels: ['feature', 'ios'],
      countedAdditions: 30
    });
    expect(JSON.parse(store.data.get('pow:head')!).etag).not.toBe(headBefore);
  });

  it('defers without calling GitHub while a backoff stands, and when the lock is held', async () => {
    const store = await seeded();
    const spy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', spy);
    const env = { POW: store.kv, POW_WEBHOOK_SECRET: SECRET, POW_GITHUB_TOKEN: TOKEN };

    const stored = JSON.parse(store.data.get('pow:summary')!);
    store.data.set(
      'pow:summary',
      JSON.stringify({
        ...stored,
        backoff: { reason: 'rate_limited', label: '403', until: new Date(Date.now() + 600_000).toISOString() }
      })
    );
    expect((await deliver(env, payload())).res.status).toBe(202);
    expect(logs.at(-1)).toMatch(/outcome=deferred_backoff$/);

    store.data.set('pow:summary', JSON.stringify(stored));
    store.data.set('pow:lock', 'someone-else');
    await deliver(env, payload());
    expect(logs.at(-1)).toMatch(/outcome=deferred_locked$/);
    expect(store.data.get('pow:lock')).toBe('someone-else'); // not ours to release

    expect(spy).not.toHaveBeenCalled();
  });

  it('defers a patch for a PR not stored yet, and anything before the first summary', async () => {
    const store = await seeded();
    const env = { POW: store.kv, POW_WEBHOOK_SECRET: SECRET, POW_GITHUB_TOKEN: TOKEN };
    await deliver(env, payload({ action: 'edited', title: 'x' }));
    expect(logs.at(-1)).toMatch(/outcome=deferred_not_stored$/);

    const empty = memoryKV();
    await deliver({ ...env, POW: empty.kv }, payload());
    expect(logs.at(-1)).toMatch(/outcome=deferred_no_summary$/);
    expect(empty.data.size).toBe(0);
  });

  it('a refused token on fetchOne records the backoff and logs by status only', async () => {
    const store = await seeded();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad credentials', { status: 401 })));
    const env = { POW: store.kv, POW_WEBHOOK_SECRET: SECRET, POW_GITHUB_TOKEN: TOKEN };
    await deliver(env, payload());
    expect(logs).toContain('[pow] github_auth_failed status=401');
    expect(logs.at(-1)).toMatch(/outcome=refused$/);
    expect(JSON.parse(store.data.get('pow:summary')!).backoff.reason).toBe('auth');
  });

  it('never logs the secret, the signature, or the body', async () => {
    const store = await seeded();
    vi.stubGlobal('fetch', github().fetchImpl);
    const env = { POW: store.kv, POW_WEBHOOK_SECRET: SECRET, POW_GITHUB_TOKEN: TOKEN };
    const body = payload({ title: 'Secret-ish title text' });
    const raw = JSON.stringify(body);
    const signature = await sign(raw);
    await deliver(env, body, { raw, signature });
    await deliver(env, body, { raw, signature: 'sha256=' + '0'.repeat(64) });
    await deliver(env, body, { raw: '{not json', signature: await sign('{not json') });
    const all = logs.join('\n');
    for (const needle of [SECRET, TOKEN, signature.slice(7), 'Secret-ish', '{not json']) {
      expect(all).not.toContain(needle);
    }
  });

  it('keeps hostile header values out of log lines', async () => {
    const { kv } = await seeded();
    const env = { POW: kv, POW_WEBHOOK_SECRET: SECRET, POW_GITHUB_TOKEN: TOKEN };
    // Header values can't carry newlines, but spaces and '=' could forge fields.
    await deliver(env, payload(), { delivery: 'abc outcome=applied repo=x', signature: null });
    expect(logs.at(-1)).toMatch(/delivery=abcoutcomeappliedrepox outcome=bad_signature$/);
  });
});

describe('GET /api/pow/head', () => {
  function head(env: Record<string, unknown>, headers: Record<string, string> = {}) {
    return HEAD_GET({
      request: new Request('https://zap.cooking/api/pow/head', { headers }),
      platform: { env }
    } as never) as Promise<Response>;
  }

  it('serves pow:head with its data-version ETag, 304 on match, 10 s edge cache', async () => {
    const store = await seeded();
    const stored = JSON.parse(store.data.get('pow:head')!);
    const res = await head({ POW: store.kv });
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe(stored.etag);
    expect(res.headers.get('cache-control')).toBe('public, max-age=10');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual(stored);

    const again = await head({ POW: store.kv }, { 'If-None-Match': stored.etag });
    expect(again.status).toBe(304);
    expect(again.headers.get('cache-control')).toBe('public, max-age=10');
  });

  it('503s (no-store) before there is a head', async () => {
    const res = await head({ POW: memoryKV().kv });
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await head({})).status).toBe(503);
  });
});

describe('GET /api/pow ?v= and the cold-start lock', () => {
  function pow(env: Record<string, unknown>, query = '') {
    return POW_GET({
      request: new Request(`https://zap.cooking/api/pow${query}`),
      platform: { env, ctx: { waitUntil: vi.fn() } }
    } as never) as Promise<Response>;
  }

  it('caches a matching ?v= and never caches a mismatched one', async () => {
    const store = await seeded();
    const etag = JSON.parse(store.data.get('pow:head')!).etag as string;
    const bare = etag.replace(/"/g, '');
    const env = { POW: store.kv }; // no token: served straight from KV
    expect((await pow(env, `?v=${bare}`)).headers.get('cache-control')).toBe('public, max-age=60');
    expect((await pow(env, `?v=${encodeURIComponent(etag)}`)).headers.get('cache-control')).toBe(
      'public, max-age=60'
    );
    expect((await pow(env, '?v=0123abc')).headers.get('cache-control')).toBe('no-store');
    expect((await pow(env)).headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('a cold start while another holds the lock is 503 with Retry-After, no GitHub', async () => {
    const { kv, data } = memoryKV();
    data.set('pow:lock', 'someone-else');
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const res = await pow({ POW: kv, POW_GITHUB_TOKEN: TOKEN });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 'POW_UNAVAILABLE' });
    expect(res.headers.get('retry-after')).toBe('60');
    expect(spy).not.toHaveBeenCalled();
    expect(data.get('pow:lock')).toBe('someone-else');
  });

  it('a cold start releases the lock it took', async () => {
    const { kv, data } = memoryKV();
    vi.stubGlobal('fetch', github().fetchImpl);
    const res = await pow({ POW: kv, POW_GITHUB_TOKEN: TOKEN });
    expect(res.status).toBe(200);
    expect(data.has('pow:lock')).toBe(false);
  });
});

describe('weekly full resync', () => {
  async function aged(ms: number | null) {
    const store = await seeded();
    const stored = JSON.parse(store.data.get('pow:summary')!);
    if (ms === null) delete stored.lastFullSyncAt;
    else stored.lastFullSyncAt = new Date(NOW.getTime() - ms).toISOString();
    store.data.set('pow:summary', JSON.stringify(stored));
    const out = await refreshPow(store.kv, createGithubClient(TOKEN, github().fetchImpl), NOW);
    return { out, store };
  }

  it('resyncs once the last full sync is over a week old', async () => {
    const { out, store } = await aged(FULL_RESYNC_MS + 60_000);
    expect(out.resyncStarted).toBe('weekly');
    expect(JSON.parse(store.data.get('pow:summary')!).lastFullSyncAt).toBe(NOW.toISOString());
  });

  it('does not resync inside the week', async () => {
    const { out } = await aged(FULL_RESYNC_MS - 60_000);
    expect(out.resyncStarted).toBeNull();
  });

  it('stamps a summary that predates the field, without resyncing it', async () => {
    const { out, store } = await aged(null);
    expect(out.resyncStarted).toBeNull();
    expect(JSON.parse(store.data.get('pow:summary')!).lastFullSyncAt).toBe(NOW.toISOString());
  });
});
