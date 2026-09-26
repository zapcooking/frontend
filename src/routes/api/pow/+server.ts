/**
 * GET /api/pow — the /pow summary (merged PRs across REPOS since START).
 *
 *   200 { complete, ...Summary }  with ETag; 304 on If-None-Match
 *   503 { code: 'POW_UNCONFIGURED' }  token or POW binding missing
 *   503 { code: 'POW_UNAVAILABLE' }   cold start failed / KV error
 *
 * Fresh summary (< STALE_MS): served from KV, zero GitHub calls. Stale:
 * served as-is while one budgeted refresh runs in waitUntil. Missing
 * (first ever request): one budgeted refresh runs inline, so the response
 * may be partial — `complete: false` until the backfill finishes over the
 * next few requests.
 *
 * Never logs or returns the token, request headers, or raw error objects.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { createGithubClient } from '$lib/pow/github.server';
import { isStale, refreshPow } from '$lib/pow/refresh.server';
import { readSummary, tryAcquireLock, type PowKV } from '$lib/pow/store.server';

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : 'unknown error';
}

async function runRefresh(kv: PowKV, token: string) {
  const outcome = await refreshPow(kv, createGithubClient(token));
  console.log(
    `[pow] refresh github_calls=${outcome.githubCalls} upserted=${outcome.upserted} ` +
      `recomputed=${outcome.recomputed} complete=${outcome.stored.complete}`
  );
  return outcome.stored;
}

export const GET: RequestHandler = async ({ request, platform }) => {
  const kv = platform?.env?.POW;
  const token = platform?.env?.POW_GITHUB_TOKEN;
  if (!kv || !token) {
    console.warn('[pow] unconfigured (POW binding or POW_GITHUB_TOKEN missing)');
    return json(
      { code: 'POW_UNCONFIGURED' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  let stored;
  try {
    stored = await readSummary(kv);
    const now = new Date();
    if (!stored) {
      stored = await runRefresh(kv, token);
    } else if (isStale(stored, now)) {
      if (platform?.ctx && (await tryAcquireLock(kv, now))) {
        platform.ctx.waitUntil(
          runRefresh(kv, token).catch((e) =>
            console.error(`[pow] background refresh failed: ${errorText(e)}`)
          )
        );
        console.log('[pow] stale, refreshing in background');
      } else {
        console.log('[pow] stale, refresh already running github_calls=0');
      }
    } else {
      console.log('[pow] fresh github_calls=0');
    }
  } catch (e) {
    console.error(`[pow] failed: ${errorText(e)}`);
    return json(
      { code: 'POW_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const headers = {
    ETag: stored.etag,
    'Cache-Control': 'public, max-age=60'
  };
  if (request.headers.get('if-none-match') === stored.etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(stored.body, {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
};
