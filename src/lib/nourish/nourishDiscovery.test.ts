/**
 * Phase 3b — filtered discovery helpers.
 *
 * Pure-logic coverage for chip→label mapping, selectivity / AND
 * intersection, REQ filter construction, and empty-set degrade.
 *
 * Browser eyeballing still needed (not covered here):
 * - Chip toggle selected state + results refresh on /nourish/explore
 * - Thin filtered grids (n=2–3) look intentional, not sparse/broken
 * - Degrade banner copy when a filter combo matches nothing
 * - Rough recipes absent under quantity chips, present under flag-only
 *   chips and the unfiltered view
 */

import { describe, it, expect } from 'vitest';
import {
	NOURISH_FILTER_CHIPS,
	LABEL_SELECTIVITY_ASC,
	buildNourishAnalysisFilter,
	eventHasAllLabels,
	intersectEventsByLabels,
	labelsFromChipIds,
	pickMostSelectiveLabel,
	shouldDegradeFilteredResults
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
		// Simulates events already narrowed by a protein:30plus `#l` REQ.
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
