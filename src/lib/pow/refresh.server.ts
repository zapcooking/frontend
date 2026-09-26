/**
 * One budgeted refresh of the /pow data: sync each repo (resuming any
 * split backfill), upsert, and recompute the summary only if something
 * changed. Sized for free-tier Workers limits — at most CALL_BUDGET
 * GitHub requests per invocation, so a cold backfill (~22 calls) spans a
 * couple of refreshes rather than one oversized request.
 */

import { REPOS } from './config';
import { syncRepo, type GithubClient } from './github.server';
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

export function isStale(stored: StoredSummary, now: Date): boolean {
  return !stored.complete || now.getTime() - Date.parse(stored.checkedAt) > STALE_MS;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface RefreshOutcome {
  stored: StoredSummary;
  githubCalls: number;
  upserted: number;
  recomputed: boolean;
}

export async function refreshPow(
  kv: PowKV,
  client: GithubClient,
  now: Date = new Date()
): Promise<RefreshOutcome> {
  let upserted = 0;
  let complete = true;

  for (const repo of REPOS) {
    const remaining = CALL_BUDGET - client.calls;
    if (remaining < 1) {
      complete = false;
      continue;
    }
    const state = await readRepoState(kv, repo);
    const result = await syncRepo(client, repo, state, remaining);
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
    stored = { body, etag, asOfDate: today, complete, checkedAt: now.toISOString() };
    await writeHead(kv, {
      latestId: summary.recent[0]?.id ?? null,
      updatedAt: now.toISOString(),
      etag
    });
  } else {
    stored = { ...prev!, checkedAt: now.toISOString() };
  }
  await writeSummary(kv, stored);

  return { stored, githubCalls: client.calls, upserted, recomputed };
}
