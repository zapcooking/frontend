import { describe, it, expect } from 'vitest';
import {
	computeMacrosFromIngredients,
	computeMacrosAndLabels,
	deriveFreeLabel,
	deriveThresholdLabels,
	macroDerivedKcal,
	roundMacros
} from './macros';
import { parseServings } from './servings';
import { NOURISH_PROMPT_VERSION, type NourishScores } from './types';

/** Minimal valid per-ingredient row. */
function row(
	grams: number,
	per100g: { kcal: number; protein_g: number; carbs_g: number; fat_g: number },
	flags: { seed_oil: string; added_sugar: string; red_meat: string } = {
		seed_oil: 'no',
		added_sugar: 'no',
		red_meat: 'no'
	}
) {
	return {
		name: 'item',
		grams_estimate: grams,
		per100g,
		flags
	};
}

describe('roundMacros / macroDerivedKcal', () => {
	it('rounds kcal to nearest 10 and macros to whole grams', () => {
		expect(roundMacros({ kcal: 424, protein_g: 32.4, carbs_g: 27.6, fat_g: 18.2 })).toEqual({
			kcal: 420,
			protein_g: 32,
			carbs_g: 28,
			fat_g: 18
		});
	});

	it('derives kcal from 4P+4C+9F', () => {
		expect(macroDerivedKcal({ protein_g: 10, carbs_g: 10, fat_g: 10 })).toBe(170);
	});
});

describe('computeMacrosFromIngredients — arithmetic', () => {
	it('sums ingredients and divides by servings', () => {
		// 200g @ 100 kcal/100g + 100g @ 200 kcal/100g = 400 kcal total → 100/serving @ 4
		const result = computeMacrosFromIngredients(
			[
				row(200, { kcal: 100, protein_g: 20, carbs_g: 0, fat_g: 0 }),
				row(100, { kcal: 200, protein_g: 0, carbs_g: 50, fat_g: 0 })
			],
			'4'
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.macros.servingsUsed).toBe(4);
		expect(result.macros.servingsParsed).toBe(true);
		expect(result.macros.confidence).toBe('estimate');
		expect(result.macros.method).toBe('llm-per100g-v1');
		// raw: kcal 100, P 10, C 12.5, F 0 → derived kcal = 4*10+4*12.5 = 90; Δ~11% <15% → keep LLM kcal
		expect(result.macros.perServing.protein_g).toBe(10);
		expect(result.macros.perServing.carbs_g).toBe(13);
		expect(result.macros.perServing.kcal).toBe(100);
	});

	it('enforces macro-derived kcal when LLM kcal deviates >15%', () => {
		// grams give P/C/F that imply 170 kcal, but per100g kcal is wildly high
		const result = computeMacrosFromIngredients(
			[row(100, { kcal: 500, protein_g: 10, carbs_g: 10, fat_g: 10 })],
			'1'
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.enforced).toBe(true);
		expect(result.consistencyDeviation).toBeGreaterThan(0.15);
		// derived = 170 → rounded 170
		expect(result.macros.perServing.kcal).toBe(170);
		expect(result.macros.perServing.protein_g).toBe(10);
	});

	it('uses servings fallback of 4 when unparseable and sets servingsParsed false', () => {
		const result = computeMacrosFromIngredients(
			[row(400, { kcal: 100, protein_g: 10, carbs_g: 10, fat_g: 0 })],
			'Variable'
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.macros.servingsUsed).toBe(4);
		expect(result.macros.servingsParsed).toBe(false);
	});

	it('degrades to omitted on malformed per-ingredient data', () => {
		expect(computeMacrosFromIngredients([], '4').ok).toBe(false);
		expect(computeMacrosFromIngredients([{ name: 'x' }], '4').ok).toBe(false);
		expect(
			computeMacrosFromIngredients([{ name: 'x', grams_estimate: 'nope', per100g: {} }], '4').ok
		).toBe(false);
		const mixed = computeMacrosFromIngredients(
			[
				{ name: 'bad' },
				row(100, { kcal: 100, protein_g: 10, carbs_g: 0, fat_g: 0 })
			],
			'1'
		);
		expect(mixed.ok).toBe(true);
		if (!mixed.ok) return;
		expect(mixed.usableIngredientCount).toBe(1);
	});
});

describe('deriveThresholdLabels — bucket boundaries', () => {
	const totals = (protein: number, kcal: number, carbs: number) => ({
		kcal: kcal * 4,
		protein_g: protein * 4,
		carbs_g: carbs * 4,
		fat_g: 0
	});

	it('29g protein → protein:20plus only', () => {
		const labels = deriveThresholdLabels(totals(29, 500, 30), parseServings('4'));
		expect(labels).toContain('protein:20plus');
		expect(labels).not.toContain('protein:30plus');
		expect(labels).not.toContain('protein:40plus');
	});

	it('30g protein → 20plus and 30plus', () => {
		const labels = deriveThresholdLabels(totals(30, 500, 30), parseServings('4'));
		expect(labels).toEqual(
			expect.arrayContaining(['protein:20plus', 'protein:30plus'])
		);
		expect(labels).not.toContain('protein:40plus');
	});

	it('emits no threshold labels when servingsParsed is false', () => {
		const labels = deriveThresholdLabels(totals(40, 300, 10), parseServings('Variable'));
		expect(labels).toEqual([]);
	});

	it('range servings require both ends to clear a bucket', () => {
		// total protein 120g; servings 4-6 → 30g @4 / 20g @6 → only 20plus
		const recipeTotals = { kcal: 2000, protein_g: 120, carbs_g: 80, fat_g: 40 };
		const labels = deriveThresholdLabels(recipeTotals, parseServings('4-6'));
		expect(labels).toContain('protein:20plus');
		expect(labels).not.toContain('protein:30plus');
	});

	it('kcal under buckets are cumulative downward', () => {
		const labels = deriveThresholdLabels(totals(20, 380, 30), parseServings('4'));
		expect(labels).toEqual(
			expect.arrayContaining(['kcal:under400', 'kcal:under600', 'kcal:under800'])
		);
	});
});

describe('deriveFreeLabel — fail-safe', () => {
	it('emits free only when every ingredient is confidently no', () => {
		const allNo = [
			row(10, { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, {
				seed_oil: 'no',
				added_sugar: 'no',
				red_meat: 'no'
			}),
			row(10, { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, {
				seed_oil: 'no',
				added_sugar: 'no',
				red_meat: 'no'
			})
		];
		expect(deriveFreeLabel(allNo, 'seed_oil', 'seedoil:free')).toBe('seedoil:free');
	});

	it('any unknown kills the free label', () => {
		const withUnknown = [
			row(10, { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, {
				seed_oil: 'no',
				added_sugar: 'no',
				red_meat: 'no'
			}),
			row(10, { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, {
				seed_oil: 'unknown',
				added_sugar: 'no',
				red_meat: 'no'
			})
		];
		expect(deriveFreeLabel(withUnknown, 'seed_oil', 'seedoil:free')).toBeNull();
	});

	it('any yes kills the free label', () => {
		const withYes = [
			row(10, { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, {
				seed_oil: 'yes',
				added_sugar: 'no',
				red_meat: 'no'
			})
		];
		expect(deriveFreeLabel(withYes, 'seed_oil', 'seedoil:free')).toBeNull();
	});
});

describe('computeMacrosAndLabels', () => {
	it('returns macros + labels together', () => {
		const { macros, labels, omitReason } = computeMacrosAndLabels(
			[
				row(400, { kcal: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6 }, {
					seed_oil: 'no',
					added_sugar: 'no',
					red_meat: 'no'
				})
			],
			'4'
		);
		expect(omitReason).toBeUndefined();
		expect(macros).toBeDefined();
		expect(labels).toContain('seedoil:free');
		expect(labels).toContain('addedsugar:free');
		expect(labels).toContain('redmeat:free');
	});

	it('omits macros but may still emit free labels when rows unusable', () => {
		const { macros, labels, omitReason } = computeMacrosAndLabels(
			[
				{
					name: 'salt',
					flags: { seed_oil: 'no', added_sugar: 'no', red_meat: 'no' }
				}
			],
			'4'
		);
		expect(macros).toBeUndefined();
		expect(omitReason).toBeTruthy();
		expect(labels).toContain('seedoil:free');
	});
});

describe('v3-shape scores still validate', () => {
	it('NOURISH_PROMPT_VERSION is 4 and cache stays 2.0', () => {
		expect(NOURISH_PROMPT_VERSION).toBe('4');
	});

	it('a v3-shaped NourishScores object remains structurally valid', () => {
		const scores: NourishScores = {
			gut: { score: 5, label: 'Moderate', reason: '' },
			protein: { score: 5, label: 'Moderate', reason: '' },
			realFood: { score: 5, label: 'Moderate', reason: '' },
			antiInflammatory: { score: 5, label: 'Moderate', reason: '' },
			bloodSugar: { score: 5, label: 'Moderate', reason: '' },
			immuneSupportive: { score: 5, label: 'Moderate', reason: '' },
			brainHealth: { score: 5, label: 'Moderate', reason: '' },
			heartHealth: { score: 5, label: 'Moderate', reason: '' },
			overall: { score: 5, label: 'Moderate', reason: '' },
			summary: 'ok',
			cacheVersion: '2.0'
		};
		// Additive: no macros/labels required on the scores object itself
		expect(scores.cacheVersion).toBe('2.0');
		expect((scores as { macros?: unknown }).macros).toBeUndefined();
	});
});
