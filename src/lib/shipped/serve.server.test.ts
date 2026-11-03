import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../test/fixtures/pow-graphql.json';
import { createGithubClient } from './github.server';
import { STALE_MS, refreshPow } from './refresh.server';
import { etagMatches } from './serve.server';
import { loadPowPage } from './pageLoad.server';
import type { PowKV } from './store.server';
import type { PowPayload } from './types';
import { GET as POW_GET } from '../../routes/api/pow/+server';
import { GET as HEAD_GET } from '../../routes/api/pow/head/+server';

const TOKEN = 'github_pat_TEST_SECRET_do_not_leak';
const NOW = new Date('2026-09-25T15:00:00Z');

function memoryKV() {
  const data = new Map<string, string>();
  const kv: PowKV = {
    async get(key, type) {
      const v = data.get(key) ?? null;
      return v !== null && type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      data.set(key, value);
    },
    async delete(key) {
      data.delete(key);
    }
  };
  return { kv, data };
}

function github() {
  return (async (_url: string, init: RequestInit) => {
    const { variables } = JSON.parse(init.body as string);
    const page = structuredClone(fixture.listPage);
    const pr = page.data.repository.pullRequests;
    pr.pageInfo.hasNextPage = false;
    pr.nodes = [pr.nodes[0]];
    pr.nodes[0].id = `PR_${variables.name}`;
    return new Response(JSON.stringify(page), { status: 200 });
  }) as unknown as typeof fetch;
}

async function seeded(complete = true) {
  const store = memoryKV();
  await refreshPow(store.kv, createGithubClient(TOKEN, github()), NOW);
  if (!complete) {
    const s = JSON.parse(store.data.get('pow:summary')!);
    const body = JSON.stringify({ ...JSON.parse(s.body), complete: false });
    store.data.set('pow:summary', JSON.stringify({ ...s, body, complete: false }));
  }
  return store;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('test tried to reach the network');
    })
  );
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('etagMatches', () => {
  it('matches strong, weak (W/), listed and * forms; nothing else', () => {
    expect(etagMatches('"abc"', '"abc"')).toBe(true);
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true);
    expect(etagMatches('"x", W/"abc"', '"abc"')).toBe(true);
    expect(etagMatches('*', '"abc"')).toBe(true);
    expect(etagMatches('"abcd"', '"abc"')).toBe(false);
    expect(etagMatches('W/"ab"', '"abc"')).toBe(false);
    expect(etagMatches(null, '"abc"')).toBe(false);
    expect(etagMatches('', '"abc"')).toBe(false);
  });
});

describe('W/ If-None-Match on the endpoints', () => {
  it('/api/pow and /api/pow/head answer 304 to a weakened copy of their ETag', async () => {
    const { kv } = await seeded();
    const env = { POW: kv }; // served straight from KV
    const pow = (headers: Record<string, string> = {}) =>
      POW_GET({
        request: new Request('https://zap.cooking/api/pow', { headers }),
        platform: { env }
      } as never) as Promise<Response>;
    const head = (headers: Record<string, string> = {}) =>
      HEAD_GET({
        request: new Request('https://zap.cooking/api/pow/head', { headers }),
        platform: { env }
      } as never) as Promise<Response>;

    const powEtag = (await pow()).headers.get('etag')!;
    expect((await pow({ 'If-None-Match': `W/${powEtag}` })).status).toBe(304);
    const headEtag = (await head()).headers.get('etag')!;
    expect((await head({ 'If-None-Match': `W/${headEtag}` })).status).toBe(304);
  });
});

describe('dataVersion', () => {
  it('/api/pow carries pow:head.etag (unquoted) in the body', async () => {
    const { kv, data } = await seeded();
    const body = await (
      (await POW_GET({
        request: new Request('https://zap.cooking/api/pow'),
        platform: { env: { POW: kv } }
      } as never)) as Response
    ).json();
    const head = JSON.parse(data.get('pow:head')!);
    expect(body.dataVersion).toBe(head.etag.replace(/"/g, ''));
    expect(body.dataVersion).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('loadPowPage', () => {
  async function load(env: Record<string, unknown>, loadDevFixture: (() => Promise<PowPayload>) | null = null) {
    const headers: Record<string, string> = {};
    const waitUntil = vi.fn();
    const data = await loadPowPage({
      platform: { env, ctx: { waitUntil } } as never,
      url: new URL('https://zap.cooking/pow'),
      setHeaders: (h) => Object.assign(headers, h),
      loadDevFixture
    });
    return { data, headers, waitUntil };
  }

  for (const complete of [true, false]) {
    it(`uses /api/pow's Cache-Control (complete:${complete})`, async () => {
      const { kv } = await seeded(complete);
      const { data, headers } = await load({ POW: kv });
      const api = (await POW_GET({
        request: new Request('https://zap.cooking/api/pow'),
        platform: { env: { POW: kv } }
      } as never)) as Response;
      expect(data.state).toBe('ok');
      expect(headers['cache-control']).toBe(api.headers.get('cache-control'));
      expect(headers['cache-control']).toBe(complete ? 'public, max-age=60' : 'no-store');
      if (data.state === 'ok') {
        expect(data.summary.complete).toBe(complete);
        expect(data.summary.dataVersion).toMatch(/^[0-9a-f]{32}$/);
      }
    });
  }

  it('refreshes a stale summary in waitUntil, exactly as /api/pow does', async () => {
    const { kv, data: kvData } = await seeded();
    const s = JSON.parse(kvData.get('pow:summary')!);
    kvData.set(
      'pow:summary',
      JSON.stringify({ ...s, lastSuccessAt: new Date(Date.now() - STALE_MS - 1000).toISOString() })
    );
    vi.stubGlobal('fetch', github());
    const { data, waitUntil } = await load({ POW: kv, POW_GITHUB_TOKEN: TOKEN });
    expect(data.state).toBe('ok');
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    expect(Date.parse(JSON.parse(kvData.get('pow:summary')!).lastSuccessAt)).toBeGreaterThan(
      Date.now() - 60_000
    );
  });

  it('no binding → unconfigured, no-store; the dev fixture is used only when supplied', async () => {
    const plain = await load({});
    expect(plain.data).toEqual({ state: 'unconfigured' });
    expect(plain.headers['cache-control']).toBe('no-store');

    const fixtureSummary = { dataVersion: 'dev-fixture' } as PowPayload;
    const devFixture = vi.fn(async () => fixtureSummary);
    const dev = await load({}, devFixture);
    expect(dev.data).toEqual({ state: 'ok', summary: fixtureSummary });

    // `vite dev` binds an empty local namespace: still the fixture.
    const empty = await load({ POW: memoryKV().kv }, devFixture);
    expect(empty.data).toEqual({ state: 'ok', summary: fixtureSummary });
    expect(devFixture).toHaveBeenCalledTimes(2);

    // A real summary always wins over the fixture.
    const { kv } = await seeded();
    const real = await load({ POW: kv }, devFixture);
    expect(devFixture).toHaveBeenCalledTimes(2);
    expect(real.data.state === 'ok' && real.data.summary.dataVersion).not.toBe('dev-fixture');
  });

  it('a cold start already running is the calm unavailable state', async () => {
    const { kv, data } = memoryKV();
    data.set('pow:lock', 'someone-else');
    const { data: page, headers } = await load({ POW: kv, POW_GITHUB_TOKEN: TOKEN });
    expect(page).toEqual({ state: 'unavailable' });
    expect(headers['cache-control']).toBe('no-store');
  });
});
