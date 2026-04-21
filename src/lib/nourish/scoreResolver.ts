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
 * Resolution algorithm: gather all layer candidates, pick the
 * max-createdAt one (tiebreak: pantry > local > memory), write-through
 * to any layer that's missing or carrying an older entry, and call
 * scheduleOpportunisticRepublish when the winner didn't come from
 * pantry AND pantry confirmed a miss. Pantry timeout with no other
 * candidates returns { status: 'timeout', attemptCount } so the
 * retry UI can surface the blocked state explicitly (drift #1 fix)
 * instead of silently falling through to compute.
 *
 * The resolver never computes a fresh score — that's the caller's
 * concern (/api/nourish + membership gating). A `miss` result means
 * "no cached score anywhere for this key"; the caller decides
 * whether to surface "not yet scored" UI or to trigger compute.
 */

import type NDK from '@nostr-dev-kit/ndk';
import { getNourishCache, setNourishScores, type NourishCacheKey } from './cache';
import { queryNourishEvent } from './nourishRelay';
import type { AudienceScores, NourishScores, IngredientSignal } from './types';

// ─── Public types ────────────────────────────────────────────

export interface ResolvedEntry {
  scores: NourishScores;
  contentHash?: string;
  createdAt: number;
  /**
   * Unix seconds of the last admin rescore. Undefined on first-time
   * scored events (which don't emit the `updated_at` tag). Drives
   * the 24h "Updated" pill.
   */
  updatedAt?: number;
  /**
   * Audience scores from v2 events. Undefined on v1 entries (pre-
   * expansion). Background mode — no UI consumer reads this yet.
   */
  audienceScores?: AudienceScores;
  improvements?: string[];
  ingredientSignals?: IngredientSignal[];
  promptVersion: string;
}

export type ResolveResult =
  | { status: 'hit'; source: 'memory' | 'local' | 'pantry'; entry: ResolvedEntry }
  | { status: 'miss' }
  | { status: 'timeout'; attemptCount: number };

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
 * Drop ephemeral cache entries for a key. Used by admin-triggered
 * rescore (PR 4) to force the next resolve to re-query lower layers.
 *
 * Clears both the L1 in-flight Promise and the L2 memory entry. If
 * only L2 were cleared, an in-flight resolve from just before the
 * purge could repopulate memory with the stale result on resolution.
 */
export function purgeMemory(key: NourishCacheKey): void {
  const mapKey = toMapKey(key);
  inflight.delete(mapKey);
  memory.delete(mapKey);
}

// ─── Attempt counter (fixed 60s window) ─────────────────────
//
// First pantry-timeout opens a 60s window anchored on that moment.
// All timeouts within the window increment the count. A timeout that
// arrives after the window closed opens a fresh window (count = 1).
// A successful resolve invalidates the window so subsequent failures
// start fresh counts.
//
// recordTimeout is dormant in commit 3 (queryNourishEvent still folds
// timeout into miss, so doResolve never detects one). Commit 4 splits
// the timeout status out and calls recordTimeout on each.

interface AttemptWindow {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60_000;
const attempts = new Map<string, AttemptWindow>();

function recordTimeout(key: NourishCacheKey): number {
  const k = toMapKey(key);
  const now = Date.now();
  const existing = attempts.get(k);
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    attempts.set(k, { count: 1, windowStart: now });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

function clearAttempts(key: NourishCacheKey): void {
  attempts.delete(toMapKey(key));
}

export function getAttemptCount(key: NourishCacheKey): number {
  const w = attempts.get(toMapKey(key));
  if (!w || Date.now() - w.windowStart >= WINDOW_MS) return 0;
  return w.count;
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

type CandidateSource = 'memory' | 'local' | 'pantry';

interface Candidate {
  source: CandidateSource;
  entry: ResolvedEntry;
}

// Tiebreak ranks for equal createdAt. Pantry is authoritative, so
// if a local and a pantry entry share the same createdAt we prefer
// pantry. Memory at the bottom because it was populated from L3/L4
// in the first place — pointing back at memory over its source is
// never informative.
const TIEBREAK_RANK: Record<CandidateSource, number> = {
  pantry: 2,
  local: 1,
  memory: 0
};

function pickWinner(candidates: Candidate[]): Candidate {
  return candidates.reduce((best, c) => {
    if (c.entry.createdAt > best.entry.createdAt) return c;
    if (
      c.entry.createdAt === best.entry.createdAt &&
      TIEBREAK_RANK[c.source] > TIEBREAK_RANK[best.source]
    ) {
      return c;
    }
    return best;
  });
}

// Write-through: update any layer that's missing the winner or carries
// an older createdAt. Keyed under the winner's promptVersion (which
// may differ from the requested key's when pantry has an event tagged
// with a different version — strict version partitioning preserved).
//
// Crucially, the existence check must be re-run under the WRITE key,
// not the requested key. When winner.promptVersion !== requestedKey
// .promptVersion, the requested-key L2/L3 lookups say nothing about
// what's stored under writeKey — and blindly writing there could
// overwrite a newer entry (e.g., localStorage has a fresh v1 entry,
// pantry returns an older v1 event while the caller asked for v2:
// the requested-key L3 hit is `undefined`, but the write-key L3 hit
// is the newer v1 entry we must not clobber).
function writeThrough(requestedKey: NourishCacheKey, winner: Candidate): void {
  const writeKey: NourishCacheKey = {
    recipePubkey: requestedKey.recipePubkey,
    recipeDTag: requestedKey.recipeDTag,
    promptVersion: winner.entry.promptVersion
  };
  const writeMapKey = toMapKey(writeKey);

  const existingL2 = memory.get(writeMapKey);
  if (!existingL2 || existingL2.createdAt < winner.entry.createdAt) {
    memory.set(writeMapKey, winner.entry);
  }

  const existingL3 = getNourishCache(writeKey);
  const existingL3CreatedAt =
    existingL3?.createdAt ??
    (existingL3?.timestamp ? Math.floor(existingL3.timestamp / 1000) : 0);
  if (existingL3CreatedAt < winner.entry.createdAt) {
    setNourishScores(writeKey, winner.entry.scores, {
      contentHash: winner.entry.contentHash,
      createdAt: winner.entry.createdAt,
      updatedAt: winner.entry.updatedAt,
      audienceScores: winner.entry.audienceScores,
      improvements: winner.entry.improvements,
      ingredientSignals: winner.entry.ingredientSignals
    });
  }
}

function l3EntryToResolved(
  l3: NonNullable<ReturnType<typeof getNourishCache>>,
  fallbackPromptVersion: string
): ResolvedEntry {
  return {
    scores: l3.scores,
    contentHash: l3.contentHash,
    // Fall back to the localStorage write timestamp for pre-1a entries
    // that lack a persisted createdAt. Matches the fallback the modal
    // already uses for its "analyzed at" label.
    createdAt: l3.createdAt ?? Math.floor(l3.timestamp / 1000),
    updatedAt: l3.updatedAt,
    audienceScores: l3.audienceScores,
    improvements: l3.improvements,
    ingredientSignals: l3.ingredientSignals,
    // Prefer the entry's stored promptVersion over the caller's hint.
    // Matters on legacy-version fallback lookups: a v2-keyed caller
    // finding a v1 entry via fallback must see promptVersion = '1' so
    // downstream consumers (flag button, admin aggregation) record the
    // correct version.
    promptVersion: l3.promptVersion ?? fallbackPromptVersion
  };
}

// Previous prompt versions to fall back to on a cache miss under the
// current version. Allows returning-user offline continuity during the
// expansion rollout — an older cached entry still resolves under a
// newer lookup until rescore migrates the pantry event. Add each new
// predecessor here when NOURISH_PROMPT_VERSION bumps so cached entries
// don't go orphaned.
const LEGACY_PROMPT_VERSIONS = ['1', '2', 'unknown'] as const;

async function doResolve(ndk: NDK, key: NourishCacheKey): Promise<ResolveResult> {
  // Gather candidates from every layer before deciding. Unlike commit
  // 2's first-non-null short-circuit, we need all of them because a
  // stale L2 or L3 must lose to a newer pantry event, and vice versa.
  const candidates: Candidate[] = [];

  const l2Hit = memory.get(toMapKey(key));
  if (l2Hit) candidates.push({ source: 'memory', entry: l2Hit });

  const l3Hit = getNourishCache(key);
  if (l3Hit) {
    candidates.push({
      source: 'local',
      entry: l3EntryToResolved(l3Hit, key.promptVersion)
    });
  }

  // Legacy-version fallback: during the expansion rollout window,
  // returning users have v1 entries under v1 keys from prior sessions.
  // Without this fallback, every v2 lookup would miss L2/L3 and force
  // a pantry round-trip (or break entirely when offline) until a bulk
  // rescore migrates pantry events + a subsequent resolve writes v2
  // entries. The fallback preserves the "no user-visible change"
  // contract during the migration window. Skipped once we've already
  // got hits under the requested version so fresh reads stay cheap.
  if (!l2Hit && !l3Hit) {
    for (const legacyVersion of LEGACY_PROMPT_VERSIONS) {
      if (legacyVersion === key.promptVersion) continue;
      const legacyKey: NourishCacheKey = {
        recipePubkey: key.recipePubkey,
        recipeDTag: key.recipeDTag,
        promptVersion: legacyVersion
      };
      const legacyL2 = memory.get(toMapKey(legacyKey));
      if (legacyL2) {
        candidates.push({ source: 'memory', entry: legacyL2 });
      }
      const legacyL3 = getNourishCache(legacyKey);
      if (legacyL3) {
        candidates.push({
          source: 'local',
          entry: l3EntryToResolved(legacyL3, legacyVersion)
        });
      }
    }
  }

  const l4 = await queryNourishEvent(ndk, key.recipePubkey, key.recipeDTag);
  if (l4.status === 'hit') {
    candidates.push({
      source: 'pantry',
      entry: {
        scores: l4.result.scores,
        contentHash: l4.result.contentHash,
        createdAt: l4.result.createdAt,
        updatedAt: l4.result.updatedAt,
        audienceScores: l4.result.audienceScores,
        improvements: l4.result.improvements,
        ingredientSignals: l4.result.ingredientSignals,
        promptVersion: l4.result.promptVersion
      }
    });
  }

  // Emit pantry-timeout warn regardless of other candidates so the
  // Workers log captures p95 data for calibration. recordTimeout is
  // only called when the user is blocked (no other candidates) — the
  // counter drives the "Score now" escape hatch, not observability.
  if (l4.status === 'timeout') {
    console.warn('[nourish.pantry.timeout]', { key: toMapKey(key) });
  }

  if (candidates.length === 0) {
    if (l4.status === 'timeout') {
      return { status: 'timeout', attemptCount: recordTimeout(key) };
    }
    return { status: 'miss' };
  }

  const winner = pickWinner(candidates);

  writeThrough(key, winner);

  // Winner isn't pantry AND pantry confirmed miss → our local cache
  // has a score pantry doesn't know about. Republish it so the next
  // cold client isn't forced to recompute. No-op stub in PR 2; PR 3
  // wires the implementation.
  if (winner.source !== 'pantry' && l4.status === 'miss') {
    scheduleOpportunisticRepublish({ key, entry: winner.entry });
  }

  // Successful resolve invalidates the attempt window — subsequent
  // failures start fresh counts rather than inheriting a stale streak.
  clearAttempts(key);

  return { status: 'hit', source: winner.source, entry: winner.entry };
}
