/**
 * GET /api/pow — the /pow summary (merged PRs across REPOS since START).
 *
 *   200 { lastSuccessAt, stale, dataVersion, complete, ...Summary }  with
 *       ETag; 304 on If-None-Match (a W/ copy counts). `stale` is true while GitHub is refusing us (or no
 *       token is set) — the numbers are the last good ones, as of
 *       lastSuccessAt.
 *   503 { code: 'POW_UNCONFIGURED' }  no POW binding, or no summary yet and
 *                                     no usable token (missing or refused)
 *   503 { code: 'POW_UNAVAILABLE' }   no summary yet and the cold start
 *                                     failed for another reason / KV error
 *
 * Fresh summary (< STALE_MS): served from KV, zero GitHub calls. Cached
 * at the edge for 60 s once complete; `no-store` while complete:false. Stale:
 * served as-is while one budgeted refresh runs in waitUntil. Missing
 * (first ever request): one budgeted refresh runs inline, so the response
 * may be partial — `complete: false` until the backfill finishes over the
 * next few requests.
 *
 * The token will expire someday, and /pow must go stale, not dead: once a
 * summary exists, a missing or refused token only stops refreshes.
 * Refusals back off and log one of
 *   [pow] github_auth_failed status=401|403|graphql_not_found|…  (1 hour)
 *   [pow] github_rate_limited status=403|429|graphql_rate_limited retry_at=…
 *       (until Retry-After / x-ratelimit-reset, else 1 hour)
 *
 * Never logs or returns the token, request headers, or raw error objects.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { etagMatches, serveSummary, summaryHttp } from '$lib/shipped/serve.server';

const unconfigured = () =>
  json({ code: 'POW_UNCONFIGURED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
const unavailable = (retryAfterSeconds?: number) =>
  json(
    { code: 'POW_UNAVAILABLE' },
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        ...(retryAfterSeconds ? { 'Retry-After': String(retryAfterSeconds) } : {})
      }
    }
  );

export const GET: RequestHandler = async ({ request, platform }) => {
  // Cold start, stale-while-revalidate, locks and backoff all live in
  // serveSummary, shared with the /pow page's server load.
  const result = await serveSummary(platform);
  if (result.kind === 'unconfigured') return unconfigured();
  if (result.kind === 'unavailable') return unavailable(result.retryAfterSeconds);

  const { body, etag, cacheControl } = summaryHttp(result.stored, new URL(request.url), {
    tokenMissing: result.tokenMissing
  });
  const headers = { ETag: etag, 'Cache-Control': cacheControl };
  if (etagMatches(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status: 200,
    // Explicit charset: without it some browsers decode PR titles as
    // Latin-1 and show "—" as "â€”".
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
  });
};
