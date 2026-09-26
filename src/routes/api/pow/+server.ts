/**
 * GET /api/pow — the /pow summary (merged PRs across REPOS since START).
 *
 *   200 { complete, ...Summary }  with ETag; 304 on If-None-Match
 *   503 { code: 'POW_UNCONFIGURED' }  no POW binding, or no summary yet and
 *                                     no usable token (missing or refused)
 *   503 { code: 'POW_UNAVAILABLE' }   no summary yet and the cold start
 *                                     failed for another reason / KV error
 *
 * Fresh summary (< STALE_MS): served from KV, zero GitHub calls. Stale:
 * served as-is while one budgeted refresh runs in waitUntil. Missing
 * (first ever request): one budgeted refresh runs inline, so the response
 * may be partial — `complete: false` until the backfill finishes over the
 * next few requests.
 *
 * The token will expire someday, and /pow must go stale, not dead: once a
 * summary exists, a missing or refused token only stops refreshes. GitHub
 * refusals log `[pow] github_auth_failed status=…` and back off an hour.
 *
 * Never logs or returns the token, request headers, or raw error objects.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { GithubError, createGithubClient } from '$lib/shipped/github.server';
import { isStale, recordAuthFailure, refreshPow } from '$lib/shipped/refresh.server';
import {
  readSummary,
  tryAcquireLock,
  type PowKV,
  type StoredSummary
} from '$lib/shipped/store.server';

const unconfigured = () =>
  json({ code: 'POW_UNCONFIGURED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
const unavailable = () =>
  json({ code: 'POW_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : 'unknown error';
}

/** The auth-failure label (status or GraphQL type) if GitHub refused the token. */
function authFailure(e: unknown): string | null {
  return e instanceof GithubError ? e.authFailure : null;
}

/** Refresh, logging the outcome. Auth refusals are recorded, then rethrown. */
async function runRefresh(kv: PowKV, token: string): Promise<StoredSummary> {
  try {
    const outcome = await refreshPow(kv, createGithubClient(token));
    console.log(
      `[pow] refresh github_calls=${outcome.githubCalls} overflow_calls=${outcome.overflowCalls} ` +
        `upserted=${outcome.upserted} recomputed=${outcome.recomputed} ` +
        `complete=${outcome.stored.complete}`
    );
    return outcome.stored;
  } catch (e) {
    const auth = authFailure(e);
    if (auth) {
      console.error(`[pow] github_auth_failed status=${auth}`);
      await recordAuthFailure(kv, new Date());
    }
    throw e;
  }
}

function respond(stored: StoredSummary, request: Request): Response {
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
    return stored ? respond(stored, request) : unconfigured();
  }

  if (!stored) {
    try {
      return respond(await runRefresh(kv, token), request);
    } catch (e) {
      if (authFailure(e)) return unconfigured();
      console.error(`[pow] cold start failed: ${errorText(e)}`);
      return unavailable();
    }
  }

  const now = new Date();
  try {
    if (!isStale(stored, now)) {
      console.log('[pow] fresh github_calls=0');
    } else if (platform?.ctx && (await tryAcquireLock(kv, now))) {
      platform.ctx.waitUntil(
        runRefresh(kv, token).catch((e) => {
          if (!authFailure(e)) console.error(`[pow] background refresh failed: ${errorText(e)}`);
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
