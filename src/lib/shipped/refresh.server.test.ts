import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../test/fixtures/pow-graphql.json';
import { EXCLUDE_VERSION } from './config';
import { createGithubClient, syncRepo } from './github.server';
import {
  CALL_BUDGET,
  REFRESH_DEADLINE_MS,
  STALE_MS,
  backoffUntil,
  isStale,
  refreshPow
} from './refresh.server';
import { tryAcquireLock, upsertRecords, type PowKV } from './store.server';
import type { PrRecord } from './types';
import { GET } from '../../routes/api/pow/+server';

const TOKEN = 'github_pat_TEST_SECRET_do_not_leak';

function memoryKV() {
  const data = new Map<string, string>();
  const log: Array<['get' | 'put' | 'delete', string]> = [];
  const kv: PowKV = {
    async get(key, type) {
      log.push(['get', key]);
      const v = data.get(key) ?? null;
      return v !== null && type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      log.push(['put', key]);
      data.set(key, value);
    },
    async delete(key) {
      log.push(['delete', key]);
      data.delete(key);
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
    pr.nodes[0].title = `Dash — ${variables.name}`;
    return new Response(JSON.stringify(page), { status: 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, spy: fetchImpl };
}

const NOW = new Date('2026-09-25T15:00:00Z');

const offline = vi.fn(async () => {
  throw new Error('test tried to reach the network');
});

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
    expect(second.stored.lastSuccessAt).toBe(later.toISOString());
    expect(log.filter(([, k]) => k.startsWith('pow:prs:')).sort()).toEqual([
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

describe('backoffUntil', () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms);
  it('auth refusals wait an hour, whatever the headers said', () => {
    expect(backoffUntil({ kind: 'auth', label: '401', retryAtMs: at(5_000).getTime() }, NOW)).toEqual(
      at(STALE_MS)
    );
  });
  it('rate limits wait for the reset GitHub gave', () => {
    expect(
      backoffUntil({ kind: 'rate_limited', label: '403', retryAtMs: at(600_000).getTime() }, NOW)
    ).toEqual(at(600_000));
  });
  it('rate limits with no reset fall back to an hour', () => {
    expect(backoffUntil({ kind: 'rate_limited', label: '403', retryAtMs: null }, NOW)).toEqual(
      at(STALE_MS)
    );
  });
  it('a reset already in the past still waits a minute', () => {
    expect(
      backoffUntil({ kind: 'rate_limited', label: '429', retryAtMs: at(-10_000).getTime() }, NOW)
    ).toEqual(at(60_000));
  });
});

/**
 * A GitHub whose frontend has PAGES list pages of one PR each (page i holds
 * PR_frontend_i and ends at cursor C_{i+1}); the other repos are one empty
 * page. Every frontend call advances the fake clock by msPerCall.
 */
function slowGithub(PAGES: number, msPerCall: number) {
  let t = 0;
  const clock = () => t;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const { variables } = JSON.parse(init.body as string);
    if (variables.name === 'frontend') t += msPerCall;
    const i = variables.after ? Number(String(variables.after).slice(2)) : 0;
    const nodes =
      variables.name === 'frontend'
        ? [
            {
              ...structuredClone(fixture.listPage.data.repository.pullRequests.nodes[0]),
              id: `PR_frontend_${i}`,
              number: 100 + i,
              updatedAt: new Date(Date.parse('2026-09-20T10:00:00Z') - i * 3600_000).toISOString(),
              mergedAt: new Date(Date.parse('2026-09-20T09:00:00Z') - i * 3600_000).toISOString()
            }
          ]
        : [];
    const hasNextPage = variables.name === 'frontend' && i < PAGES - 1;
    const body = {
      data: {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage, endCursor: hasNextPage ? `C_${i + 1}` : null },
            nodes
          }
        }
      }
    };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, clock, advance: (ms: number) => (t += ms) };
}

function storedIds(data: Map<string, string>): string[] {
  return [...data.entries()]
    .filter(([k]) => k.startsWith('pow:prs:'))
    .flatMap(([, v]) => (JSON.parse(v) as PrRecord[]).map((r) => r.id))
    .sort();
}

const ALL_EIGHT = Array.from({ length: 8 }, (_, i) => `PR_frontend_${i}`).sort();

describe('refresh deadline', () => {
  it('a backfill slower than one refresh advances across refreshes to complete', async () => {
    const { kv, data } = memoryKV();
    const gh = slowGithub(8, 7_000); // 3 pages fit before the 20 s deadline
    const afters: Array<string | null> = [];
    const outcomes = [];
    for (let n = 0; n < 6; n++) {
      const out = await refreshPow(kv, createGithubClient(TOKEN, gh.fetchImpl), NOW, {
        clock: gh.clock
      });
      outcomes.push(out);
      afters.push(JSON.parse(data.get('pow:cursor:frontend')!).pending?.after ?? null);
      if (out.stored.complete) break;
    }
    expect(outcomes.map((o) => [o.deadlineHit, o.stored.complete])).toEqual([
      [true, false],
      [true, false],
      [false, true]
    ]);
    expect(afters).toEqual(['C_3', 'C_6', null]);
    expect(outcomes[0].wallMs).toBe(21_000);
    expect(storedIds(data)).toEqual(ALL_EIGHT);
    expect(JSON.parse(outcomes[2].stored.body).totals.prs).toBe(8);
  });

  it('never abandons a page mid-checkpoint: the page that crosses the deadline is kept', async () => {
    const { kv, data } = memoryKV();
    const gh = slowGithub(8, 7_000);
    const out = await refreshPow(kv, createGithubClient(TOKEN, gh.fetchImpl), NOW, {
      clock: gh.clock
    });
    // Page 3 started at 14 s and finished at 21 s, past the deadline: its
    // record AND its checkpoint both landed. Page 4 never started.
    expect(out.deadlineHit).toBe(true);
    expect(out.githubCalls).toBe(3);
    expect(storedIds(data)).toEqual(['PR_frontend_0', 'PR_frontend_1', 'PR_frontend_2']);
    expect(JSON.parse(data.get('pow:cursor:frontend')!).pending.after).toBe('C_3');
    // Other repos weren't started, and nothing claimed they were synced.
    expect(data.has('pow:cursor:zapcooking_ios')).toBe(false);
  });

  it('does not start a >100-file follow-up past the deadline, and drops that page unwritten', async () => {
    let t = 0;
    const fetchImpl = (async () => {
      t = REFRESH_DEADLINE_MS + 1; // the list page itself runs past the deadline
      return new Response(JSON.stringify(fixture.listPage), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createGithubClient(TOKEN, fetchImpl);
    const checkpoint = vi.fn(async () => {});
    const FRESH = { cursor: null, pending: null };
    const res = await syncRepo(client, 'zap_cooking_android', FRESH, {
      pageBudget: 5,
      deadlineAt: REFRESH_DEADLINE_MS,
      clock: () => t,
      checkpoint
    });
    expect(client.calls).toBe(1); // no fetchOne for PR_big
    expect(res.deadlineHit).toBe(true);
    expect(checkpoint).not.toHaveBeenCalled();
    expect(res.state).toBe(FRESH); // re-read from the same page next time
  });

  it('a cut-off between a page\'s record write and its checkpoint loses nothing', async () => {
    const { kv, data } = memoryKV();
    const gh = slowGithub(8, 0);
    // Kill the refresh right after the FIRST write that belongs to page 2
    // (PR_frontend_1), before the second one — whichever order they're in.
    let armed = true;
    let seen = false;
    const put = kv.put.bind(kv);
    kv.put = async (key, value, opts) => {
      if (armed && seen) {
        armed = false;
        throw new Error('simulated waitUntil cut-off');
      }
      await put(key, value, opts);
      if (
        (key.startsWith('pow:prs:frontend') && value.includes('"PR_frontend_1"')) ||
        (key === 'pow:cursor:frontend' && JSON.parse(value).pending?.after === 'C_2')
      ) {
        seen = true;
      }
    };
    await expect(
      refreshPow(kv, createGithubClient(TOKEN, gh.fetchImpl), NOW, { clock: gh.clock })
    ).rejects.toThrow('simulated waitUntil cut-off');

    for (let n = 0; n < 4; n++) {
      const out = await refreshPow(kv, createGithubClient(TOKEN, gh.fetchImpl), NOW, {
        clock: gh.clock
      });
      if (out.stored.complete) break;
    }
    expect(storedIds(data)).toEqual(ALL_EIGHT);
  });
});

describe('repo rotation', () => {
  /** Every repo has 5 pages; every call takes 21 s, so one page per refresh. */
  function allSlow() {
    let t = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      t += 21_000;
      const { variables } = JSON.parse(init.body as string);
      const i = variables.after ? Number(String(variables.after).slice(2)) : 0;
      const node = {
        ...structuredClone(fixture.listPage.data.repository.pullRequests.nodes[0]),
        id: `PR_${variables.name}_${i}`,
        updatedAt: new Date(Date.parse('2026-09-20T10:00:00Z') - i * 3600_000).toISOString(),
        mergedAt: new Date(Date.parse('2026-09-20T09:00:00Z') - i * 3600_000).toISOString()
      };
      const hasNextPage = i < 4;
      return new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequests: {
                pageInfo: { hasNextPage, endCursor: hasNextPage ? `C_${i + 1}` : null },
                nodes: [node]
              }
            }
          }
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    return { fetchImpl, clock: () => t };
  }

  it('every repo makes progress within one refresh per repo, even when only one fits', async () => {
    const { kv, data } = memoryKV();
    const gh = allSlow();
    const repos = ['frontend', 'zap_cooking_android', 'zapcooking_ios'];
    for (let n = 0; n < repos.length; n++) {
      const out = await refreshPow(kv, createGithubClient(TOKEN, gh.fetchImpl), NOW, {
        clock: gh.clock
      });
      expect(out.githubCalls).toBe(1);
      expect(out.deadlineHit).toBe(true);
    }
    for (const repo of repos) {
      const state = data.get(`pow:cursor:${repo}`);
      expect(state, `${repo} never ran`).toBeDefined();
      expect(JSON.parse(state!).pending.after).toBe('C_1');
    }
  });
});

describe('repo rotation on no-op refreshes', () => {
  it('keeps rotating when a refresh changes nothing (the no-op path)', async () => {
    const { kv, data } = memoryKV();
    const slow = (() => {
      let t = 0;
      const clock = () => t;
      const fetchImpl = (async (_url: string, init: RequestInit) => {
        t += 21_000;
        const { variables } = JSON.parse(init.body as string);
        const i = variables.after ? Number(String(variables.after).slice(2)) : 0;
        const node = {
          ...structuredClone(fixture.listPage.data.repository.pullRequests.nodes[0]),
          id: `PR_${variables.name}_${i}`,
          updatedAt: new Date(Date.parse('2026-09-20T10:00:00Z') - i * 3600_000).toISOString(),
          mergedAt: new Date(Date.parse('2026-09-20T09:00:00Z') - i * 3600_000).toISOString()
        };
        const hasNextPage = i < 4;
        return new Response(
          JSON.stringify({
            data: {
              repository: {
                pullRequests: {
                  pageInfo: { hasNextPage, endCursor: hasNextPage ? `C_${i + 1}` : null },
                  nodes: [node]
                }
              }
            }
          }),
          { status: 200 }
        );
      }) as unknown as typeof fetch;
      return { fetchImpl, clock };
    })();
    // Store everything first (real clock, so no deadline pressure).
    for (let n = 0; n < 3; n++) {
      const out = await refreshPow(kv, createGithubClient(TOKEN, slow.fetchImpl), NOW);
      if (out.stored.complete) break;
    }
    // Now walk again from scratch, still incomplete: every page re-read is
    // already stored, so each refresh upserts nothing and recomputes nothing.
    const repos = ['frontend', 'zap_cooking_android', 'zapcooking_ios'];
    for (const repo of repos) {
      data.set(`pow:cursor:${repo}`, JSON.stringify({ cursor: null, pending: null }));
    }
    const stored = JSON.parse(data.get('pow:summary')!);
    data.set('pow:summary', JSON.stringify({ ...stored, complete: false }));

    for (let n = 0; n < repos.length; n++) {
      const out = await refreshPow(kv, createGithubClient(TOKEN, slow.fetchImpl), NOW, {
        clock: slow.clock
      });
      expect(out).toMatchObject({ upserted: 0, recomputed: false, githubCalls: 1 });
    }
    for (const repo of repos) {
      expect(JSON.parse(data.get(`pow:cursor:${repo}`)!).pending?.after, `${repo} never ran`).toBe('C_1');
    }
  });
});

describe('EXCLUDE_VERSION resync', () => {
  /** A complete summary under the current version, plus a stale counted value. */
  async function seeded() {
    const { kv, data } = memoryKV();
    const gh = slowGithub(8, 0);
    const first = await refreshPow(kv, createGithubClient(TOKEN, gh.fetchImpl), NOW, {
      clock: gh.clock
    });
    expect(first.stored.complete).toBe(true);
    // Pretend PR_frontend_3 was counted under an older EXCLUDE list.
    const shardKey = [...data.keys()].find((k) => k.startsWith('pow:prs:frontend'))!;
    const shard = JSON.parse(data.get(shardKey)!) as PrRecord[];
    shard.find((r) => r.id === 'PR_frontend_3')!.countedAdditions = 999_999;
    data.set(shardKey, JSON.stringify(shard));
    // An incremental sync from here would stop on the first page and never
    // re-read PR_frontend_3.
    for (const repo of ['frontend', 'zap_cooking_android', 'zapcooking_ios']) {
      data.set(`pow:cursor:${repo}`, JSON.stringify({ cursor: '2027-01-01T00:00:00Z', pending: null }));
    }
    const counted3 = () =>
      (JSON.parse(data.get(shardKey)!) as PrRecord[]).find((r) => r.id === 'PR_frontend_3')!
        .countedAdditions;
    return { kv, data, gh, counted3 };
  }

  it('a matching version does not reset anything', async () => {
    const { kv, data, gh, counted3 } = await seeded();
    const out = await refreshPow(kv, createGithubClient(TOKEN, gh.fetchImpl), NOW, {
      clock: gh.clock
    });
    expect(out.resyncStarted).toBeNull();
    expect(out.githubCalls).toBe(3); // one page per repo, then the cursor stops it
    expect(counted3()).toBe(999_999);
  });

  it('a mismatched version resets the cursors and recounts every PR, once', async () => {
    const { kv, data, gh, counted3 } = await seeded();
    const stored = JSON.parse(data.get('pow:summary')!);
    delete stored.excludeVersion; // a pre-versioning summary is v1
    data.set('pow:summary', JSON.stringify(stored));

    const out = await refreshPow(kv, createGithubClient(TOKEN, gh.fetchImpl), NOW, {
      clock: gh.clock
    });
    expect(out.resyncStarted).toBe('exclude_version');
    expect(out.stored.complete).toBe(true);
    expect(out.stored.excludeVersion).toBe(EXCLUDE_VERSION);
    expect(out.githubCalls).toBe(8 + 2); // every frontend page, from START
    expect(counted3()).not.toBe(999_999);

    // Claimed: the next refresh is an ordinary incremental one.
    const next = await refreshPow(kv, createGithubClient(TOKEN, gh.fetchImpl), NOW, {
      clock: gh.clock
    });
    expect(next.resyncStarted).toBeNull();
  });

  it('a version mismatch makes even a fresh summary due for refresh, unless backing off', async () => {
    const { data } = await seeded();
    const stored = JSON.parse(data.get('pow:summary')!);
    const now = new Date(Date.parse(stored.lastSuccessAt) + 60_000);
    expect(isStale(stored, now)).toBe(false);
    expect(isStale({ ...stored, excludeVersion: EXCLUDE_VERSION - 1 }, now)).toBe(true);
    expect(isStale({ ...stored, excludeVersion: undefined }, now)).toBe(true);
    const backoff = { reason: 'auth', label: '401', until: new Date(now.getTime() + 60_000).toISOString() };
    expect(isStale({ ...stored, excludeVersion: undefined, backoff }, now)).toBe(false);
  });

  it('a refresh cut off right after starting the resync leaves it honest and resumable', async () => {
    const { kv, data, gh, counted3 } = await seeded();
    const stored = JSON.parse(data.get('pow:summary')!);
    stored.excludeVersion = EXCLUDE_VERSION - 1;
    data.set('pow:summary', JSON.stringify(stored));

    const dead = (async () => {
      throw new Error('simulated cut-off');
    }) as unknown as typeof fetch;
    await expect(
      refreshPow(kv, createGithubClient(TOKEN, dead), NOW, { clock: gh.clock })
    ).rejects.toThrow('simulated cut-off');

    // Not final, not cacheable, and due for another refresh right away.
    const mid = JSON.parse(data.get('pow:summary')!);
    expect(mid.complete).toBe(false);
    expect(JSON.parse(mid.body).complete).toBe(false);
    expect(isStale(mid, new Date())).toBe(true);

    // The next refresh continues the resync instead of starting it over.
    const out = await refreshPow(kv, createGithubClient(TOKEN, gh.fetchImpl), NOW, {
      clock: gh.clock
    });
    expect(out.resyncStarted).toBeNull();
    expect(out.githubCalls).toBe(8 + 2);
    expect(out.stored.complete).toBe(true);
    expect(counted3()).not.toBe(999_999);
  });

  it('keeps serving the existing numbers during a chunked resync', async () => {
    const { kv, data } = await seeded();
    const before = JSON.parse(JSON.parse(data.get('pow:summary')!).body);
    const stored = JSON.parse(data.get('pow:summary')!);
    stored.excludeVersion = EXCLUDE_VERSION - 1;
    data.set('pow:summary', JSON.stringify(stored));

    const slow = slowGithub(8, 7_000); // the resync needs several refreshes
    const out = await refreshPow(kv, createGithubClient(TOKEN, slow.fetchImpl), NOW, {
      clock: slow.clock
    });
    expect(out.resyncStarted).toBe('exclude_version');
    expect(out.deadlineHit).toBe(true);

    // Mid-resync, as a reader sees it: same PRs, nothing zeroed, not final.
    const res = await (GET({
      request: new Request('https://zap.cooking/api/pow'),
      platform: { env: { POW: kv }, ctx: { waitUntil: vi.fn() } }
    } as never) as Promise<Response>);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.complete).toBe(false);
    expect(body.totals.prs).toBe(before.totals.prs);
    expect(body.totals.prs).toBeGreaterThan(0);
    const who = (cs: Array<{ login: string; prs: number }>) => cs.map((c) => [c.login, c.prs]);
    expect(who(body.contributors)).toEqual(who(before.contributors));
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
    // No test may reach the real GitHub: anything unstubbed fails loudly.
    vi.stubGlobal('fetch', offline);
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
  });
  afterEach(() => {
    const leaked = offline.mock.calls.length;
    offline.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    expect(leaked, 'a test reached for the network').toBe(0);
  });

  function call(env: Record<string, unknown>, headers: Record<string, string> = {}) {
    const waitUntil = vi.fn();
    const request = new Request('https://zap.cooking/api/pow', { headers });
    const res = GET({ request, platform: { env, ctx: { waitUntil } } } as never) as Promise<Response>;
    return { res, waitUntil };
  }

  for (const [complete, cacheControl] of [
    [false, 'no-store'],
    [true, 'public, max-age=60']
  ] as const) {
    it(`complete:${complete} is served with Cache-Control: ${cacheControl}`, async () => {
      const { kv, data } = memoryKV();
      data.set(
        'pow:summary',
        JSON.stringify({
          body: JSON.stringify({ complete, totals: { prs: 1 } }),
          etag: '"abc"',
          asOfDate: '2026-09-25',
          complete,
          lastSuccessAt: new Date().toISOString()
        })
      );
      // No token: served straight from KV, no refresh attempted.
      const res = await call({ POW: kv }).res;
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(cacheControl);
      const etag = res.headers.get('etag')!;
      const again = await call({ POW: kv }, { 'If-None-Match': etag }).res;
      expect(again.status).toBe(304);
      expect(again.headers.get('cache-control')).toBe(cacheControl);
    });
  }

  it('returns 503 POW_UNCONFIGURED without a token or binding', async () => {
    for (const env of [{ POW: memoryKV().kv }, { POW_GITHUB_TOKEN: TOKEN }] as Record<string, unknown>[]) {
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
    expect(first.headers.get('content-type')).toBe('application/json; charset=utf-8');
    // …and the bytes really are UTF-8: an em dash in a title round-trips.
    expect(new TextDecoder('utf-8').decode(await first.clone().arrayBuffer())).toContain(
      'Dash — frontend'
    );
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
    stored.lastSuccessAt = new Date(Date.now() - STALE_MS - 1000).toISOString();
    data.set('pow:summary', JSON.stringify(stored));

    const { res, waitUntil } = call(env);
    expect((await res).status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    expect(logs.some((l) => /^\[pow\] refresh github_calls=3 overflow_calls=0 /.test(l))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('cold start: a refused token is 503 POW_UNCONFIGURED, logged by status only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Bad credentials', { status: 401 }))
    );
    const res = await call({ POW: memoryKV().kv, POW_GITHUB_TOKEN: TOKEN }).res;
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ code: 'POW_UNCONFIGURED' });
    expect(logs).toEqual(['[pow] github_auth_failed status=401']);
    expect(text).not.toContain(TOKEN);
    vi.unstubAllGlobals();
  });

  it('cold start: any other GitHub failure is 503 POW_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 502 })));
    const res = await call({ POW: memoryKV().kv, POW_GITHUB_TOKEN: TOKEN }).res;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 'POW_UNAVAILABLE' });
    vi.unstubAllGlobals();
  });

  it('cold start: a rate limit is 503 POW_UNAVAILABLE with Retry-After from the reset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403, headers: { 'Retry-After': '300' } }))
    );
    const res = await call({ POW: memoryKV().kv, POW_GITHUB_TOKEN: TOKEN }).res;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 'POW_UNAVAILABLE' });
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(299);
    expect(Number(res.headers.get('retry-after'))).toBeLessThanOrEqual(300);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^\[pow\] github_rate_limited status=403 /);
  });

  it('cold start: other failures carry no Retry-After', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    const res = await call({ POW: memoryKV().kv, POW_GITHUB_TOKEN: TOKEN }).res;
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBeNull();
  });

  async function seededStale() {
    const { fetchImpl } = fakeFetch();
    vi.stubGlobal('fetch', fetchImpl);
    const { kv, data } = memoryKV();
    const env: Record<string, unknown> = { POW: kv, POW_GITHUB_TOKEN: TOKEN };
    const fresh = await (await call(env).res).json();
    const stored = JSON.parse(data.get('pow:summary')!);
    stored.lastSuccessAt = new Date(Date.now() - STALE_MS - 1000).toISOString();
    data.set('pow:summary', JSON.stringify(stored));
    vi.stubGlobal('fetch', offline);
    logs.length = 0;
    // What a reader saw before anything went wrong.
    const good = { ...fresh, lastSuccessAt: stored.lastSuccessAt };
    return { env, data, storedBody: stored.body as string, good };
  }

  /** The served body minus the freshness meta. */
  const withoutMeta = ({ lastSuccessAt: _a, stale: _b, ...rest }: Record<string, unknown>) => rest;

  it('a healthy response carries lastSuccessAt and stale:false', async () => {
    vi.stubGlobal('fetch', fakeFetch().fetchImpl);
    const body = await (await call({ POW: memoryKV().kv, POW_GITHUB_TOKEN: TOKEN }).res).json();
    expect(body.stale).toBe(false);
    expect(Date.parse(body.lastSuccessAt)).not.toBeNaN();
    expect(body.totals.prs).toBe(3);
    vi.unstubAllGlobals();
  });

  const refusals: Array<{
    label: string;
    response: () => Response;
    log: RegExp;
    backoffMs: number;
  }> = [
    {
      label: 'bare HTTP 401',
      response: () => new Response('Bad credentials', { status: 401 }),
      log: /^\[pow\] github_auth_failed status=401$/,
      backoffMs: STALE_MS
    },
    {
      label: 'bare HTTP 403',
      response: () =>
        new Response('Resource not accessible', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '4000', 'x-ratelimit-reset': '9999999999' }
        }),
      log: /^\[pow\] github_auth_failed status=403$/,
      backoffMs: STALE_MS
    },
    {
      label: 'GraphQL NOT_FOUND',
      response: () =>
        new Response(
          JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'no' }] }),
          { status: 200 }
        ),
      log: /^\[pow\] github_auth_failed status=graphql_not_found$/,
      backoffMs: STALE_MS
    },
    {
      label: '403 with Retry-After',
      response: () =>
        new Response('secondary rate limit', { status: 403, headers: { 'Retry-After': '600' } }),
      log: /^\[pow\] github_rate_limited status=403 retry_at=\S+Z$/,
      backoffMs: 600_000
    },
    {
      label: '403 with x-ratelimit-remaining: 0',
      response: () =>
        new Response('', {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1200)
          }
        }),
      log: /^\[pow\] github_rate_limited status=403 retry_at=\S+Z$/,
      backoffMs: 1_200_000
    },
    {
      label: '403 rate-limit message, no headers',
      response: () =>
        new Response('You have exceeded a secondary rate limit', { status: 403 }),
      log: /^\[pow\] github_rate_limited status=403 retry_at=\S+Z$/,
      backoffMs: STALE_MS
    }
  ];

  for (const { label, response, log, backoffMs } of refusals) {
    it(`${label}: keeps serving the last good summary, marked stale, and backs off`, async () => {
      const { env, data, storedBody, good } = await seededStale();
      const github = vi.fn(async () => response());
      vi.stubGlobal('fetch', github);

      const { res, waitUntil } = call(env);
      const r = await res;
      expect(r.status).toBe(200);
      expect(withoutMeta(await r.json())).toEqual(withoutMeta(good));
      const t0 = Date.now();
      await waitUntil.mock.calls[0][0];

      expect(logs.filter((l) => l.startsWith('[pow] github_'))).toHaveLength(1);
      expect(logs.find((l) => l.startsWith('[pow] github_'))).toMatch(log);

      const after = JSON.parse(data.get('pow:summary')!);
      expect(after.body).toBe(storedBody);
      const until = Date.parse(after.backoff.until);
      expect(Math.abs(until - (t0 + backoffMs))).toBeLessThan(5_000);

      // Visible on the endpoint: stale, same lastSuccessAt, new ETag.
      github.mockClear();
      data.delete('pow:lock'); // the 60s lock would otherwise mask the backoff
      const next = call(env);
      const nextRes = await next.res;
      expect(nextRes.status).toBe(200);
      const nextBody = await nextRes.json();
      expect(nextBody.stale).toBe(true);
      expect(nextBody.lastSuccessAt).toBe(good.lastSuccessAt);
      expect(nextRes.headers.get('etag')).not.toBe(r.headers.get('etag'));
      // …and backs off: no refresh while the backoff stands.
      expect(next.waitUntil).not.toHaveBeenCalled();
      expect(github).not.toHaveBeenCalled();

      expect(logs.join('\n')).not.toContain(TOKEN);
      vi.unstubAllGlobals();
    });
  }

  it('retries once the backoff has passed', async () => {
    const { env, data } = await seededStale();
    const stored = JSON.parse(data.get('pow:summary')!);
    stored.backoff = { reason: 'rate_limited', label: '403', until: new Date(Date.now() - 1).toISOString() };
    data.set('pow:summary', JSON.stringify(stored));
    vi.stubGlobal('fetch', fakeFetch().fetchImpl);
    const { res, waitUntil } = call(env);
    const body = await (await res).json();
    expect(body.stale).toBe(true); // until a refresh succeeds
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    data.delete('pow:lock');
    const after = await (await call(env).res).json();
    expect(after.stale).toBe(false);
    vi.unstubAllGlobals();
  });

  it('a removed token serves the last summary as stale, and 503s only with none', async () => {
    const { env, good } = await seededStale();
    delete env.POW_GITHUB_TOKEN;
    const res = await call(env).res;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(withoutMeta(body)).toEqual(withoutMeta(good));
    expect(body.stale).toBe(true);

    const empty = await call({ POW: memoryKV().kv }).res;
    expect(empty.status).toBe(503);
    expect(await empty.json()).toEqual({ code: 'POW_UNCONFIGURED' });
  });

  it('a successful refresh clears the backoff', async () => {
    const { kv, data } = memoryKV();
    await refreshPow(kv, createGithubClient(TOKEN, fakeFetch().fetchImpl), NOW);
    const stored = JSON.parse(data.get('pow:summary')!);
    data.set(
      'pow:summary',
      JSON.stringify({ ...stored, backoff: { reason: 'auth', label: '401', until: NOW.toISOString() } })
    );
    const later = new Date(NOW.getTime() + 2 * STALE_MS);
    const out = await refreshPow(kv, createGithubClient(TOKEN, fakeFetch().fetchImpl), later);
    expect(out.stored.backoff).toBeUndefined();
  });
});
