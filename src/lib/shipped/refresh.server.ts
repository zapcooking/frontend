/**
 * One budgeted refresh of the /pow data: sync each repo (resuming any
 * split backfill), upsert, and recompute the summary only if something
 * changed. Sized for free-tier Workers limits — at most CALL_BUDGET
 * GitHub requests per invocation, so a cold backfill (~22 calls) spans a
 * couple of refreshes rather than one oversized request.
 */

import { REPOS } from './config';
import { syncRepo, type GithubClient, type GithubRefusal } from './github.server';
import { rollup, zonedDate } from './rollup';
import {
  readAllRecords,
  readRepoState,
  readSummary,
  upsertRecords,
  writeHead,
  writeRepoState,
  writeSummary,
  type PowKV,
  type StoredSummary
} from './store.server';

/** A summary older than this is served stale and refreshed in the background. */
export const STALE_MS = 60 * 60 * 1000;

/**
 * GitHub calls per refresh. Leaves headroom under the free plan's 50
 * subrequests for >100-file overflow fetches, which can overshoot by a few.
 */
export const CALL_BUDGET = 12;

/** Floor on a header-derived backoff, so a reset time already past can't spin. */
const MIN_BACKOFF_MS = 60 * 1000;

export function isStale(stored: StoredSummary, now: Date): boolean {
  if (stored.backoff && now.getTime() < Date.parse(stored.backoff.until)) return false;
  return !stored.complete || now.getTime() - Date.parse(stored.lastSuccessAt) > STALE_MS;
}

/**
 * When to try again after a refusal: a rate limit's own reset time when
 * GitHub gave one, otherwise STALE_MS from now.
 */
export function backoffUntil(refusal: GithubRefusal, now: Date): Date {
  const nowMs = now.getTime();
  if (refusal.kind === 'rate_limited' && refusal.retryAtMs !== null) {
    return new Date(Math.max(refusal.retryAtMs, nowMs + MIN_BACKOFF_MS));
  }
  return new Date(nowMs + STALE_MS);
}

/**
 * GitHub refused: keep the last good summary exactly as it is and record
 * the backoff. Returns when retries resume. No-op write if there's no summary.
 */
export async function recordRefusal(
  kv: PowKV,
  refusal: GithubRefusal,
  now: Date
): Promise<Date> {
  const until = backoffUntil(refusal, now);
  const prev = await readSummary(kv);
  if (prev) {
    await writeSummary(kv, {
      ...prev,
      backoff: { reason: refusal.kind, label: refusal.label, until: until.toISOString() }
    });
  }
  return until;
}

/**
 * The response for a stored summary: its body with `lastSuccessAt` and
 * `stale` prepended, and an ETag covering both. `stale` is true while a
 * refusal or its backoff stands (or no token is configured), so an expired
 * token is visible on the endpoint itself.
 */
export function servedSummary(
  stored: StoredSummary,
  opts: { tokenMissing?: boolean } = {}
): { body: string; etag: string } {
  const stale = Boolean(stored.backoff) || Boolean(opts.tokenMissing);
  const meta = `"lastSuccessAt":${JSON.stringify(stored.lastSuccessAt)},"stale":${stale},`;
  const version = `${Date.parse(stored.lastSuccessAt).toString(36)}${stale ? 's' : ''}`;
  return {
    body: `{${meta}${stored.body.slice(1)}`,
    etag: `${stored.etag.slice(0, -1)}.${version}"`
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface RefreshOutcome {
  stored: StoredSummary;
  githubCalls: number;
  /** Of githubCalls, the >100-file follow-ups that ran past CALL_BUDGET's page count. */
  overflowCalls: number;
  upserted: number;
  recomputed: boolean;
}

export async function refreshPow(
  kv: PowKV,
  client: GithubClient,
  now: Date = new Date()
): Promise<RefreshOutcome> {
  let upserted = 0;
  let overflowCalls = 0;
  let complete = true;

  for (const repo of REPOS) {
    const remaining = CALL_BUDGET - client.calls;
    if (remaining < 1) {
      complete = false;
      continue;
    }
    const state = await readRepoState(kv, repo);
    const result = await syncRepo(client, repo, state, remaining);
    overflowCalls += result.overflowCalls;
    // Records before state: a crash in between re-reads the page next time,
    // which the idempotent upsert absorbs.
    upserted += await upsertRecords(kv, result.records);
    if (JSON.stringify(result.state) !== JSON.stringify(state)) {
      await writeRepoState(kv, repo, result.state);
    }
    if (!result.done) complete = false;
  }

  const prev = await readSummary(kv);
  const today = zonedDate(now);
  // The streak is "as of" a day, so a new day recomputes even with no new
  // merges (at most once a day). Otherwise a no-op refresh never re-reads
  // the shards.
  const recomputed =
    upserted > 0 || !prev || prev.asOfDate !== today || prev.complete !== complete;

  let stored: StoredSummary;
  if (recomputed) {
    const summary = rollup(await readAllRecords(kv, now), now);
    const body = JSON.stringify({ complete, ...summary });
    const etag = `"${(await sha256Hex(body)).slice(0, 32)}"`;
    stored = { body, etag, asOfDate: today, complete, lastSuccessAt: now.toISOString() };
    await writeHead(kv, {
      latestId: summary.recent[0]?.id ?? null,
      updatedAt: now.toISOString(),
      etag
    });
  } else {
    // Drops any backoff: GitHub just answered.
    const { backoff: _, ...rest } = prev!;
    stored = { ...rest, lastSuccessAt: now.toISOString() };
  }
  await writeSummary(kv, stored);

  return { stored, githubCalls: client.calls, overflowCalls, upserted, recomputed };
}
