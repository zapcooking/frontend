/**
 * Deterministic Nourish macro arithmetic + label derivation (prompt v4).
 *
 * The LLM estimates per-ingredient grams + per100g + flags; this module
 * does ALL arithmetic and recipe-level label decisions. Never throws on
 * model sloppiness — callers get `{ ok: false, reason }` and omit the
 * block rather than shipping garbage.
 */

import type { NourishLabel, NourishMacros, NourishMacroPerServing } from './types';
import { parseServings, type ServingsParseResult } from './servings';

export type FlagValue = 'yes' | 'no' | 'unknown';

export interface IngredientMacroInput {
	name?: unknown;
	grams_estimate?: unknown;
	per100g?: {
		kcal?: unknown;
		protein_g?: unknown;
		carbs_g?: unknown;
		fat_g?: unknown;
	};
	flags?: {
		seed_oil?: unknown;
		added_sugar?: unknown;
		red_meat?: unknown;
		/** Breading/coating present on this item (crumbs, batter, dredge). */
		breaded?: unknown;
		/** Pan-fry or deep-fry application (incl. frying fat used to fry). */
		fried?: unknown;
		/**
		 * Whole animal or bone-in cut (whole chicken, bone-in thighs,
		 * whole fish) — edible yield diverges from purchase weight.
		 */
		bone_in?: unknown;
	};
}

export interface MacroComputeOk {
	ok: true;
	macros: NourishMacros;
	/** Unrounded per-serving totals before honest rounding (for tests). */
	rawPerServing: NourishMacroPerServing;
	/** Recipe-total macros before ÷ servings (for range label bounds). */
	recipeTotals: NourishMacroPerServing;
	servings: ServingsParseResult;
	consistencyDeviation: number;
	enforced: boolean;
	usableIngredientCount: number;
}

export interface MacroComputeFail {
	ok: false;
	reason: string;
}

export type MacroComputeResult = MacroComputeOk | MacroComputeFail;

const CONSISTENCY_THRESHOLD = 0.15;

function finitePositive(n: unknown): number | null {
	const v = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN;
	if (!Number.isFinite(v) || v < 0) return null;
	return v;
}

function finiteNonNeg(n: unknown): number | null {
	const v = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN;
	if (!Number.isFinite(v) || v < 0) return null;
	return v;
}

/** Honest rounding: kcal → nearest 10; macros → whole grams. */
export function roundMacros(per: NourishMacroPerServing): NourishMacroPerServing {
	return {
		kcal: Math.round(per.kcal / 10) * 10,
		protein_g: Math.round(per.protein_g),
		carbs_g: Math.round(per.carbs_g),
		fat_g: Math.round(per.fat_g)
	};
}

/** kcal implied by macros: 4·P + 4·C + 9·F */
export function macroDerivedKcal(per: Pick<NourishMacroPerServing, 'protein_g' | 'carbs_g' | 'fat_g'>): number {
	return 4 * per.protein_g + 4 * per.carbs_g + 9 * per.fat_g;
}

/**
 * Sum per-ingredient totals, divide by servings, enforce kcal consistency,
 * apply honest rounding. Degrades to `{ ok: false }` when no usable rows.
 */
export function computeMacrosFromIngredients(
	rawIngredients: unknown,
	servingsRaw: unknown
): MacroComputeResult {
	if (!Array.isArray(rawIngredients) || rawIngredients.length === 0) {
		return { ok: false, reason: 'no ingredients array' };
	}

	const servings = parseServings(servingsRaw);
	let kcal = 0;
	let protein = 0;
	let carbs = 0;
	let fat = 0;
	let usable = 0;

	for (const row of rawIngredients as IngredientMacroInput[]) {
		const grams = finitePositive(row?.grams_estimate);
		const p = row?.per100g;
		if (grams == null || grams === 0 || !p || typeof p !== 'object') continue;
		const k = finiteNonNeg(p.kcal);
		const pr = finiteNonNeg(p.protein_g);
		const c = finiteNonNeg(p.carbs_g);
		const f = finiteNonNeg(p.fat_g);
		if (k == null || pr == null || c == null || f == null) continue;
		usable++;
		kcal += (grams * k) / 100;
		protein += (grams * pr) / 100;
		carbs += (grams * c) / 100;
		fat += (grams * f) / 100;
	}

	if (usable === 0) {
		return { ok: false, reason: 'no usable per-ingredient macro rows' };
	}

	const n = servings.n > 0 ? servings.n : 4;
	const recipeTotals: NourishMacroPerServing = { kcal, protein_g: protein, carbs_g: carbs, fat_g: fat };
	const rawPerServing: NourishMacroPerServing = {
		kcal: kcal / n,
		protein_g: protein / n,
		carbs_g: carbs / n,
		fat_g: fat / n
	};

	const derived = macroDerivedKcal(rawPerServing);
	const deviation =
		derived === 0 ? (rawPerServing.kcal === 0 ? 0 : Infinity) : Math.abs(rawPerServing.kcal - derived) / derived;
	const enforced = deviation > CONSISTENCY_THRESHOLD;
	const consistent: NourishMacroPerServing = {
		...rawPerServing,
		kcal: enforced ? derived : rawPerServing.kcal
	};
	const rounded = roundMacros(consistent);
	const confidence = deriveMacroConfidence(rawIngredients);

	const macros: NourishMacros = {
		perServing: rounded,
		servingsUsed: n,
		servingsParsed: servings.parsed,
		confidence,
		method: 'llm-per100g-v1'
	};

	return {
		ok: true,
		macros,
		rawPerServing,
		recipeTotals,
		servings,
		consistencyDeviation: Number.isFinite(deviation) ? deviation : 1,
		enforced,
		usableIngredientCount: usable
	};
}

function normalizeFlag(raw: unknown): FlagValue {
	const v = String(raw ?? 'unknown').toLowerCase().trim();
	if (v === 'yes' || v === 'true' || v === '1') return 'yes';
	if (v === 'no' || v === 'false' || v === '0') return 'no';
	return 'unknown';
}

/**
 * Macro confidence from the classification pass — deterministic, no
 * title matching.
 *
 * Driving fields (cite for audits / UI):
 *   - `ingredients[].flags.breaded` — "yes" if this row is breading
 *     (crumbs/batter/dredge) or a breaded protein
 *   - `ingredients[].flags.fried` — "yes" if pan-fried / deep-fried
 *     application, including frying fat used to fry
 *   - `ingredients[].flags.bone_in` — "yes" if whole animal or bone-in
 *     cut (whole chicken, bone-in thighs, whole fish)
 *
 * Rule: `(breaded===yes AND fried===yes) OR any bone_in===yes` →
 * `rough`. Otherwise `estimate`. `unknown` does not trigger rough.
 * Last class extension in the Phase 1 PR — further residual goes to USDA.
 */
export function deriveMacroConfidence(rawIngredients: unknown): 'estimate' | 'rough' {
	if (!Array.isArray(rawIngredients) || rawIngredients.length === 0) return 'estimate';
	let hasBreaded = false;
	let hasFried = false;
	let hasBoneIn = false;
	for (const row of rawIngredients as IngredientMacroInput[]) {
		if (normalizeFlag(row?.flags?.breaded) === 'yes') hasBreaded = true;
		if (normalizeFlag(row?.flags?.fried) === 'yes') hasFried = true;
		if (normalizeFlag(row?.flags?.bone_in) === 'yes') hasBoneIn = true;
	}
	if (hasBoneIn) return 'rough';
	return hasBreaded && hasFried ? 'rough' : 'estimate';
}

/**
 * Fail-safe free-label: every ingredient must confidently be `no`.
 * Any `yes` or `unknown` (or empty list) → no free label.
 */
export function deriveFreeLabel(
	rawIngredients: unknown,
	flagKey: 'seed_oil' | 'added_sugar' | 'red_meat',
	label: Extract<NourishLabel, 'seedoil:free' | 'addedsugar:free' | 'redmeat:free'>
): NourishLabel | null {
	if (!Array.isArray(rawIngredients) || rawIngredients.length === 0) return null;
	let sawNo = false;
	for (const row of rawIngredients as IngredientMacroInput[]) {
		const flag = normalizeFlag(row?.flags?.[flagKey]);
		if (flag === 'yes' || flag === 'unknown') return null;
		if (flag === 'no') sawNo = true;
	}
	return sawNo ? label : null;
}

function perServingAt(totals: NourishMacroPerServing, servings: number): NourishMacroPerServing {
	const n = servings > 0 ? servings : 4;
	return {
		kcal: totals.kcal / n,
		protein_g: totals.protein_g / n,
		carbs_g: totals.carbs_g / n,
		fat_g: totals.fat_g / n
	};
}

/**
 * Cumulative threshold buckets. When servings were a range, a bucket is
 * emitted only if it holds at BOTH ends (Phase 0 §0.4 fail-safe).
 * When servingsParsed is false, NO threshold labels are emitted.
 */
export function deriveThresholdLabels(
	recipeTotals: NourishMacroPerServing,
	servings: ServingsParseResult
): NourishLabel[] {
	if (!servings.parsed) return [];

	const points: NourishMacroPerServing[] =
		servings.lo != null && servings.hi != null && servings.lo !== servings.hi
			? [perServingAt(recipeTotals, servings.lo), perServingAt(recipeTotals, servings.hi)]
			: [perServingAt(recipeTotals, servings.n)];

	const all = (pred: (p: NourishMacroPerServing) => boolean) => points.every(pred);
	const labels: NourishLabel[] = [];

	if (all((p) => p.protein_g >= 20)) labels.push('protein:20plus');
	if (all((p) => p.protein_g >= 30)) labels.push('protein:30plus');
	if (all((p) => p.protein_g >= 40)) labels.push('protein:40plus');

	// Cumulative downward: under400 implies under600 and under800
	if (all((p) => p.kcal < 400)) {
		labels.push('kcal:under400', 'kcal:under600', 'kcal:under800');
	} else if (all((p) => p.kcal < 600)) {
		labels.push('kcal:under600', 'kcal:under800');
	} else if (all((p) => p.kcal < 800)) {
		labels.push('kcal:under800');
	}

	if (all((p) => p.carbs_g < 20)) {
		labels.push('carbs:under20', 'carbs:under40');
	} else if (all((p) => p.carbs_g < 40)) {
		labels.push('carbs:under40');
	}

	return labels;
}

/**
 * Full label set from a successful macro compute + raw ingredient flags.
 */
export function deriveNourishLabels(
	macroResult: MacroComputeOk,
	rawIngredients: unknown
): NourishLabel[] {
	const labels: NourishLabel[] = [
		...deriveThresholdLabels(macroResult.recipeTotals, macroResult.servings)
	];

	const seed = deriveFreeLabel(rawIngredients, 'seed_oil', 'seedoil:free');
	const sugar = deriveFreeLabel(rawIngredients, 'added_sugar', 'addedsugar:free');
	const meat = deriveFreeLabel(rawIngredients, 'red_meat', 'redmeat:free');
	if (seed) labels.push(seed);
	if (sugar) labels.push(sugar);
	if (meat) labels.push(meat);

	return labels;
}

/**
 * Convenience: compute macros + labels together. On macro failure, still
 * attempt classification-only free labels (independent of servings).
 */
export function computeMacrosAndLabels(
	rawIngredients: unknown,
	servingsRaw: unknown
): {
	macros?: NourishMacros;
	labels: NourishLabel[];
	omitReason?: string;
} {
	const computed = computeMacrosFromIngredients(rawIngredients, servingsRaw);
	if (!computed.ok) {
		const labels: NourishLabel[] = [];
		const seed = deriveFreeLabel(rawIngredients, 'seed_oil', 'seedoil:free');
		const sugar = deriveFreeLabel(rawIngredients, 'added_sugar', 'addedsugar:free');
		const meat = deriveFreeLabel(rawIngredients, 'red_meat', 'redmeat:free');
		if (seed) labels.push(seed);
		if (sugar) labels.push(sugar);
		if (meat) labels.push(meat);
		return { labels, omitReason: computed.reason };
	}
	return {
		macros: computed.macros,
		labels: deriveNourishLabels(computed, rawIngredients)
	};
}
