/**
 * Nourish Score Resolver
 *
 * Owns the ephemeral cache layers (L1 in-flight Promise cache, L2
 * module memory Map) and orchestrates the full lookup chain for a
 * Nourish score:
 *
 *   L1 in-flight Promise — dedup concurrent calls for the same key
 *   L2 module memory     — session-scoped, no TTL
 *   L3 localStorage      — 7d TTL (via cache.ts)
 *   L4 pantry relay      — durable, authoritative source
 *
 * Commit 2 introduces L1 + L2 with "first non-null in L2 → L3 → L4"
 * semantics. Commit 3 upgrades this to a createdAt-based winner with
 * write-through reconciliation. Commit 4 splits pantry timeout out
 * from miss and introduces the retry UI state.
 *
 * The resolver never computes a fresh score — that's the caller's
 * concern (/api/nourish + membership gating). A `miss` result means
 * "no cached score anywhere for this key"; the caller decides
 * whether to surface "not yet scored" UI or to trigger compute.
 */

import type NDK from '@nostr-dev-kit/ndk';
import { getNourishCache, setNourishScores, type NourishCacheKey } from './cache';
import { queryNourishEvent } from './nourishRelay';
import type { NourishScores, IngredientSignal } from './types';

// ─── Public types ────────────────────────────────────────────

export interface ResolvedEntry {
  scores: NourishScores;
  contentHash?: string;
  createdAt: number;
  improvements?: string[];
  ingredientSignals?: IngredientSignal[];
  promptVersion: string;
}

export type ResolveResult =
  | { status: 'hit'; source: 'memory' | 'local' | 'pantry'; entry: ResolvedEntry }
  | { status: 'miss' };

// ─── Key helpers ────────────────────────────────────────────

const HEX_64_RE = /^[a-fA-F0-9]{64}$/;

function isValidKey(key: NourishCacheKey): boolean {
  return HEX_64_RE.test(key.recipePubkey) && !!key.recipeDTag && !!key.promptVersion;
}

function toMapKey(key: NourishCacheKey): string {
  return `${key.recipePubkey}:${key.recipeDTag}:${key.promptVersion}`;
}

// ─── Layer 1: in-flight Promise cache ────────────────────────

const inflight = new Map<string, Promise<ResolveResult>>();

// ─── Layer 2: module memory Map ─────────────────────────────

const memory = new Map<string, ResolvedEntry>();

/**
 * Drop an L2 memory entry. Used by admin-triggered rescore (PR 4)
 * to force the next resolve to re-query lower layers. Exported now
 * so PR 4 has a stable hook.
 */
export function purgeMemory(key: NourishCacheKey): void {
  memory.delete(toMapKey(key));
}

// ─── Attempt counter (commit 3 activates) ───────────────────

/**
 * Number of consecutive pantry-timeout attempts for a key, within
 * the current 60s window. Commit 2 returns 0 always; commit 3 wires
 * the actual counter; commit 4's UI consumes it.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getAttemptCount(_key: NourishCacheKey): number {
  return 0;
}

// ─── Opportunistic republish hook (PR 3 wires) ──────────────

/**
 * Fire-and-forget republish of a winning score to the pantry relay
 * when we detect a winner whose source is not pantry AND pantry
 * confirmed a miss. Closes drift source #4 (silent publish failure).
 *
 * PR 2: no-op stub. PR 3 wires the implementation.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function scheduleOpportunisticRepublish(_winner: {
  key: NourishCacheKey;
  entry: ResolvedEntry;
}): void {
  // Intentionally empty.
}

// ─── Main entry ─────────────────────────────────────────────

/**
 * Resolve a Nourish score across all cache layers.
 *
 * Same-key concurrent calls dedup via the L1 in-flight Map.
 * Invalid keys (non-hex-64 pubkey, empty d-tag, empty promptVersion)
 * are warned + returned as a miss — lets callers skip the cache path
 * gracefully while surfacing the bug in Workers logs.
 */
export async function resolveScore(
  ndk: NDK,
  key: NourishCacheKey
): Promise<ResolveResult> {
  if (!isValidKey(key)) {
    console.warn('[nourish.resolver.invalid-key]', { key });
    return { status: 'miss' };
  }

  const mapKey = toMapKey(key);
  const existing = inflight.get(mapKey);
  if (existing) return existing;

  const p = doResolve(ndk, key).finally(() => inflight.delete(mapKey));
  inflight.set(mapKey, p);
  return p;
}

// ─── Internal resolution ────────────────────────────────────

async function doResolve(ndk: NDK, key: NourishCacheKey): Promise<ResolveResult> {
  // L2 — module memory
  const l2Hit = memory.get(toMapKey(key));
  if (l2Hit) {
    return { status: 'hit', source: 'memory', entry: l2Hit };
  }

  // L3 — localStorage
  const l3Hit = getNourishCache(key);
  if (l3Hit) {
    const entry: ResolvedEntry = {
      scores: l3Hit.scores,
      contentHash: l3Hit.contentHash,
      // Fall back to localStorage write timestamp for pre-1a entries
      // that lack a persisted createdAt. Matches the fallback the
      // modal already uses for its "analyzed at" label.
      createdAt: l3Hit.createdAt ?? Math.floor(l3Hit.timestamp / 1000),
      improvements: l3Hit.improvements,
      ingredientSignals: l3Hit.ingredientSignals,
      promptVersion: key.promptVersion
    };
    memory.set(toMapKey(key), entry);
    return { status: 'hit', source: 'local', entry };
  }

  // L4 — pantry relay (4s timeout in commit 2; 2s in commit 4)
  const l4 = await queryNourishEvent(ndk, key.recipePubkey, key.recipeDTag);
  if (l4.status === 'hit') {
    const entry: ResolvedEntry = {
      scores: l4.result.scores,
      contentHash: l4.result.contentHash,
      createdAt: l4.result.createdAt,
      improvements: l4.result.improvements,
      ingredientSignals: l4.result.ingredientSignals,
      promptVersion: l4.result.promptVersion
    };

    // Write-through to L2 + L3 so the next mount of the same recipe
    // skips the pantry query. Preserves the modal's existing pattern
    // of writing under the event's promptVersion (not the caller's)
    // — strict version partitioning lives here too.
    const writeKey: NourishCacheKey = {
      recipePubkey: key.recipePubkey,
      recipeDTag: key.recipeDTag,
      promptVersion: l4.result.promptVersion
    };
    memory.set(toMapKey(writeKey), entry);
    setNourishScores(writeKey, entry.scores, {
      contentHash: entry.contentHash,
      createdAt: entry.createdAt,
      improvements: entry.improvements,
      ingredientSignals: entry.ingredientSignals
    });

    return { status: 'hit', source: 'pantry', entry };
  }

  return { status: 'miss' };
}
