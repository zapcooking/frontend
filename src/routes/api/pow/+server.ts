/**
 * GET /api/pow — the /pow summary (merged PRs across REPOS since START).
 *
 *   200 { lastSuccessAt, stale, complete, ...Summary }  with ETag; 304 on
 *       If-None-Match. `stale` is true while GitHub is refusing us (or no
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
import { GithubError, createGithubClient } from '$lib/shipped/github.server';
import {
  backoffUntil,
  isStale,
  recordRefusal,
  refreshPow,
  servedSummary
} from '$lib/shipped/refresh.server';
import {
  readSummary,
  tryAcquireLock,
  type PowKV,
  type StoredSummary
} from '$lib/shipped/store.server';

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

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : 'unknown error';
}

/** Set if GitHub refused (auth or rate limit) rather than failed. */
function refusalOf(e: unknown) {
  return e instanceof GithubError ? e.refusal : null;
}

/** Refresh, logging the outcome. Refusals are recorded as a backoff, then rethrown. */
async function runRefresh(kv: PowKV, token: string): Promise<StoredSummary> {
  try {
    const outcome = await refreshPow(kv, createGithubClient(token));
    console.log(
      `[pow] refresh github_calls=${outcome.githubCalls} overflow_calls=${outcome.overflowCalls} ` +
        `upserted=${outcome.upserted} recomputed=${outcome.recomputed} ` +
        `complete=${outcome.stored.complete} wall_ms=${outcome.wallMs} ` +
        `deadline_hit=${outcome.deadlineHit}`
    );
    return outcome.stored;
  } catch (e) {
    const refusal = refusalOf(e);
    if (refusal) {
      const until = await recordRefusal(kv, refusal, new Date());
      console.error(
        refusal.kind === 'auth'
          ? `[pow] github_auth_failed status=${refusal.label}`
          : `[pow] github_rate_limited status=${refusal.label} retry_at=${until.toISOString()}`
      );
    }
    throw e;
  }
}

function respond(
  stored: StoredSummary,
  request: Request,
  opts: { tokenMissing?: boolean } = {}
): Response {
  const { body, etag } = servedSummary(stored, opts);
  const headers = {
    ETag: etag,
    // While a backfill or resync is still running, never let the edge cache
    // hold a response: a cache hit skips this handler, so it would also
    // skip the refresh that moves the backfill along. Refreshes stay
    // lock- and backoff-gated either way.
    'Cache-Control': stored.complete ? 'public, max-age=60' : 'no-store'
  };
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

export const GET: RequestHandler = async ({ request, platform }) => {
  const kv = platform?.env?.POW;
  const token = platform?.env?.POW_GITHUB_TOKEN;
  if (!kv) {
    console.warn('[pow] unconfigured (POW binding missing)');
    return unconfigured();
  }

  let stored: StoredSummary | null;
  try {
    stored = await readSummary(kv);
  } catch (e) {
    console.error(`[pow] summary read failed: ${errorText(e)}`);
    return unavailable();
  }

  if (!token) {
    console.warn('[pow] POW_GITHUB_TOKEN missing, serving last summary github_calls=0');
    return stored ? respond(stored, request, { tokenMissing: true }) : unconfigured();
  }

  if (!stored) {
    try {
      return respond(await runRefresh(kv, token), request);
    } catch (e) {
      // No summary to fall back on. A refused token is a config problem;
      // a rate limit on the very first request is just "not yet".
      const refusal = refusalOf(e);
      if (refusal?.kind === 'auth') return unconfigured();
      if (!refusal) {
        console.error(`[pow] cold start failed: ${errorText(e)}`);
        return unavailable();
      }
      // Rate limited: tell the client when GitHub said to come back.
      const now = new Date();
      const waitMs = backoffUntil(refusal, now).getTime() - now.getTime();
      return unavailable(Math.ceil(waitMs / 1000));
    }
  }

  const now = new Date();
  try {
    if (!isStale(stored, now)) {
      console.log('[pow] fresh github_calls=0');
    } else if (platform?.ctx && (await tryAcquireLock(kv, now))) {
      platform.ctx.waitUntil(
        runRefresh(kv, token).catch((e) => {
          if (!refusalOf(e)) console.error(`[pow] background refresh failed: ${errorText(e)}`);
        })
      );
      console.log('[pow] stale, refreshing in background');
    } else {
      console.log('[pow] stale, refresh already running github_calls=0');
    }
  } catch (e) {
    // A lock hiccup must not cost the reader the summary we already have.
    console.error(`[pow] refresh scheduling failed: ${errorText(e)}`);
  }
  return respond(stored, request);
};
