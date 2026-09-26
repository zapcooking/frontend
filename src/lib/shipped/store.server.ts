/**
 * KV layout for /pow (namespace binding POW):
 *
 *   pow:prs:{repo}:{yyyy-mm}  PrRecord[] shard, month of mergedAt in UTC
 *                             (a storage detail — display buckets are
 *                             zoned in rollup.ts)
 *   pow:cursor:{repo}         RepoSyncState (cursor + resumable backfill)
 *   pow:summary               StoredSummary (the served body + its ETag)
 *   pow:head                  { latestId, updatedAt, etag } for cheap polling
 *   pow:lock                  best-effort refresh lock
 *
 * Upserts are idempotent by PR id: replaying any sync is harmless, which is
 * what makes the lock's weakness (below) acceptable.
 */

import { REPOS, START_MS, type PowRepo } from './config';
import type { RepoSyncState } from './github.server';
import type { PrRecord } from './types';

export interface PowKV {
  get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface StoredSummary {
  /** Exactly the /api/pow response body. */
  body: string;
  etag: string;
  /** Zone-local day the summary was computed for (its streak is as of this). */
  asOfDate: string;
  /** Every repo fully synced as of the last refresh. */
  complete: boolean;
  /** Last refresh, whether or not it changed anything. Drives staleness. */
  checkedAt: string;
  /**
   * Set when a refresh was refused by GitHub (expired/revoked token). The
   * body stays as the last good summary; retries back off until STALE_MS
   * after this instead of hitting GitHub on every request.
   */
  authFailedAt?: string;
}

export interface PowHead {
  latestId: string | null;
  updatedAt: string;
  etag: string;
}

const SUMMARY_KEY = 'pow:summary';
const HEAD_KEY = 'pow:head';
const LOCK_KEY = 'pow:lock';

const shardKey = (repo: PowRepo, month: string) => `pow:prs:${repo}:${month}`;
const cursorKey = (repo: PowRepo) => `pow:cursor:${repo}`;

async function getJson<T>(kv: PowKV, key: string): Promise<T | null> {
  return ((await kv.get(key, 'json')) as T | null) ?? null;
}

export async function readRepoState(kv: PowKV, repo: PowRepo): Promise<RepoSyncState> {
  return (await getJson<RepoSyncState>(kv, cursorKey(repo))) ?? { cursor: null, pending: null };
}

export async function writeRepoState(
  kv: PowKV,
  repo: PowRepo,
  state: RepoSyncState
): Promise<void> {
  await kv.put(cursorKey(repo), JSON.stringify(state));
}

/**
 * Merge records into their shards by id. Returns how many were new or
 * changed; shards with nothing new are not rewritten.
 */
export async function upsertRecords(kv: PowKV, records: readonly PrRecord[]): Promise<number> {
  const byShard = new Map<string, PrRecord[]>();
  for (const r of records) {
    const key = shardKey(r.repo, r.mergedAt.slice(0, 7));
    byShard.set(key, [...(byShard.get(key) ?? []), r]);
  }

  let changed = 0;
  for (const [key, incoming] of byShard) {
    const existing = (await getJson<PrRecord[]>(kv, key)) ?? [];
    const byId = new Map(existing.map((r) => [r.id, r]));
    let shardChanged = 0;
    for (const r of incoming) {
      const prev = byId.get(r.id);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(r)) {
        byId.set(r.id, r);
        shardChanged += 1;
      }
    }
    if (shardChanged > 0) {
      await kv.put(key, JSON.stringify([...byId.values()]));
      changed += shardChanged;
    }
  }
  return changed;
}

function utcMonths(from: Date, to: Date): string[] {
  const out: string[] = [];
  const d = new Date(`${from.toISOString().slice(0, 7)}-01T00:00:00Z`);
  const end = to.toISOString().slice(0, 7);
  while (d.toISOString().slice(0, 7) <= end) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Every stored record. Shard keys are enumerated from START (not
 * kv.list(), whose results can lag writes by up to a minute).
 */
export async function readAllRecords(kv: PowKV, now: Date): Promise<PrRecord[]> {
  const keys = REPOS.flatMap((repo) => utcMonths(new Date(START_MS), now).map((m) => shardKey(repo, m)));
  const shards = await Promise.all(keys.map((k) => getJson<PrRecord[]>(kv, k)));
  return shards.flatMap((s) => s ?? []);
}

export function readSummary(kv: PowKV): Promise<StoredSummary | null> {
  return getJson<StoredSummary>(kv, SUMMARY_KEY);
}

export async function writeSummary(kv: PowKV, stored: StoredSummary): Promise<void> {
  await kv.put(SUMMARY_KEY, JSON.stringify(stored));
}

export async function writeHead(kv: PowKV, head: PowHead): Promise<void> {
  await kv.put(HEAD_KEY, JSON.stringify(head));
}

/**
 * Best-effort only. KV's minimum expirationTtl is 60s and reads are
 * eventually consistent (another location may not see this put for up to
 * a minute), so two isolates can both "acquire" it. It cuts duplicate
 * refreshes down; it cannot prevent them. Correctness rests on upserts
 * being idempotent by PR id and the cursor only advancing after a
 * complete sync — a duplicate refresh just repeats work.
 */
export async function tryAcquireLock(kv: PowKV, now: Date): Promise<boolean> {
  if (await kv.get(LOCK_KEY)) return false;
  await kv.put(LOCK_KEY, now.toISOString(), { expirationTtl: 60 });
  return true;
}
