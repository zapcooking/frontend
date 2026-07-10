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
 *
 * Explore resilience (post-3b):
 * - Session SWR cache keyed by sorted filter labels (TTL ~5 min).
 * - Cross-filter recipe event map (pubkey:dTag → 30023).
 * - Never clobber a non-empty cache with a silent empty revalidate.
 * - Pantry empty → one ~1s retry before broad-relay fallback.
 * - Persistent pantry pool membership (connect once, reuse relay set).
 *
 * NIP-42 finding (members-relay rejectFilterPolicy): prior to the companion
 * relay change, unauthenticated REQs for kind 30078 were auth-gated (only
 * kind 30023 was public), so pantry returned EOSE/0 and Explore depended on
 * flaky public-relay fallback. Fix is public reads of service-authored
 * 30078s at the relay (writes stay gated) — not client-side AUTH.
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { NDKRelaySet } from '@nostr-dev-kit/ndk';
import { NOURISH_SERVICE_PUBKEY, NOURISH_LABEL_NAMESPACE } from './types';
import type { NourishLabel, NourishScores } from './types';
import { parseNourishEvent, type NourishRelayResult } from './nourishRelay';

const PANTRY_RELAY = 'wss://pantry.zap.cooking';
const FETCH_TIMEOUT_MS = 8000;
const PANTRY_RETRY_DELAY_MS = 1000;
/** Session cache TTL — corpus changes slowly; 5 min is enough for Explore. */
export const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;

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
  /** True when served from session cache (SWR stale hit). */
  fromCache?: boolean;
  /**
   * True when a revalidate returned empty after a non-empty cache hit and
   * we preserved the previous results ([nourish.explore.refresh-miss]).
   */
  refreshMiss?: boolean;
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

// ─── Session caches (SWR) ────────────────────────────────────

type DiscoveryCacheEntry = {
  recipes: NourishRankedRecipe[];
  degraded: boolean;
  fetchedAt: number;
};

/** Filter-keyed discovery results. Key = {@link filterCacheKey}. */
const discoveryCache = new Map<string, DiscoveryCacheEntry>();

/**
 * Resolved kind-30023 recipes, reusable across filter sets.
 * Key = `${pubkey}:${dTag}`.
 */
const recipeEventCache = new Map<string, NDKEvent>();

/** Stable cache key for a filter label set (order-independent). */
export function filterCacheKey(filters: readonly NourishLabel[]): string {
  if (filters.length === 0) return '';
  return [...new Set(filters)].sort().join(',');
}

/** Peek session cache (including stale-within-TTL entries for SWR). */
export function peekDiscoveryCache(
  filters: readonly NourishLabel[]
): NourishDiscoveryResult | null {
  const key = filterCacheKey(filters);
  const entry = discoveryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > DISCOVERY_CACHE_TTL_MS) {
    // Expired — drop so callers don't treat as a hit.
    discoveryCache.delete(key);
    return null;
  }
  return {
    recipes: entry.recipes,
    degraded: entry.degraded,
    fromCache: true
  };
}

/** Test/helper: write a discovery cache entry. */
export function putDiscoveryCache(
  filters: readonly NourishLabel[],
  recipes: NourishRankedRecipe[],
  degraded = false,
  fetchedAt = Date.now()
): void {
  discoveryCache.set(filterCacheKey(filters), { recipes, degraded, fetchedAt });
}

export function getCachedRecipeEvent(pubkey: string, dTag: string): NDKEvent | undefined {
  return recipeEventCache.get(`${pubkey}:${dTag}`);
}

export function putCachedRecipeEvent(pubkey: string, dTag: string, event: NDKEvent): void {
  const key = `${pubkey}:${dTag}`;
  const existing = recipeEventCache.get(key);
  if (!existing || (event.created_at || 0) >= (existing.created_at || 0)) {
    recipeEventCache.set(key, event);
  }
}

/** Clear session caches — tests only. */
export function resetDiscoverySessionCaches(): void {
  discoveryCache.clear();
  recipeEventCache.clear();
  cachedPantryRelaySet = null;
  cachedPantryNdk = null;
}

/**
 * Empty revalidate after a successful non-empty fetch is almost certainly
 * transport failure, not the corpus vanishing. Preserve previous.
 * Legitimate filter-miss degrade keeps its own path (caller sets
 * `legitimateEmpty`).
 */
export function shouldPreservePreviousOnEmpty(opts: {
  previousCount: number;
  freshCount: number;
  legitimateEmpty?: boolean;
}): boolean {
  if (opts.legitimateEmpty) return false;
  return opts.previousCount > 0 && opts.freshCount === 0;
}

// ─── Persistent pantry pool membership ───────────────────────

let cachedPantryRelaySet: NDKRelaySet | null = null;
let cachedPantryNdk: NDK | null = null;

/**
 * Return a stable NDKRelaySet for pantry — connect once per NDK instance
 * instead of constructing a fresh set on every fetch (which can thrash
 * reconnects). Verifies connectivity and reconnects if the socket is down.
 */
export async function ensurePantryRelaySet(ndk: NDK): Promise<NDKRelaySet> {
  if (cachedPantryRelaySet && cachedPantryNdk === ndk) {
    await connectPantryIfNeeded(cachedPantryRelaySet);
    return cachedPantryRelaySet;
  }

  // Prefer an existing pool member; fromRelayUrls(create=true) adds + connects.
  const set = NDKRelaySet.fromRelayUrls([PANTRY_RELAY], ndk, true);
  cachedPantryRelaySet = set;
  cachedPantryNdk = ndk;
  await connectPantryIfNeeded(set);
  return set;
}

async function connectPantryIfNeeded(set: NDKRelaySet): Promise<void> {
  for (const relay of set.relays) {
    const status = (relay as { connectivity?: { status?: number } }).connectivity?.status;
    // NDKRelayStatus.CONNECTED === 1
    if (status === 1) continue;
    try {
      await relay.connect();
    } catch (err) {
      console.warn('[Nourish Explore] Pantry reconnect failed:', err);
    }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchEventsWithTimeout(
  ndk: NDK,
  filter: {
    kinds: number[];
    authors?: string[];
    limit?: number;
    '#l'?: string[];
    '#d'?: string[];
  },
  relaySet?: NDKRelaySet,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Set<NDKEvent>> {
  // Cast: NDKFilter's kind generics disagree with our plain number[] filters.
  const fetchPromise = relaySet
    ? ndk.fetchEvents(filter as never, undefined, relaySet)
    : ndk.fetchEvents(filter as never);
  const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) =>
    setTimeout(() => resolve(new Set()), timeoutMs)
  );
  return Promise.race([fetchPromise, timeoutPromise]);
}

/**
 * Fetch Nourish 30078s: pantry (persistent set) → empty retry after ~1s →
 * broad connected-relay fallback.
 */
async function fetchNourishEvents(
  ndk: NDK,
  label?: NourishLabel
): Promise<Set<NDKEvent>> {
  const filter = buildNourishAnalysisFilter(label);
  const relaySet = await ensurePantryRelaySet(ndk);

  let nourishEvents = await fetchEventsWithTimeout(ndk, filter, relaySet);

  if (nourishEvents.size === 0) {
    // Reconnect window — pantry often needs a beat after pool churn.
    await sleep(PANTRY_RETRY_DELAY_MS);
    await ensurePantryRelaySet(ndk);
    nourishEvents = await fetchEventsWithTimeout(ndk, filter, relaySet);
  }

  if (nourishEvents.size === 0) {
    console.log('[Nourish Explore] No events on pantry after retry, trying all relays...');
    nourishEvents = await fetchEventsWithTimeout(ndk, filter);
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

function recipeCoordKey(pubkey: string, dTag: string): string {
  return `${pubkey}:${dTag}`;
}

/**
 * Sort analyses, take top N, resolve linked 30023 recipes via session
 * recipe-map + batched fetch (with one retry for missing coords).
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

  const missing = topAnalyses.filter(
    (a) => !recipeEventCache.has(recipeCoordKey(a.recipePubkey, a.recipeDTag))
  );

  if (missing.length > 0) {
    await fetchAndCacheRecipes(ndk, missing);

    const stillMissing = missing.filter(
      (a) => !recipeEventCache.has(recipeCoordKey(a.recipePubkey, a.recipeDTag))
    );
    if (stillMissing.length > 0) {
      await sleep(PANTRY_RETRY_DELAY_MS);
      await fetchAndCacheRecipes(ndk, stillMissing);
    }
  }

  const results: NourishRankedRecipe[] = [];

  for (const analysis of topAnalyses) {
    const key = recipeCoordKey(analysis.recipePubkey, analysis.recipeDTag);
    const recipe = recipeEventCache.get(key);
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

async function fetchAndCacheRecipes(
  ndk: NDK,
  rows: AnalysisRow[]
): Promise<void> {
  if (rows.length === 0) return;

  const recipeFilter = {
    kinds: [30023 as number],
    authors: [...new Set(rows.map((a) => a.recipePubkey))],
    '#d': [...new Set(rows.map((a) => a.recipeDTag))]
  };

  const recipeEvents = await fetchEventsWithTimeout(ndk, recipeFilter);

  for (const recipe of recipeEvents) {
    const d = recipe.tags.find((t) => t[0] === 'd')?.[1] || '';
    if (!d) continue;
    putCachedRecipeEvent(recipe.pubkey, d, recipe);
  }
}

async function fetchFreshRanked(
  ndk: NDK,
  sortBy: SortDimension,
  limit: number,
  uniqueFilters: NourishLabel[]
): Promise<{ recipes: NourishRankedRecipe[]; degraded: boolean; legitimateEmpty: boolean }> {
  if (uniqueFilters.length === 0) {
    const nourishEvents = await fetchNourishEvents(ndk);
    console.log(`[Nourish Explore] Found ${nourishEvents.size} Nourish events`);
    const analyses = parseAnalyses(nourishEvents);
    const recipes = await resolveRecipesFromAnalyses(ndk, analyses, sortBy, limit);
    return { recipes, degraded: false, legitimateEmpty: false };
  }

  const primary = pickMostSelectiveLabel(uniqueFilters);
  const remaining = uniqueFilters.filter((l) => l !== primary);

  const nourishEvents = await fetchNourishEvents(ndk, primary);
  console.log(
    `[Nourish Explore] Found ${nourishEvents.size} Nourish events for #l=${primary}` +
      (remaining.length ? ` (intersect ${remaining.join(',')})` : '')
  );

  // Transport miss on the primary `#l` REQ — not a confident filter miss.
  if (nourishEvents.size === 0) {
    return { recipes: [], degraded: false, legitimateEmpty: false };
  }

  const filteredList =
    remaining.length > 0
      ? intersectEventsByLabels(nourishEvents, remaining)
      : [...nourishEvents];

  const analyses = parseAnalyses(filteredList);

  if (shouldDegradeFilteredResults(analyses.length)) {
    // Legitimate filter miss (relay returned events; none survived AND/parse).
    console.log('[Nourish Explore] Filtered set empty — degrading to ranked view');
    const allEvents = await fetchNourishEvents(ndk);
    const allAnalyses = parseAnalyses(allEvents);
    const recipes = await resolveRecipesFromAnalyses(ndk, allAnalyses, sortBy, limit);
    return { recipes, degraded: true, legitimateEmpty: true };
  }

  const recipes = await resolveRecipesFromAnalyses(ndk, analyses, sortBy, limit);
  return { recipes, degraded: false, legitimateEmpty: false };
}

/**
 * Fetch analyzed recipes from the pantry relay and rank by dimension.
 *
 * Session SWR: callers should {@link peekDiscoveryCache} first to render
 * instantly, then call this to revalidate. Empty revalidates after a
 * non-empty cache hit preserve previous results and log
 * `[nourish.explore.refresh-miss]`.
 */
export async function fetchNourishRankedRecipes(
  ndk: NDK,
  sortBy: SortDimension = 'overall',
  limit: number = 50,
  filters: readonly NourishLabel[] = []
): Promise<NourishDiscoveryResult> {
  const uniqueFilters = [...new Set(filters)];
  const key = filterCacheKey(uniqueFilters);
  const previous = discoveryCache.get(key);

  const fresh = await fetchFreshRanked(ndk, sortBy, limit, uniqueFilters);

  // Never clobber a non-empty session result with a silent empty revalidate.
  // Legitimate filter-miss degrade returns unfiltered recipes (non-empty) or
  // falls through to the unfiltered-cache path below — not this branch.
  if (
    shouldPreservePreviousOnEmpty({
      previousCount: previous?.recipes.length ?? 0,
      freshCount: fresh.recipes.length
    })
  ) {
    console.warn('[nourish.explore.refresh-miss]', {
      filterKey: key || '(none)',
      previousCount: previous!.recipes.length,
      degraded: previous!.degraded,
      legitimateEmpty: fresh.legitimateEmpty
    });
    return {
      recipes: previous!.recipes,
      degraded: previous!.degraded,
      refreshMiss: true
    };
  }

  // Degrade hop returned empty — prefer unfiltered session cache over blanking.
  if (fresh.legitimateEmpty && fresh.recipes.length === 0) {
    const unfiltered = discoveryCache.get(filterCacheKey([]));
    if (unfiltered && unfiltered.recipes.length > 0) {
      console.warn('[nourish.explore.refresh-miss]', {
        filterKey: key || '(none)',
        reason: 'degrade-unfiltered-empty',
        previousCount: unfiltered.recipes.length
      });
      const degradedResult = {
        recipes: unfiltered.recipes,
        degraded: true,
        refreshMiss: true as const
      };
      discoveryCache.set(key, {
        recipes: degradedResult.recipes,
        degraded: true,
        fetchedAt: Date.now()
      });
      return degradedResult;
    }
  }

  if (fresh.recipes.length > 0 || !previous) {
    discoveryCache.set(key, {
      recipes: fresh.recipes,
      degraded: fresh.degraded,
      fetchedAt: Date.now()
    });
  }

  return { recipes: fresh.recipes, degraded: fresh.degraded };
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

  const relaySet = await ensurePantryRelaySet(ndk);
  let nourishEvents = await fetchEventsWithTimeout(ndk, filter, relaySet);

  if (nourishEvents.size === 0) {
    await sleep(PANTRY_RETRY_DELAY_MS);
    await ensurePantryRelaySet(ndk);
    nourishEvents = await fetchEventsWithTimeout(ndk, filter, relaySet);
  }

  if (nourishEvents.size === 0) {
    nourishEvents = await fetchEventsWithTimeout(ndk, filter);
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
