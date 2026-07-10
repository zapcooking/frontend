/**
 * Nourish Discovery — fetch and rank analyzed recipes by Nourish dimensions.
 *
 * Queries the pantry relay for Nourish analysis events (kind 30078),
 * resolves the linked recipe events, and returns them sorted by the
 * selected dimension score.
 *
 * Phase 3b: when label filters are active, issues a `#l`-filtered REQ
 * (most selective label first) and intersects remaining labels client-side.
 * No-filter path preserves the original fetch-all ranked behavior.
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { NDKRelaySet } from '@nostr-dev-kit/ndk';
import { NOURISH_SERVICE_PUBKEY, NOURISH_LABEL_NAMESPACE } from './types';
import type { NourishLabel, NourishScores } from './types';
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

/** Result of a discovery fetch, including empty-filter degrade metadata. */
export interface NourishDiscoveryResult {
  recipes: NourishRankedRecipe[];
  /**
   * True when active filters matched zero labeled analyses and we fell
   * back to the unfiltered ranked list. UI should show the
   * "more recipes being analyzed" line — never a bare empty state for
   * a filter miss.
   */
  degraded: boolean;
}

// ─── Filter chips (v1 discovery surface) ─────────────────────

export interface NourishFilterChip {
  id: string;
  /** User-facing chip copy. */
  label: string;
  /** NIP-32 `l` tag value on the 30078 event. */
  nourishLabel: NourishLabel;
}

/**
 * Tappable filter chips on Nourish Explore. Chips compose with AND.
 * Quantity chips (`protein:*`, `kcal:*`, `carbs:*`) never match
 * `confidence: "rough"` recipes — those carry no threshold labels by
 * design. Flag chips still include them when classified.
 */
export const NOURISH_FILTER_CHIPS: readonly NourishFilterChip[] = [
  { id: 'high-protein', label: 'High protein (30g+)', nourishLabel: 'protein:30plus' },
  { id: 'under-600', label: 'Under 600 kcal', nourishLabel: 'kcal:under600' },
  { id: 'low-carb', label: 'Low carb (under 40g)', nourishLabel: 'carbs:under40' },
  { id: 'no-seed-oils', label: 'No seed oils', nourishLabel: 'seedoil:free' },
  { id: 'no-added-sugar', label: 'No added sugar', nourishLabel: 'addedsugar:free' },
  { id: 'no-red-meat', label: 'No red meat', nourishLabel: 'redmeat:free' }
];

/**
 * Static selectivity order from the Phase 2 backfill census (2026-07-10).
 * Lower index = more selective (fewer matching recipes). Used to pick the
 * primary `#l` REQ for AND-composition (NIP-01 `#l` arrays are OR).
 *
 * Census snapshot (ascending): protein:40plus 12, kcal:under400 13,
 * protein:30plus 14, carbs:under20 16, protein:20plus 19, carbs:under40 23,
 * kcal:under600 25, addedsugar:free 27, kcal:under800 31, redmeat:free 32,
 * seedoil:free 41.
 *
 * THIS ORDERING IS STATIC — revisit if the corpus grows ~10×; live counts
 * or a relay-side AND escape hatch would then be worth it.
 */
export const LABEL_SELECTIVITY_ASC: readonly NourishLabel[] = [
  'protein:40plus',
  'kcal:under400',
  'protein:30plus',
  'carbs:under20',
  'protein:20plus',
  'carbs:under40',
  'kcal:under600',
  'addedsugar:free',
  'kcal:under800',
  'redmeat:free',
  'seedoil:free'
];

/**
 * Pick the most selective label for the primary `#l` REQ.
 * Unknown labels (not in the census table) sort as least selective.
 */
export function pickMostSelectiveLabel(labels: readonly NourishLabel[]): NourishLabel {
  if (labels.length === 0) {
    throw new Error('pickMostSelectiveLabel requires at least one label');
  }
  let best = labels[0];
  let bestRank = selectivityRank(best);
  for (let i = 1; i < labels.length; i++) {
    const rank = selectivityRank(labels[i]);
    if (rank < bestRank) {
      best = labels[i];
      bestRank = rank;
    }
  }
  return best;
}

function selectivityRank(label: NourishLabel): number {
  const idx = LABEL_SELECTIVITY_ASC.indexOf(label);
  return idx < 0 ? Number.POSITIVE_INFINITY : idx;
}

/** Map active chip ids → NourishLabel values (deduped, stable chip order). */
export function labelsFromChipIds(chipIds: readonly string[]): NourishLabel[] {
  const wanted = new Set(chipIds);
  const out: NourishLabel[] = [];
  for (const chip of NOURISH_FILTER_CHIPS) {
    if (wanted.has(chip.id)) out.push(chip.nourishLabel);
  }
  return out;
}

/**
 * Whether an event carries every required `l` label (NIP-32 self-label).
 * When a namespace is present on the tag, it must match
 * `cooking.zap.nourish`; two-element tags are accepted (relay `#l` match).
 */
export function eventHasAllLabels(
  tags: readonly string[][],
  required: readonly NourishLabel[]
): boolean {
  if (required.length === 0) return true;
  const present = new Set<string>();
  for (const t of tags) {
    if (t[0] !== 'l' || !t[1]) continue;
    if (t[2] !== undefined && t[2] !== NOURISH_LABEL_NAMESPACE) continue;
    present.add(t[1]);
  }
  return required.every((label) => present.has(label));
}

/**
 * Intersect a fetched event set against additional labels (client-side AND).
 * Primary label was already applied via `#l` REQ.
 */
export function intersectEventsByLabels(
  events: Iterable<NDKEvent>,
  remainingLabels: readonly NourishLabel[]
): NDKEvent[] {
  if (remainingLabels.length === 0) return [...events];
  const out: NDKEvent[] = [];
  for (const event of events) {
    if (eventHasAllLabels(event.tags, remainingLabels)) out.push(event);
  }
  return out;
}

/**
 * Empty-set degrade: filtered queries that match nothing fall back to the
 * ranked unfiltered view. Legitimate thin intersections (n=2–3 on a
 * ~52-recipe corpus) are shown as-is — the plan's example threshold of 5
 * was aimed at the backfill gap; with a populated index, only empty misses
 * should swap the result set.
 */
export function shouldDegradeFilteredResults(filteredCount: number): boolean {
  return filteredCount === 0;
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

type AnalysisRow = {
  parsed: NourishRelayResult;
  recipePubkey: string;
  recipeDTag: string;
};

/**
 * Build the Nourish 30078 REQ. When `label` is set, adds `#l` for relay-side
 * filtering; otherwise fetch-all (today's ranked Explore path).
 */
export function buildNourishAnalysisFilter(label?: NourishLabel): {
  kinds: number[];
  authors: string[];
  limit: number;
  '#l'?: string[];
} {
  const filter: {
    kinds: number[];
    authors: string[];
    limit: number;
    '#l'?: string[];
  } = {
    kinds: [30078],
    authors: [NOURISH_SERVICE_PUBKEY],
    limit: 200
  };
  if (label) {
    filter['#l'] = [label];
  }
  return filter;
}

async function fetchNourishEvents(
  ndk: NDK,
  label?: NourishLabel
): Promise<Set<NDKEvent>> {
  const filter = buildNourishAnalysisFilter(label);
  let nourishEvents = new Set<NDKEvent>();

  const relaySet = NDKRelaySet.fromRelayUrls([PANTRY_RELAY], ndk, true);
  const fetchPromise = ndk.fetchEvents(filter, undefined, relaySet);
  const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) =>
    setTimeout(() => resolve(new Set()), FETCH_TIMEOUT_MS)
  );
  nourishEvents = await Promise.race([fetchPromise, timeoutPromise]);

  if (nourishEvents.size === 0) {
    console.log('[Nourish Explore] No events on pantry, trying all relays...');
    const broadFetch = ndk.fetchEvents(filter);
    const broadTimeout = new Promise<Set<NDKEvent>>((resolve) =>
      setTimeout(() => resolve(new Set()), FETCH_TIMEOUT_MS)
    );
    nourishEvents = await Promise.race([broadFetch, broadTimeout]);
  }

  return nourishEvents;
}

function parseAnalyses(nourishEvents: Iterable<NDKEvent>): AnalysisRow[] {
  const analyses: AnalysisRow[] = [];

  for (const event of nourishEvents) {
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1] || '';
    if (!dTag.startsWith('nourish:')) continue;

    const parsed = parseNourishEvent(event);
    if (!parsed) continue;

    const aTag = event.tags.find((t) => t[0] === 'a')?.[1] || '';
    const parts = aTag.split(':');
    if (parts.length < 3 || parts[0] !== '30023') continue;

    const recipePubkey = parts[1];
    const recipeDTag = parts.slice(2).join(':');

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

  return analyses;
}

/**
 * Sort analyses, take top N, batch-fetch linked 30023 recipes.
 * Batching is driven only by the input analysis set — never assumes a
 * full-corpus fetch (filtered discovery shrinks the `#d` / authors lists).
 */
async function resolveRecipesFromAnalyses(
  ndk: NDK,
  analyses: AnalysisRow[],
  sortBy: SortDimension,
  limit: number
): Promise<NourishRankedRecipe[]> {
  if (analyses.length === 0) return [];

  analyses.sort((a, b) => {
    const scoreA = getDimensionScore(a.parsed, sortBy);
    const scoreB = getDimensionScore(b.parsed, sortBy);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.parsed.createdAt - a.parsed.createdAt;
  });

  const topAnalyses = analyses.slice(0, limit);

  // Batch only the recipes we need from this (possibly filtered) set.
  const uniqueDTags = [...new Set(topAnalyses.map((a) => a.recipeDTag))];
  const recipeFilter = {
    kinds: [30023 as number],
    authors: [...new Set(topAnalyses.map((a) => a.recipePubkey))],
    '#d': uniqueDTags
  };

  const recipeFetch = ndk.fetchEvents(recipeFilter);
  const recipeTimeout = new Promise<Set<NDKEvent>>((resolve) =>
    setTimeout(() => resolve(new Set()), FETCH_TIMEOUT_MS)
  );
  const recipeEvents = await Promise.race([recipeFetch, recipeTimeout]);

  const recipeMap = new Map<string, NDKEvent>();
  for (const recipe of recipeEvents) {
    const d = recipe.tags.find((t) => t[0] === 'd')?.[1] || '';
    const key = `${recipe.pubkey}:${d}`;
    const existing = recipeMap.get(key);
    if (!existing || (recipe.created_at || 0) > (existing.created_at || 0)) {
      recipeMap.set(key, recipe);
    }
  }

  const results: NourishRankedRecipe[] = [];

  for (const analysis of topAnalyses) {
    const key = `${analysis.recipePubkey}:${analysis.recipeDTag}`;
    const recipe = recipeMap.get(key);
    if (!recipe) continue;

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

/**
 * Fetch analyzed recipes from the pantry relay and rank by dimension.
 *
 * Strategy:
 * 1. No filters — fetch all kind 30078s from the service account (unchanged).
 * 2. One label — REQ with `#l: [thatLabel]`.
 * 3. Multiple labels (AND) — REQ on the most selective label, intersect
 *    remaining labels client-side on each event's `l` tags.
 * 4. Extract recipe coordinates from the `a` tag; batch-fetch 30023s.
 * 5. Empty filtered set — fall back to unfiltered ranked + `degraded: true`.
 */
export async function fetchNourishRankedRecipes(
  ndk: NDK,
  sortBy: SortDimension = 'overall',
  limit: number = 50,
  filters: readonly NourishLabel[] = []
): Promise<NourishDiscoveryResult> {
  const uniqueFilters = [...new Set(filters)];

  if (uniqueFilters.length === 0) {
    const nourishEvents = await fetchNourishEvents(ndk);
    console.log(`[Nourish Explore] Found ${nourishEvents.size} Nourish events`);
    const analyses = parseAnalyses(nourishEvents);
    const recipes = await resolveRecipesFromAnalyses(ndk, analyses, sortBy, limit);
    return { recipes, degraded: false };
  }

  const primary = pickMostSelectiveLabel(uniqueFilters);
  const remaining = uniqueFilters.filter((l) => l !== primary);

  let nourishEvents = await fetchNourishEvents(ndk, primary);
  console.log(
    `[Nourish Explore] Found ${nourishEvents.size} Nourish events for #l=${primary}` +
      (remaining.length ? ` (intersect ${remaining.join(',')})` : '')
  );

  const filteredList =
    remaining.length > 0
      ? intersectEventsByLabels(nourishEvents, remaining)
      : [...nourishEvents];

  const analyses = parseAnalyses(filteredList);

  if (shouldDegradeFilteredResults(analyses.length)) {
    console.log('[Nourish Explore] Filtered set empty — degrading to ranked view');
    const allEvents = await fetchNourishEvents(ndk);
    const allAnalyses = parseAnalyses(allEvents);
    const recipes = await resolveRecipesFromAnalyses(ndk, allAnalyses, sortBy, limit);
    return { recipes, degraded: true };
  }

  const recipes = await resolveRecipesFromAnalyses(ndk, analyses, sortBy, limit);
  return { recipes, degraded: false };
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
