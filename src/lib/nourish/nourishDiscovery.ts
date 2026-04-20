/**
 * Nourish Discovery — fetch and rank analyzed recipes by Nourish dimensions.
 *
 * Queries the pantry relay for all Nourish analysis events (kind 30078),
 * resolves the linked recipe events, and returns them sorted by the
 * selected dimension score.
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { NDKRelaySet } from '@nostr-dev-kit/ndk';
import { NOURISH_SERVICE_PUBKEY } from './types';
import type { NourishScores } from './types';
import { parseNourishEvent, type NourishRelayResult } from './nourishRelay';

const PANTRY_RELAY = 'wss://pantry.zap.cooking';
const FETCH_TIMEOUT_MS = 8000;

export type SortDimension = 'overall' | 'realFood' | 'gut' | 'protein';

export interface NourishRankedRecipe {
  recipe: NDKEvent;
  nourish: NourishRelayResult;
  title: string;
  image: string;
  authorPubkey: string;
  recipeDTag: string;
}

/**
 * Get the score value for a given dimension.
 */
export function getDimensionScore(nourish: NourishRelayResult, dim: SortDimension): number {
  switch (dim) {
    case 'overall': return nourish.scores.overall.score;
    case 'realFood': return nourish.scores.realFood.score;
    case 'gut': return nourish.scores.gut.score;
    case 'protein': return nourish.scores.protein.score;
  }
}

/**
 * Fetch all analyzed recipes from the pantry relay and rank by dimension.
 *
 * Strategy:
 * 1. Fetch all kind 30078 events from the service account (Nourish analyses)
 * 2. Extract recipe coordinates from the `a` tag
 * 3. Batch-fetch the linked recipe events
 * 4. Sort by the selected dimension score (descending)
 */
export async function fetchNourishRankedRecipes(
  ndk: NDK,
  sortBy: SortDimension = 'overall',
  limit: number = 50
): Promise<NourishRankedRecipe[]> {
  // Step 1: Fetch all Nourish analysis events
  // Try pantry relay first, fall back to all connected relays
  const filter = {
    kinds: [30078 as number],
    authors: [NOURISH_SERVICE_PUBKEY],
    limit: 200
  };

  let nourishEvents = new Set<NDKEvent>();

  // Try pantry relay first
  const relaySet = NDKRelaySet.fromRelayUrls([PANTRY_RELAY], ndk, true);
  const fetchPromise = ndk.fetchEvents(filter, undefined, relaySet);
  const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) =>
    setTimeout(() => resolve(new Set()), FETCH_TIMEOUT_MS)
  );
  nourishEvents = await Promise.race([fetchPromise, timeoutPromise]);

  // If pantry returned nothing, try all connected relays
  if (nourishEvents.size === 0) {
    console.log('[Nourish Explore] No events on pantry, trying all relays...');
    const broadFetch = ndk.fetchEvents(filter);
    const broadTimeout = new Promise<Set<NDKEvent>>((resolve) =>
      setTimeout(() => resolve(new Set()), FETCH_TIMEOUT_MS)
    );
    nourishEvents = await Promise.race([broadFetch, broadTimeout]);
  }

  console.log(`[Nourish Explore] Found ${nourishEvents.size} Nourish events`);

  if (nourishEvents.size === 0) return [];

  // Step 2: Parse events and extract recipe coordinates
  const analyses: { parsed: NourishRelayResult; recipePubkey: string; recipeDTag: string }[] = [];

  for (const event of nourishEvents) {
    // Only process nourish: d-tagged events
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1] || '';
    if (!dTag.startsWith('nourish:')) continue;

    const parsed = parseNourishEvent(event);
    if (!parsed) continue;

    // Extract recipe coordinates from the a-tag
    const aTag = event.tags.find((t) => t[0] === 'a')?.[1] || '';
    const parts = aTag.split(':');
    if (parts.length < 3 || parts[0] !== '30023') continue;

    const recipePubkey = parts[1];
    const recipeDTag = parts.slice(2).join(':'); // d-tag may contain colons

    // Deduplicate by recipe coordinate — keep the newest analysis
    const key = `${recipePubkey}:${recipeDTag}`;
    const existing = analyses.find((a) => `${a.recipePubkey}:${a.recipeDTag}` === key);
    if (existing) {
      if (parsed.createdAt > existing.parsed.createdAt) {
        const idx = analyses.indexOf(existing);
        analyses[idx] = { parsed, recipePubkey, recipeDTag };
      }
    } else {
      analyses.push({ parsed, recipePubkey, recipeDTag });
    }
  }

  if (analyses.length === 0) return [];

  // Step 3: Sort by dimension score (descending), then by created_at as tiebreaker
  analyses.sort((a, b) => {
    const scoreA = getDimensionScore(a.parsed, sortBy);
    const scoreB = getDimensionScore(b.parsed, sortBy);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.parsed.createdAt - a.parsed.createdAt;
  });

  // Take top N
  const topAnalyses = analyses.slice(0, limit);

  // Step 4: Batch-fetch only the specific recipe events we need
  const uniqueDTags = [...new Set(topAnalyses.map((a) => a.recipeDTag))];
  const recipeFilter = {
    kinds: [30023 as number],
    authors: [...new Set(topAnalyses.map((a) => a.recipePubkey))],
    '#d': uniqueDTags
  };

  let recipeEvents: Set<NDKEvent>;
  const recipeFetch = ndk.fetchEvents(recipeFilter);
  const recipeTimeout = new Promise<Set<NDKEvent>>((resolve) =>
    setTimeout(() => resolve(new Set()), FETCH_TIMEOUT_MS)
  );
  recipeEvents = await Promise.race([recipeFetch, recipeTimeout]);

  // Index recipes by coordinate
  const recipeMap = new Map<string, NDKEvent>();
  for (const recipe of recipeEvents) {
    const d = recipe.tags.find((t) => t[0] === 'd')?.[1] || '';
    const key = `${recipe.pubkey}:${d}`;
    // Keep the most recent version if duplicates
    const existing = recipeMap.get(key);
    if (!existing || (recipe.created_at || 0) > (existing.created_at || 0)) {
      recipeMap.set(key, recipe);
    }
  }

  // Step 5: Merge and return
  const results: NourishRankedRecipe[] = [];

  for (const analysis of topAnalyses) {
    const key = `${analysis.recipePubkey}:${analysis.recipeDTag}`;
    const recipe = recipeMap.get(key);
    if (!recipe) continue; // Recipe not found or deleted

    const title = recipe.tags.find((t) => t[0] === 'title')?.[1]
      || recipe.tags.find((t) => t[0] === 'd')?.[1]
      || 'Untitled';
    const image = recipe.tags.find((t) => t[0] === 'image')?.[1] || '';

    results.push({
      recipe,
      nourish: analysis.parsed,
      title,
      image,
      authorPubkey: analysis.recipePubkey,
      recipeDTag: analysis.recipeDTag
    });
  }

  return results;
}

// ─── Admin: model-upgrade candidates ────────────────────────

/**
 * Candidate for admin-triggered rescore because its stored
 * promptVersion doesn't match the server's current
 * NOURISH_PROMPT_VERSION (or it's a legacy `'unknown'` event per
 * PR 311's untagged-event handling).
 */
export interface OutOfVersionCandidate {
  recipePubkey: string;
  recipeDTag: string;
  /** `30023:${recipePubkey}:${recipeDTag}` — joinable against flag aggregator's `target` (minus the `a:` prefix). */
  aTag: string;
  eventId: string;
  promptVersion: string;
  createdAt: number;
  scores: NourishScores;
  contentHash: string;
}

const CANDIDATES_FETCH_LIMIT = 500;

/**
 * Fetch pantry Nourish events whose promptVersion doesn't match the
 * current server constant. Admin view joins these with flag counts
 * client-side and surfaces them in the "Upgrade candidates" tab.
 *
 * Bounded by a {@link CANDIDATES_FETCH_LIMIT}-event relay cap — emits
 * a `[nourish.candidates.truncated]` warn when the cap is hit so the
 * admin can decide whether paging is worth adding. Deduplicates by
 * `(recipePubkey, recipeDTag)` keeping the newest `createdAt`, so
 * historical copies of the same addressable event returned by the
 * relay don't double-count in the UI.
 */
export async function fetchOutOfVersionCandidates(
  ndk: NDK,
  currentPromptVersion: string
): Promise<OutOfVersionCandidate[]> {
  const filter = {
    kinds: [30078 as number],
    authors: [NOURISH_SERVICE_PUBKEY],
    limit: CANDIDATES_FETCH_LIMIT
  };

  const relaySet = NDKRelaySet.fromRelayUrls([PANTRY_RELAY], ndk, true);
  const fetchPromise = ndk.fetchEvents(filter, undefined, relaySet);
  const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) =>
    setTimeout(() => resolve(new Set()), FETCH_TIMEOUT_MS)
  );
  let nourishEvents = await Promise.race([fetchPromise, timeoutPromise]);

  if (nourishEvents.size === 0) {
    const broadFetch = ndk.fetchEvents(filter);
    const broadTimeout = new Promise<Set<NDKEvent>>((resolve) =>
      setTimeout(() => resolve(new Set()), FETCH_TIMEOUT_MS)
    );
    nourishEvents = await Promise.race([broadFetch, broadTimeout]);
  }

  if (nourishEvents.size >= CANDIDATES_FETCH_LIMIT) {
    console.warn('[nourish.candidates.truncated]', {
      fetched: nourishEvents.size,
      limit: CANDIDATES_FETCH_LIMIT
    });
  }

  // Kind 30078 is addressable/replaceable by d-tag, but relays can
  // still return multiple historical versions for the same coordinate.
  // Dedup by (recipePubkey, recipeDTag) keeping the newest createdAt
  // so the Upgrade candidates tab shows one row per target.
  const byCoord = new Map<string, OutOfVersionCandidate>();
  for (const event of nourishEvents) {
    const parsed = parseNourishEvent(event);
    if (!parsed) continue;
    if (parsed.promptVersion === currentPromptVersion) continue;

    // Recipe coordinates come from the `a` tag (kind:pubkey:dTag).
    const aTagFull = event.tags.find((t) => t[0] === 'a')?.[1];
    if (!aTagFull) continue;
    const parts = aTagFull.split(':');
    if (parts.length < 3) continue;
    const [, recipePubkey, ...rest] = parts;
    const recipeDTag = rest.join(':');
    if (!recipePubkey || !recipeDTag) continue;

    const existing = byCoord.get(aTagFull);
    if (existing && existing.createdAt >= parsed.createdAt) continue;

    byCoord.set(aTagFull, {
      recipePubkey,
      recipeDTag,
      aTag: aTagFull,
      eventId: parsed.eventId,
      promptVersion: parsed.promptVersion,
      createdAt: parsed.createdAt,
      scores: parsed.scores,
      contentHash: parsed.contentHash
    });
  }

  return Array.from(byCoord.values());
}
