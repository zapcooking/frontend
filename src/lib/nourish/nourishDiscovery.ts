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
import { NOURISH_SERVICE_PUBKEY, type NourishScores } from './types';
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
  try {
    // Try pantry relay
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
  } catch (err) {
    console.error('[Nourish Explore] Fetch failed:', err);
    return [];
  }

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

    analyses.push({ parsed, recipePubkey, recipeDTag });
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

  // Step 4: Batch-fetch recipe events
  const recipeFilter = {
    kinds: [30023 as number],
    authors: [...new Set(topAnalyses.map((a) => a.recipePubkey))],
  };

  let recipeEvents: Set<NDKEvent>;
  try {
    recipeEvents = await ndk.fetchEvents(recipeFilter);
  } catch {
    return [];
  }

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
