import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../test/fixtures/pow-graphql.json';
import { createGithubClient } from './github.server';
import { CALL_BUDGET, STALE_MS, isStale, refreshPow } from './refresh.server';
import { tryAcquireLock, upsertRecords, type PowKV } from './store.server';
import type { PrRecord } from './types';
import { GET } from '../../routes/api/pow/+server';

const TOKEN = 'github_pat_TEST_SECRET_do_not_leak';

function memoryKV() {
  const data = new Map<string, string>();
  const log: Array<['get' | 'put', string]> = [];
  const kv: PowKV = {
    async get(key, type) {
      log.push(['get', key]);
      const v = data.get(key) ?? null;
      return v !== null && type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      log.push(['put', key]);
      data.set(key, value);
    }
  };
  return { kv, data, log };
}

/** A GitHub that returns one PR per repo, all caught up in one page. */
function fakeFetch() {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const { variables } = JSON.parse(init.body as string);
    calls.push(variables.name);
    const page = structuredClone(fixture.listPage);
    const pr = page.data.repository.pullRequests;
    pr.pageInfo.hasNextPage = false;
    pr.nodes = [pr.nodes[0]];
    pr.nodes[0].id = `PR_${variables.name}`;
    return new Response(JSON.stringify(page), { status: 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, spy: fetchImpl };
}

const NOW = new Date('2026-09-25T15:00:00Z');

describe('refreshPow', () => {
  it('syncs every repo, then a no-op refresh never re-reads the shards', async () => {
    const { kv, log } = memoryKV();
    const first = await refreshPow(kv, createGithubClient(TOKEN, fakeFetch().fetchImpl), NOW);
    expect(first).toMatchObject({ githubCalls: 3, upserted: 3, recomputed: true });
    expect(first.stored.complete).toBe(true);
    expect(JSON.parse(first.stored.body).totals.prs).toBe(3);

    log.length = 0;
    const later = new Date(NOW.getTime() + 5 * 60_000);
    const second = await refreshPow(kv, createGithubClient(TOKEN, fakeFetch().fetchImpl), later);
    expect(second).toMatchObject({ upserted: 0, recomputed: false });
    expect(second.stored.etag).toBe(first.stored.etag);
    expect(second.stored.checkedAt).toBe(later.toISOString());
    expect(log.filter(([, k]) => k.startsWith('pow:prs:'))).toEqual([
      // upsertRecords reads the three touched shards to compare — never all 27,
      // and writes none of them.
      ['get', 'pow:prs:frontend:2026-09'],
      ['get', 'pow:prs:zap_cooking_android:2026-09'],
      ['get', 'pow:prs:zapcooking_ios:2026-09']
    ]);
  });

  it('recomputes on a new day even with nothing new (the streak is dated)', async () => {
    const { kv } = memoryKV();
    await refreshPow(kv, createGithubClient(TOKEN, fakeFetch().fetchImpl), NOW);
    const tomorrow = new Date(NOW.getTime() + 24 * 3600_000);
    const next = await refreshPow(kv, createGithubClient(TOKEN, fakeFetch().fetchImpl), tomorrow);
    expect(next).toMatchObject({ upserted: 0, recomputed: true });
  });

  it('writes pow:head with the newest PR and the summary ETag', async () => {
    const { kv, data } = memoryKV();
    const { stored } = await refreshPow(kv, createGithubClient(TOKEN, fakeFetch().fetchImpl), NOW);
    expect(JSON.parse(data.get('pow:head')!)).toEqual({
      latestId: JSON.parse(stored.body).recent[0].id,
      updatedAt: NOW.toISOString(),
      etag: stored.etag
    });
  });

  it('stops at CALL_BUDGET and leaves the summary incomplete', async () => {
    const { kv } = memoryKV();
    // Every page says there is more, so the first repo eats the whole budget.
    const endless = vi.fn(async () => new Response(JSON.stringify(fixture.listPage), { status: 200 }));
    const onlyFirstPage = structuredClone(fixture.listPage);
    onlyFirstPage.data.repository.pullRequests.nodes.splice(1);
    endless.mockImplementation(
      async () => new Response(JSON.stringify(onlyFirstPage), { status: 200 })
    );
    const out = await refreshPow(kv, createGithubClient(TOKEN, endless as unknown as typeof fetch), NOW);
    expect(out.githubCalls).toBe(CALL_BUDGET);
    expect(out.stored.complete).toBe(false);
    expect(isStale(out.stored, NOW)).toBe(true);
  });
});

describe('upsertRecords', () => {
  it('is idempotent by PR id', async () => {
    const { kv, data } = memoryKV();
    const rec = {
      id: 'X',
      repo: 'frontend',
      number: 1,
      title: 't',
      url: 'u',
      author: 'a',
      mergedAt: '2026-05-01T00:00:00Z',
      labels: [],
      additions: 1,
      deletions: 1,
      countedAdditions: 1,
      countedDeletions: 1
    } satisfies PrRecord;
    expect(await upsertRecords(kv, [rec])).toBe(1);
    expect(await upsertRecords(kv, [rec])).toBe(0);
    expect(await upsertRecords(kv, [{ ...rec, title: 'renamed' }])).toBe(1);
    expect(JSON.parse(data.get('pow:prs:frontend:2026-05')!)).toHaveLength(1);
  });
});

describe('tryAcquireLock', () => {
  it('refuses while the lock key exists', async () => {
    const { kv } = memoryKV();
    expect(await tryAcquireLock(kv, NOW)).toBe(true);
    expect(await tryAcquireLock(kv, NOW)).toBe(false);
  });
});

describe('GET /api/pow', () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
  });
  afterEach(() => vi.restoreAllMocks());

  function call(env: Record<string, unknown>, headers: Record<string, string> = {}) {
    const waitUntil = vi.fn();
    const request = new Request('https://zap.cooking/api/pow', { headers });
    const res = GET({ request, platform: { env, ctx: { waitUntil } } } as never) as Promise<Response>;
    return { res, waitUntil };
  }

  it('returns 503 POW_UNCONFIGURED without a token or binding', async () => {
    for (const env of [{ POW: memoryKV().kv }, { POW_GITHUB_TOKEN: TOKEN }]) {
      const res = await call(env).res;
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ code: 'POW_UNCONFIGURED' });
    }
  });

  it('cold-starts inline, then serves the second call with zero GitHub requests', async () => {
    const { fetchImpl, spy } = fakeFetch();
    vi.stubGlobal('fetch', fetchImpl);
    const env = { POW: memoryKV().kv, POW_GITHUB_TOKEN: TOKEN };

    const first = await call(env).res;
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('application/json');
    const body = await first.json();
    expect(body.totals.prs).toBe(3);
    expect(body.complete).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3);

    const second = call(env);
    const res2 = await second.res;
    expect(res2.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(3); // no new GitHub calls
    expect(second.waitUntil).not.toHaveBeenCalled();
    expect(logs).toContain('[pow] fresh github_calls=0');

    const etag = res2.headers.get('etag')!;
    const res3 = await call(env, { 'If-None-Match': etag }).res;
    expect(res3.status).toBe(304);

    expect(logs.join('\n')).not.toContain(TOKEN);
    vi.unstubAllGlobals();
  });

  it('serves stale and refreshes in waitUntil', async () => {
    const { fetchImpl } = fakeFetch();
    vi.stubGlobal('fetch', fetchImpl);
    const { kv, data } = memoryKV();
    const env = { POW: kv, POW_GITHUB_TOKEN: TOKEN };
    await (await call(env).res).text();

    const stored = JSON.parse(data.get('pow:summary')!);
    stored.checkedAt = new Date(Date.now() - STALE_MS - 1000).toISOString();
    data.set('pow:summary', JSON.stringify(stored));

    const { res, waitUntil } = call(env);
    expect((await res).status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    expect(logs.some((l) => /^\[pow\] refresh github_calls=3 /.test(l))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('turns a GitHub failure into a 503 without leaking the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Bad credentials', { status: 401 }))
    );
    const res = await call({ POW: memoryKV().kv, POW_GITHUB_TOKEN: TOKEN }).res;
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ code: 'POW_UNAVAILABLE' });
    expect(`${text}\n${logs.join('\n')}`).not.toContain(TOKEN);
    vi.unstubAllGlobals();
  });
});
