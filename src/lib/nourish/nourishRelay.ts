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
  type AudienceScores,
  type NourishRelayResult,
  type IngredientSignal
} from './types';
export type { NourishRelayResult } from './types';

const PANTRY_RELAY = 'wss://pantry.zap.cooking';
// Pantry query timeout. Calibrated to 2s — healthy pantry median sits
// at ~800ms, so 2s catches p95 with headroom. Revisit if production
// observability shows timeout rate >5% sustained.
const DEFAULT_QUERY_TIMEOUT_MS = 2000;

// Sentinel used to disambiguate pantry timeout from an explicit no-event
// response. Without it, Promise.race([eventPromise, timeoutPromise])
// collapses both "relay returned null" and "timer fired" into the same
// null value, and the resolver needs to tell them apart for the retry
// UI (drift #1 fix).
const TIMEOUT_SENTINEL = Symbol('nourish-pantry-timeout');

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
 * Three-way status:
 *   - hit:     an event was returned and parsed
 *   - miss:    pantry confirmed no event (or parse failed)
 *   - timeout: timer fired before pantry responded
 *
 * The timeout/miss split is what lets the resolver show a retry UI
 * when pantry is unreachable (drift #1 fix) instead of silently
 * falling through to a fresh /api/nourish compute.
 */
export async function queryNourishEvent(
  ndk: NDK,
  recipePubkey: string,
  recipeDTag: string,
  timeoutMs: number = DEFAULT_QUERY_TIMEOUT_MS
): Promise<
  | { status: 'hit'; result: NourishRelayResult }
  | { status: 'miss' }
  | { status: 'timeout' }
> {
  const dTag = buildNourishDTag(recipePubkey, recipeDTag);

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const filter = {
      kinds: [30078 as number],
      authors: [NOURISH_SERVICE_PUBKEY],
      '#d': [dTag]
    };

    const relaySet = NDKRelaySet.fromRelayUrls([PANTRY_RELAY], ndk, true);

    const eventPromise = ndk.fetchEvent(filter, undefined, relaySet);
    const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
    });

    const winner = await Promise.race([eventPromise, timeoutPromise]);
    if (winner === TIMEOUT_SENTINEL) return { status: 'timeout' };
    if (!winner) return { status: 'miss' };

    const parsed = parseNourishEvent(winner);
    if (!parsed) return { status: 'miss' };

    return { status: 'hit', result: parsed };
  } catch {
    return { status: 'miss' };
  } finally {
    // Clear the pending timer on the winning branch so long-lived
    // sessions don't accumulate dead setTimeout handles.
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

// ─── Event parsing ──────────────────────────────────────────

/** Parse a kind 30078 Nourish event into a typed result. */
export function parseNourishEvent(event: NDKEvent): NourishRelayResult | null {
  try {
    const content = JSON.parse(event.content);

    // Extract per-dimension scores. Legacy events lack the newer
    // dimensions; they default to 0.
    //   - v1 events lack the four v2 dims (antiInflammatory, bloodSugar,
    //     immuneSupportive, brainHealth)
    //   - v1 + v2 events lack heartHealth (added in v3)
    // The rescore-available banner on the card surfaces these as
    // "Upgrade scoring" so users can refresh into the latest profile.
    const gutScore = content.gut?.score ?? 0;
    const proteinScore = content.protein?.score ?? 0;
    const realFoodScore = content.realFood?.score ?? 0;
    const antiInflammatoryScore = content.antiInflammatory?.score ?? 0;
    const bloodSugarScore = content.bloodSugar?.score ?? 0;
    const immuneSupportiveScore = content.immuneSupportive?.score ?? 0;
    const brainHealthScore = content.brainHealth?.score ?? 0;
    const heartHealthScore = content.heartHealth?.score ?? 0;

    // Overall: trust the stored value when present. Recomputing with
    // current weights against legacy v1 events depresses overall by
    // ~25% because the four new dimensions are 0 under ~25% of the
    // weight (10% + 10% + 3% + 2%). The stored overall was computed
    // under whichever weights were current when the event was
    // published; honoring it preserves the "background mode" contract
    // that users see no visible change in their existing scores.
    // Only fall back to recomputation for events that somehow lack a
    // stored overall (pre-overall-field legacy, corrupted content).
    let overall: { score: number; label: string };
    const storedOverallScore = content.overall?.score;
    if (typeof storedOverallScore === 'number' && Number.isFinite(storedOverallScore)) {
      const rawScore = Math.round(Math.max(0, Math.min(10, storedOverallScore)));
      overall = {
        score: rawScore,
        label:
          typeof content.overall?.label === 'string'
            ? content.overall.label
            : 'Moderate'
      };
    } else {
      overall = computeOverallScore({
        gut: gutScore,
        protein: proteinScore,
        realFood: realFoodScore,
        antiInflammatory: antiInflammatoryScore,
        bloodSugar: bloodSugarScore,
        immuneSupportive: immuneSupportiveScore,
        brainHealth: brainHealthScore,
        heartHealth: heartHealthScore
      });
    }

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
      antiInflammatory: {
        score: antiInflammatoryScore,
        label: content.antiInflammatory?.label || 'Moderate',
        reason: content.antiInflammatory?.reason || ''
      },
      bloodSugar: {
        score: bloodSugarScore,
        label: content.bloodSugar?.label || 'Moderate',
        reason: content.bloodSugar?.reason || ''
      },
      immuneSupportive: {
        score: immuneSupportiveScore,
        label: content.immuneSupportive?.label || 'Moderate',
        reason: content.immuneSupportive?.reason || ''
      },
      brainHealth: {
        score: brainHealthScore,
        label: content.brainHealth?.label || 'Moderate',
        reason: content.brainHealth?.reason || ''
      },
      heartHealth: {
        score: heartHealthScore,
        label: content.heartHealth?.label || 'Moderate',
        reason: content.heartHealth?.reason || ''
      },
      overall: {
        score: overall.score,
        label: overall.label,
        reason:
          content.overall?.reason ||
          `Weighted: Real Food 22%, Gut 18%, Protein/Anti-Inflammatory/Blood Sugar/Heart/Immune/Brain 10% each`
      },
      summary: content.summary || '',
      // Accept both the new `cacheVersion` and the legacy `version` field
      // so pre-2.0 events in the wild still parse.
      cacheVersion: content.cacheVersion || content.version || NOURISH_CACHE_VERSION
    };

    // Audience scores — v2 events carry an `audience` root key with
    // kidFriendly. v1 events omit this; leave audienceScores undefined
    // so consumers see "no audience data" distinctly from "score 0".
    let audienceScores: AudienceScores | undefined = undefined;
    if (content.audience && typeof content.audience === 'object') {
      const kf = content.audience.kidFriendly;
      if (kf && typeof kf.score === 'number') {
        audienceScores = {
          kidFriendly: {
            score: kf.score,
            label: typeof kf.label === 'string' ? kf.label : 'Moderate',
            reason: typeof kf.reason === 'string' ? kf.reason : ''
          }
        };
      }
    }

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

    // updated_at tag is present only on admin rescores. Accept the tag
    // or the mirrored content field; undefined on first-time scores.
    const updatedAtTag = event.tags.find((t) => t[0] === 'updated_at')?.[1];
    const updatedAtParsed = updatedAtTag ? Number(updatedAtTag) : NaN;
    const updatedAt = Number.isFinite(updatedAtParsed)
      ? updatedAtParsed
      : typeof content.updatedAt === 'number'
        ? content.updatedAt
        : undefined;

    return {
      scores,
      improvements,
      ingredientSignals,
      audienceScores,
      contentHash,
      promptVersion,
      nourishVersion,
      createdAt: event.created_at || 0,
      updatedAt,
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
