/**
 * The /pow page's server load, with its environment injected so it's
 * testable. Reads KV through serveSummary — the same cold start,
 * stale-while-revalidate refresh and Cache-Control as GET /api/pow — and
 * never self-fetches over HTTP. Imports nothing that pulls in NDK.
 */

import { serveSummary, summaryHttp, type PowPlatform } from './serve.server';
import type { PowPayload } from './types';
import type { PageData } from './viewModel';

export interface PowPageLoadEnv {
  platform: PowPlatform | undefined;
  url: URL;
  setHeaders: (headers: Record<string, string>) => void;
  /**
   * Local dev only: a summary for when there's no real one (no POW binding,
   * or the local namespace is empty). The route
   * passes null outside `dev` (a compile-time constant), so production
   * builds can't reach — or even bundle — the fixture.
   */
  loadDevFixture: (() => Promise<PowPayload>) | null;
}

export async function loadPowPage(env: PowPageLoadEnv): Promise<PageData> {
  const result = await serveSummary(env.platform);
  if (result.kind !== 'ok') {
    env.setHeaders({ 'cache-control': 'no-store' });
    // Local dev has nothing real to show: no binding, or (under `vite dev`'s
    // platform proxy) an empty local POW namespace. Real data always wins.
    if (env.loadDevFixture) return { state: 'ok', summary: await env.loadDevFixture() };
    return { state: result.kind };
  }
  const { body, cacheControl } = summaryHttp(result.stored, env.url, {
    tokenMissing: result.tokenMissing
  });
  // Same policy as /api/pow: a cached page must never hide a backfill or resync.
  env.setHeaders({ 'cache-control': cacheControl });
  return { state: 'ok', summary: JSON.parse(body) as PowPayload };
}
