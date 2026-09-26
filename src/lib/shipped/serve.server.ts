/**
 * Serve-or-refresh for the /pow summary, shared by GET /api/pow and the
 * /pow page's server load so both behave identically: the same cold
 * start, the same stale-while-revalidate refresh in waitUntil, the same
 * lock and backoff gates, the same Cache-Control.
 *
 * Moved verbatim out of src/routes/api/pow/+server.ts (a pure refactor).
 * The page needs it too: it reads KV directly instead of self-fetching
 * /api/pow, and without this the stale refresh, the ET day rollover and
 * the weekly resync would only ever run when someone hit /api/pow.
 */

import { GithubError, createGithubClient } from './github.server';
import { backoffUntil, isStale, recordRefusal, refreshPow, servedSummary } from './refresh.server';
import {
  readSummary,
  releaseLock,
  tryAcquireLock,
  type PowKV,
  type StoredSummary
} from './store.server';

export interface PowPlatform {
  env?: { POW?: PowKV; POW_GITHUB_TOKEN?: string };
  ctx?: { waitUntil(promise: Promise<unknown>): void };
}

export type ServeResult =
  /** No POW binding, or no summary yet and no usable token. */
  | { kind: 'unconfigured' }
  /** No summary yet and the cold start failed (or is already running). */
  | { kind: 'unavailable'; retryAfterSeconds?: number }
  | { kind: 'ok'; stored: StoredSummary; tokenMissing: boolean };

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
        `deadline_hit=${outcome.deadlineHit}` +
        (outcome.resyncStarted ? ` resync_started=${outcome.resyncStarted}` : '')
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

/** Read the summary, cold-starting or scheduling a refresh as needed. */
export async function serveSummary(platform: PowPlatform | undefined): Promise<ServeResult> {
  const kv = platform?.env?.POW;
  const token = platform?.env?.POW_GITHUB_TOKEN;
  if (!kv) {
    console.warn('[pow] unconfigured (POW binding missing)');
    return { kind: 'unconfigured' };
  }

  let stored: StoredSummary | null;
  try {
    stored = await readSummary(kv);
  } catch (e) {
    console.error(`[pow] summary read failed: ${errorText(e)}`);
    return { kind: 'unavailable' };
  }

  if (!token) {
    console.warn('[pow] POW_GITHUB_TOKEN missing, serving last summary github_calls=0');
    return stored ? { kind: 'ok', stored, tokenMissing: true } : { kind: 'unconfigured' };
  }

  if (!stored) {
    // One cold start at a time (best-effort, like every use of the lock).
    let locked = false;
    try {
      locked = await tryAcquireLock(kv, new Date());
    } catch (e) {
      console.error(`[pow] cold start lock failed: ${errorText(e)}`);
    }
    if (!locked) {
      console.log('[pow] cold start already running github_calls=0');
      return { kind: 'unavailable', retryAfterSeconds: 60 };
    }
    try {
      return { kind: 'ok', stored: await runRefresh(kv, token), tokenMissing: false };
    } catch (e) {
      // No summary to fall back on. A refused token is a config problem;
      // a rate limit on the very first request is just "not yet".
      const refusal = refusalOf(e);
      if (refusal?.kind === 'auth') return { kind: 'unconfigured' };
      if (!refusal) {
        console.error(`[pow] cold start failed: ${errorText(e)}`);
        return { kind: 'unavailable' };
      }
      // Rate limited: tell the client when GitHub said to come back.
      const now = new Date();
      const waitMs = backoffUntil(refusal, now).getTime() - now.getTime();
      return { kind: 'unavailable', retryAfterSeconds: Math.ceil(waitMs / 1000) };
    } finally {
      await releaseLock(kv).catch(() => {});
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
  return { kind: 'ok', stored, tokenMissing: false };
}

/**
 * `?v=` names the data version the caller expects (pow:head.etag, quotes
 * optional) and gives each version its own edge-cache key. KV reads can lag
 * a write by up to a minute elsewhere, so a `v` this location can't serve
 * yet must never be cached under that key.
 */
function versionMismatch(url: URL, stored: StoredSummary): boolean {
  const v = url.searchParams.get('v');
  return v !== null && v.replace(/"/g, '') !== stored.etag.replace(/"/g, '');
}

/**
 * The response parts for a stored summary: body, ETag, and the one
 * Cache-Control policy both /api/pow and the /pow page use. While a
 * backfill or resync is still running, never let the edge cache hold a
 * response: a cache hit skips the handler, so it would also skip the
 * refresh that moves the backfill along.
 */
export function summaryHttp(
  stored: StoredSummary,
  url: URL,
  opts: { tokenMissing?: boolean } = {}
): { body: string; etag: string; cacheControl: string } {
  const { body, etag } = servedSummary(stored, opts);
  const cacheable = stored.complete && !versionMismatch(url, stored);
  return { body, etag, cacheControl: cacheable ? 'public, max-age=60' : 'no-store' };
}

/**
 * If-None-Match against our strong ETag. Cloudflare may hand clients a
 * weakened W/"…" copy when it compresses a response, and clients echo it
 * back; a weak comparison (RFC 9110 §13.1.2) is right for a 304. Handles
 * lists and `*`.
 */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const strip = (t: string) => t.trim().replace(/^W\//, '');
  const ours = strip(etag);
  return ifNoneMatch.split(',').some((t) => t.trim() === '*' || strip(t) === ours);
}
