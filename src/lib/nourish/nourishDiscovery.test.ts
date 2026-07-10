/**
 * Phase 3b + Explore resilience — discovery helpers & session cache.
 *
 * Pure-logic coverage for chip→label mapping, selectivity / AND
 * intersection, REQ filter construction, empty-set degrade, SWR cache,
 * refresh-miss preservation, filter-key isolation, and recipe-map reuse.
 *
 * Browser eyeballing still needed (not covered here):
 * - Chip toggle / return-to-page no longer flashes empty when pantry is slow
 * - Cached paint then quiet revalidate ("Updating…")
 * - Filter isolation: chips A results never flash under chips B
 * - After members-relay deploy: unauthenticated pantry `#l` REQs return
 *   service-key 30078s (NIP-42 public-read fix)
 * - Rough recipes absent under quantity chips, present under flag-only
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	NOURISH_FILTER_CHIPS,
	LABEL_SELECTIVITY_ASC,
	buildNourishAnalysisFilter,
	eventHasAllLabels,
	filterCacheKey,
	getCachedRecipeEvent,
	intersectEventsByLabels,
	labelsFromChipIds,
	peekDiscoveryCache,
	pickMostSelectiveLabel,
	putCachedRecipeEvent,
	putDiscoveryCache,
	resetDiscoverySessionCaches,
	shouldDegradeFilteredResults,
	shouldPreservePreviousOnEmpty,
	type NourishRankedRecipe
} from './nourishDiscovery';
import type { NourishLabel } from './types';
import { NOURISH_SERVICE_PUBKEY, NOURISH_LABEL_NAMESPACE } from './types';

/** Minimal event-shaped stub for intersection tests. */
function fakeEvent(labels: NourishLabel[], namespace = NOURISH_LABEL_NAMESPACE) {
	const tags: string[][] = [['d', 'nourish:30023:pk:recipe']];
	if (labels.length > 0) {
		tags.push(['L', namespace]);
		for (const label of labels) {
			tags.push(['l', label, namespace]);
		}
	}
	return { tags } as { tags: string[][] };
}

function fakeRanked(id: string): NourishRankedRecipe {
	return {
		recipe: { id, tags: [], pubkey: 'pk' } as unknown as NourishRankedRecipe['recipe'],
		nourish: {
			scores: {
				overall: { score: 8 },
				realFood: { score: 8 },
				gut: { score: 7 },
				protein: { score: 7 }
			},
			createdAt: 1
		} as unknown as NourishRankedRecipe['nourish'],
		title: id,
		image: '',
		authorPubkey: 'pk',
		recipeDTag: id
	};
}

beforeEach(() => {
	resetDiscoverySessionCaches();
});

describe('NOURISH_FILTER_CHIPS / labelsFromChipIds', () => {
	it('maps v1 chips to the plan labels', () => {
		const byId = Object.fromEntries(NOURISH_FILTER_CHIPS.map((c) => [c.id, c.nourishLabel]));
		expect(byId['high-protein']).toBe('protein:30plus');
		expect(byId['under-600']).toBe('kcal:under600');
		expect(byId['low-carb']).toBe('carbs:under40');
		expect(byId['no-seed-oils']).toBe('seedoil:free');
		expect(byId['no-added-sugar']).toBe('addedsugar:free');
		expect(byId['no-red-meat']).toBe('redmeat:free');
	});

	it('builds label lists from chip combos in chip order', () => {
		expect(labelsFromChipIds([])).toEqual([]);
		expect(labelsFromChipIds(['high-protein'])).toEqual(['protein:30plus']);
		expect(labelsFromChipIds(['no-seed-oils', 'high-protein'])).toEqual([
			'protein:30plus',
			'seedoil:free'
		]);
		expect(
			labelsFromChipIds(['no-red-meat', 'under-600', 'low-carb', 'no-added-sugar'])
		).toEqual(['kcal:under600', 'carbs:under40', 'addedsugar:free', 'redmeat:free']);
	});

	it('ignores unknown chip ids', () => {
		expect(labelsFromChipIds(['not-a-chip', 'high-protein'])).toEqual(['protein:30plus']);
	});
});

describe('pickMostSelectiveLabel / LABEL_SELECTIVITY_ASC', () => {
	it('orders census labels with protein:30plus before kcal:under600 before seedoil:free', () => {
		const p = LABEL_SELECTIVITY_ASC.indexOf('protein:30plus');
		const k = LABEL_SELECTIVITY_ASC.indexOf('kcal:under600');
		const s = LABEL_SELECTIVITY_ASC.indexOf('seedoil:free');
		expect(p).toBeGreaterThanOrEqual(0);
		expect(k).toBeGreaterThan(p);
		expect(s).toBeGreaterThan(k);
	});

	it('picks the most selective label for AND primary REQ', () => {
		expect(pickMostSelectiveLabel(['seedoil:free', 'protein:30plus'])).toBe('protein:30plus');
		expect(pickMostSelectiveLabel(['kcal:under600', 'seedoil:free'])).toBe('kcal:under600');
		expect(
			pickMostSelectiveLabel(['seedoil:free', 'kcal:under600', 'protein:30plus'])
		).toBe('protein:30plus');
		expect(pickMostSelectiveLabel(['carbs:under40', 'addedsugar:free'])).toBe('carbs:under40');
	});

	it('single-label queries return that label', () => {
		expect(pickMostSelectiveLabel(['redmeat:free'])).toBe('redmeat:free');
	});
});

describe('buildNourishAnalysisFilter', () => {
	it('no-filter path omits #l (fetch-all ranked behavior)', () => {
		const filter = buildNourishAnalysisFilter();
		expect(filter).toEqual({
			kinds: [30078],
			authors: [NOURISH_SERVICE_PUBKEY],
			limit: 200
		});
		expect(filter['#l']).toBeUndefined();
	});

	it('single-label path adds exact #l', () => {
		expect(buildNourishAnalysisFilter('protein:30plus')['#l']).toEqual(['protein:30plus']);
		expect(buildNourishAnalysisFilter('seedoil:free')['#l']).toEqual(['seedoil:free']);
	});
});

describe('eventHasAllLabels / intersectEventsByLabels', () => {
	it('requires every label (AND)', () => {
		const tags = fakeEvent(['protein:30plus', 'seedoil:free', 'kcal:under600']).tags;
		expect(eventHasAllLabels(tags, ['protein:30plus', 'seedoil:free'])).toBe(true);
		expect(eventHasAllLabels(tags, ['protein:30plus', 'addedsugar:free'])).toBe(false);
		expect(eventHasAllLabels(tags, [])).toBe(true);
	});

	it('rejects labels from a foreign namespace', () => {
		const tags: string[][] = [
			['l', 'protein:30plus', 'cooking.zap.nourish-flag'],
			['l', 'seedoil:free', NOURISH_LABEL_NAMESPACE]
		];
		expect(eventHasAllLabels(tags, ['protein:30plus'])).toBe(false);
		expect(eventHasAllLabels(tags, ['seedoil:free'])).toBe(true);
	});

	it('intersects a primary-fetched set against remaining labels', () => {
		const events = [
			fakeEvent(['protein:30plus', 'seedoil:free']),
			fakeEvent(['protein:30plus']),
			fakeEvent(['protein:30plus', 'seedoil:free', 'kcal:under600']),
			fakeEvent(['protein:30plus', 'addedsugar:free'])
		] as unknown as import('@nostr-dev-kit/ndk').NDKEvent[];

		const hit = intersectEventsByLabels(events, ['seedoil:free']);
		expect(hit).toHaveLength(2);

		const hit2 = intersectEventsByLabels(events, ['seedoil:free', 'kcal:under600']);
		expect(hit2).toHaveLength(1);

		const noExtra = intersectEventsByLabels(events, []);
		expect(noExtra).toHaveLength(4);
	});
});

describe('shouldDegradeFilteredResults', () => {
	it('degrades only on empty filtered sets', () => {
		expect(shouldDegradeFilteredResults(0)).toBe(true);
		expect(shouldDegradeFilteredResults(1)).toBe(false);
		expect(shouldDegradeFilteredResults(2)).toBe(false);
		expect(shouldDegradeFilteredResults(3)).toBe(false);
	});
});

describe('session cache — SWR / isolation / recipe map', () => {
	it('filterCacheKey is order-independent', () => {
		expect(filterCacheKey(['seedoil:free', 'protein:30plus'])).toBe(
			filterCacheKey(['protein:30plus', 'seedoil:free'])
		);
		expect(filterCacheKey([])).toBe('');
	});

	it('cache hit returns recipes without needing a fetch (peek)', () => {
		const recipes = [fakeRanked('a'), fakeRanked('b')];
		putDiscoveryCache([], recipes, false);
		const hit = peekDiscoveryCache([]);
		expect(hit).not.toBeNull();
		expect(hit!.fromCache).toBe(true);
		expect(hit!.recipes).toHaveLength(2);
		expect(hit!.recipes[0].title).toBe('a');
	});

	it('filter-keyed isolation: chips A results are not returned for chips B', () => {
		putDiscoveryCache(['protein:30plus'], [fakeRanked('protein-only')], false);
		putDiscoveryCache(['seedoil:free'], [fakeRanked('seedoil-only')], false);

		const a = peekDiscoveryCache(['protein:30plus']);
		const b = peekDiscoveryCache(['seedoil:free']);
		const none = peekDiscoveryCache([]);

		expect(a!.recipes[0].title).toBe('protein-only');
		expect(b!.recipes[0].title).toBe('seedoil-only');
		expect(none).toBeNull();
	});

	it('expired TTL entries are not returned as hits', () => {
		putDiscoveryCache([], [fakeRanked('stale')], false, Date.now() - 10 * 60 * 1000);
		expect(peekDiscoveryCache([])).toBeNull();
	});

	it('shouldPreservePreviousOnEmpty keeps non-empty on silent empty revalidate', () => {
		expect(
			shouldPreservePreviousOnEmpty({ previousCount: 12, freshCount: 0 })
		).toBe(true);
		expect(
			shouldPreservePreviousOnEmpty({ previousCount: 12, freshCount: 10 })
		).toBe(false);
		expect(
			shouldPreservePreviousOnEmpty({ previousCount: 0, freshCount: 0 })
		).toBe(false);
		expect(
			shouldPreservePreviousOnEmpty({
				previousCount: 12,
				freshCount: 0,
				legitimateEmpty: true
			})
		).toBe(false);
	});

	it('recipe-map reuses 30023 events across filter sets', () => {
		const event = {
			id: 'evt1',
			pubkey: 'pk1',
			created_at: 100,
			tags: [['d', 'pasta']]
		} as unknown as import('@nostr-dev-kit/ndk').NDKEvent;

		putCachedRecipeEvent('pk1', 'pasta', event);
		expect(getCachedRecipeEvent('pk1', 'pasta')).toBe(event);

		const newer = {
			...event,
			id: 'evt2',
			created_at: 200
		} as unknown as import('@nostr-dev-kit/ndk').NDKEvent;
		putCachedRecipeEvent('pk1', 'pasta', newer);
		expect(getCachedRecipeEvent('pk1', 'pasta')?.id).toBe('evt2');

		// Older write does not clobber
		putCachedRecipeEvent('pk1', 'pasta', event);
		expect(getCachedRecipeEvent('pk1', 'pasta')?.id).toBe('evt2');
	});
});
