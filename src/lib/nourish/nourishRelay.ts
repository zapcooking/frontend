/**
 * Nourish Relay Module
 *
 * Queries the pantry relay for existing Nourish analysis events (kind 30078)
 * published by the Zap Cooking service account. This enables share-once-read-many:
 * one GPT analysis serves all future viewers of a recipe.
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { NDKRelaySet } from '@nostr-dev-kit/ndk';
import {
  NOURISH_SERVICE_PUBKEY,
  NOURISH_CACHE_VERSION,
  computeOverallScore,
  type NourishScores,
  type NourishRelayResult,
  type IngredientSignal
} from './types';

const PANTRY_RELAY = 'wss://pantry.zap.cooking';
// Default pantry query timeout. Commit 2 holds this at 4s to preserve
// current behavior; commit 4 drops it to 2s when the retry UI lands.
const DEFAULT_QUERY_TIMEOUT_MS = 4000;

// ─── Content hashing ────────────────────────────────────────

/**
 * Compute SHA-256 hash of recipe content for staleness detection.
 * Uses Web Crypto API (available in browser and Cloudflare Workers).
 */
export async function computeContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── D-tag construction ─────────────────────────────────────

/** Build the d-tag for a Nourish event referencing a recipe. */
export function buildNourishDTag(recipePubkey: string, recipeDTag: string): string {
  return `nourish:30023:${recipePubkey}:${recipeDTag}`;
}

// ─── Relay query ────────────────────────────────────────────

/**
 * Fetch an existing Nourish analysis event from the pantry relay.
 * Returns null if no analysis exists for this recipe.
 *
 * Retained for existing callers outside the resolver path (e.g.
 * nourishDiscovery). The resolver uses queryNourishEvent below,
 * which returns a discriminated hit/miss result. Migration of the
 * discovery caller to queryNourishEvent is a follow-up; once that
 * lands, this wrapper can be deleted.
 */
export async function fetchNourishEvent(
  ndk: NDK,
  recipePubkey: string,
  recipeDTag: string
): Promise<NourishRelayResult | null> {
  const res = await queryNourishEvent(ndk, recipePubkey, recipeDTag);
  return res.status === 'hit' ? res.result : null;
}

/**
 * Query the pantry relay with a discriminated result.
 *
 * Commit 2 folds timeout into `miss` to preserve current behavior;
 * commit 4 splits `timeout` out as a third status so the retry UI
 * can distinguish "pantry didn't respond" from "pantry confirmed no
 * event." Default timeoutMs stays at 4s in commit 2 for pure-refactor
 * no-op semantics; commit 4 drops the default to 2s.
 */
export async function queryNourishEvent(
  ndk: NDK,
  recipePubkey: string,
  recipeDTag: string,
  timeoutMs: number = DEFAULT_QUERY_TIMEOUT_MS
): Promise<{ status: 'hit'; result: NourishRelayResult } | { status: 'miss' }> {
  const dTag = buildNourishDTag(recipePubkey, recipeDTag);

  try {
    const filter = {
      kinds: [30078 as number],
      authors: [NOURISH_SERVICE_PUBKEY],
      '#d': [dTag]
    };

    const relaySet = NDKRelaySet.fromRelayUrls([PANTRY_RELAY], ndk, true);

    const eventPromise = ndk.fetchEvent(filter, undefined, relaySet);
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs)
    );

    const event = await Promise.race([eventPromise, timeoutPromise]);
    if (!event) return { status: 'miss' };

    const parsed = parseNourishEvent(event);
    if (!parsed) return { status: 'miss' };

    return { status: 'hit', result: parsed };
  } catch {
    return { status: 'miss' };
  }
}

// ─── Event parsing ──────────────────────────────────────────

/** Parse a kind 30078 Nourish event into a typed result. */
export function parseNourishEvent(event: NDKEvent): NourishRelayResult | null {
  try {
    const content = JSON.parse(event.content);

    // Extract scores — recompute overall with current weights for forward compatibility
    const gutScore = content.gut?.score ?? 0;
    const proteinScore = content.protein?.score ?? 0;
    const realFoodScore = content.realFood?.score ?? 0;
    const overall = computeOverallScore(gutScore, proteinScore, realFoodScore);

    const scores: NourishScores = {
      gut: {
        score: gutScore,
        label: content.gut?.label || 'Moderate',
        reason: content.gut?.reason || ''
      },
      protein: {
        score: proteinScore,
        label: content.protein?.label || 'Moderate',
        reason: content.protein?.reason || ''
      },
      realFood: {
        score: realFoodScore,
        label: content.realFood?.label || 'Moderate',
        reason: content.realFood?.reason || ''
      },
      overall: {
        score: overall.score,
        label: overall.label,
        reason: content.overall?.reason || `Weighted: Real Food 45%, Gut 35%, Protein 20%`
      },
      summary: content.summary || '',
      // Accept both the new `cacheVersion` and the legacy `version` field
      // so pre-2.0 events in the wild still parse.
      cacheVersion: content.cacheVersion || content.version || NOURISH_CACHE_VERSION
    };

    const improvements: string[] = Array.isArray(content.improvements)
      ? content.improvements.filter((s: unknown) => typeof s === 'string')
      : [];

    const ingredientSignals: IngredientSignal[] = Array.isArray(content.ingredient_signals)
      ? content.ingredient_signals.filter((i: any) => i && typeof i.name === 'string')
      : [];

    // Extract metadata from tags. Untagged legacy events surface as
    // 'unknown' so the admin rescore-candidates view can triage them,
    // rather than being silently mislabelled as v1.
    const contentHash = event.tags.find((t) => t[0] === 'content_hash')?.[1] || '';
    const promptVersion = event.tags.find((t) => t[0] === 'prompt_version')?.[1] || 'unknown';
    const nourishVersion = event.tags.find((t) => t[0] === 'nourish_version')?.[1] || NOURISH_CACHE_VERSION;

    return {
      scores,
      improvements,
      ingredientSignals,
      contentHash,
      promptVersion,
      nourishVersion,
      createdAt: event.created_at || 0,
      eventId: event.id
    };
  } catch {
    return null;
  }
}

// ─── Staleness detection ────────────────────────────────────

/**
 * Check if a Nourish analysis is stale (recipe content changed since analysis).
 * Compares the stored content_hash against the current recipe content hash.
 */
export async function isNourishStale(
  relayResult: NourishRelayResult,
  currentRecipeContent: string
): Promise<boolean> {
  if (!relayResult.contentHash) return true; // No hash stored — assume stale
  const currentHash = await computeContentHash(currentRecipeContent);
  return currentHash !== relayResult.contentHash;
}
