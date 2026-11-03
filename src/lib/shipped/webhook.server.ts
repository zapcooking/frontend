/**
 * The zapcooking org webhook → /pow, pushed on merge.
 *
 * verifySignature() runs over the exact request bytes, before any parse.
 * classifyDelivery() decides what a verified delivery means; REPOS is the
 * allowlist here exactly as everywhere else (the org webhook also sends
 * events for private repos such as member-relay — those are dropped).
 * applyDelivery() does the KV work, and runs in waitUntil.
 *
 * Only a merge needs GitHub (per-file stats aren't in the payload). Title
 * edits and label changes come from the verified payload itself.
 */

import { POW_ORG, START_MS, isPowRepo, type PowRepo } from './config';
import { GithubError, fetchOne, type GithubClient, type GithubRefusal } from './github.server';
import { rebuildSummary } from './refresh.server';
import {
  readRecord,
  readSummary,
  releaseLock,
  tryAcquireLock,
  upsertRecords,
  writeSummary,
  type PowKV
} from './store.server';
import type { PrRecord } from './types';

/** Exactly `sha256=` and 64 hex digits; anything else is malformed. */
const SIGNATURE_RE = /^sha256=([0-9a-fA-F]{64})$/;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * X-Hub-Signature-256 check: HMAC-SHA256 of the raw body under the shared
 * secret. crypto.subtle.verify does the comparison, in constant time.
 */
export async function verifySignature(
  body: Uint8Array,
  header: string | null,
  secret: string
): Promise<boolean> {
  const match = header ? SIGNATURE_RE.exec(header) : null;
  if (!match) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify('HMAC', key, hexToBytes(match[1]) as BufferSource, body as BufferSource);
}

interface PullRequestPayload {
  action?: string;
  repository?: { name?: string; owner?: { login?: string } };
  pull_request?: {
    node_id?: string;
    number?: number;
    title?: string;
    merged?: boolean;
    merged_at?: string | null;
    labels?: Array<{ name?: string }>;
  };
}

export type Delivery =
  | { kind: 'ping' }
  | { kind: 'ignore'; reason: string; action?: string; repo?: string; number?: number }
  | { kind: 'merged'; action: string; repo: PowRepo; number: number }
  | {
      kind: 'patch';
      action: string;
      repo: PowRepo;
      number: number;
      id: string;
      mergedAt: string;
      patch: Partial<Pick<PrRecord, 'title' | 'labels'>>;
    };

/** What a verified delivery asks of us. Pure. */
export function classifyDelivery(event: string | null, payload: unknown): Delivery {
  if (event === 'ping') return { kind: 'ping' };
  if (event !== 'pull_request') return { kind: 'ignore', reason: 'event' };

  const p = (payload ?? {}) as PullRequestPayload;
  const action = typeof p.action === 'string' ? p.action : undefined;
  const repo = p.repository?.name;
  const pr = p.pull_request;
  const number = typeof pr?.number === 'number' ? pr.number : undefined;
  const base = { action, repo, number };

  if (p.repository?.owner?.login !== POW_ORG || !repo || !isPowRepo(repo)) {
    return { kind: 'ignore', reason: 'repo_not_allowlisted', ...base };
  }
  if (!pr || number === undefined || pr.merged !== true || !pr.merged_at || !pr.node_id) {
    return { kind: 'ignore', reason: 'not_merged', ...base };
  }
  if (Date.parse(pr.merged_at) < START_MS) {
    return { kind: 'ignore', reason: 'before_start', ...base };
  }

  switch (action) {
    case 'closed':
      return { kind: 'merged', action, repo, number };
    case 'edited':
      if (typeof pr.title !== 'string') return { kind: 'ignore', reason: 'no_title', ...base };
      return {
        kind: 'patch',
        action,
        repo,
        number,
        id: pr.node_id,
        mergedAt: pr.merged_at,
        patch: { title: pr.title }
      };
    case 'labeled':
    case 'unlabeled':
      return {
        kind: 'patch',
        action,
        repo,
        number,
        id: pr.node_id,
        mergedAt: pr.merged_at,
        patch: {
          labels: (pr.labels ?? []).map((l) => l.name).filter((n): n is string => typeof n === 'string')
        }
      };
    default:
      return { kind: 'ignore', reason: 'action', ...base };
  }
}

export type ApplyOutcome =
  | 'applied'
  | 'unchanged'
  | 'not_merged'
  | 'refused'
  | 'deferred_no_summary'
  | 'deferred_backoff'
  | 'deferred_locked'
  | 'deferred_no_token'
  | 'deferred_not_stored';

/**
 * Apply one merge or patch to KV: idempotent upsert, then (only if the
 * record changed) recompute the summary and advance pow:head.
 *
 * Deferrals are safe: the webhook only ever speeds things up. The PR's
 * updatedAt is newer than every cursor, so the next cursor sync picks up
 * whatever a deferred delivery would have written.
 *
 * Takes the refresh lock so a webhook write and a cursor sync don't
 * read-modify-write the same shard at once (best-effort; see
 * tryAcquireLock and FULL_RESYNC_MS), and releases it when done.
 */
export async function applyDelivery(
  kv: PowKV,
  delivery: Extract<Delivery, { kind: 'merged' | 'patch' }>,
  makeClient: (() => GithubClient) | null,
  now: Date = new Date()
): Promise<{ outcome: ApplyOutcome; refusal?: GithubRefusal }> {
  const stored = await readSummary(kv);
  // No summary yet: the backfill in progress will include this PR.
  if (!stored) return { outcome: 'deferred_no_summary' };
  if (delivery.kind === 'merged') {
    if (!makeClient) return { outcome: 'deferred_no_token' };
    // GitHub told us to back off; don't call it. Payload-only patches are fine.
    if (stored.backoff && now.getTime() < Date.parse(stored.backoff.until)) {
      return { outcome: 'deferred_backoff' };
    }
  }
  if (!(await tryAcquireLock(kv, now))) return { outcome: 'deferred_locked' };

  try {
    let record: PrRecord | null;
    if (delivery.kind === 'merged') {
      try {
        record = await fetchOne(makeClient!(), delivery.repo, delivery.number);
      } catch (e) {
        if (e instanceof GithubError && e.refusal) return { outcome: 'refused', refusal: e.refusal };
        throw e;
      }
      if (!record) return { outcome: 'not_merged' };
    } else {
      const existing = await readRecord(kv, delivery.repo, delivery.mergedAt, delivery.id);
      // Not stored yet (e.g. mid-backfill): the sync will fetch it whole.
      if (!existing) return { outcome: 'deferred_not_stored' };
      record = { ...existing, ...delivery.patch };
    }

    if ((await upsertRecords(kv, [record])) === 0) return { outcome: 'unchanged' };

    // Re-read: a refresh may have written the summary since we started.
    const current = (await readSummary(kv)) ?? stored;
    const { body, etag, asOfDate } = await rebuildSummary(kv, now, current.complete);
    // Freshness, backoff and sync bookkeeping are the refresh's to manage.
    await writeSummary(kv, { ...current, body, etag, asOfDate });
    return { outcome: 'applied' };
  } finally {
    await releaseLock(kv);
  }
}
