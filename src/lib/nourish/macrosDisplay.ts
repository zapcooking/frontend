/**
 * Macros row display helpers (Phase 3a).
 *
 * Pure render logic for the Nourish card macros row — label copy,
 * confidence tone, and honest-precision figure formatting. Kept out of
 * the Svelte component so the present / absent / rough / unparsed-
 * servings states are unit-testable (this repo has no Svelte component
 * harness — see vitest.config.ts / cheffyLauncherRelocation.test.ts).
 *
 * Layout (spacing, muted visual weight on `rough`) is not unit-testable;
 * those states need a device/browser eyeball.
 */

import type { NourishMacroPerServing, NourishMacros } from './types';

/** Visual treatment for the row — `rough` is muted/hedged in the card. */
export type MacrosRowTone = 'estimate' | 'rough';

/**
 * Resolved view model for the macros row. `null` means "do not render"
 * (v3 event, degraded omit, or malformed block) — today's card exactly.
 */
export interface MacrosRowView {
	label: string;
	tone: MacrosRowTone;
	/** Whole numbers only — never decimals. */
	kcal: number;
	protein_g: number;
	carbs_g: number;
	fat_g: number;
}

/**
 * Lenient parse of a pantry/API macros block. Returns undefined when the
 * shape is unusable so the UI degrades to "no row" rather than shipping
 * garbage figures. Does not re-round beyond integer display coercion —
 * server already applied honest rounding.
 */
export function parseMacrosBlock(raw: unknown): NourishMacros | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const m = raw as Record<string, unknown>;
	const ps = m.perServing;
	if (!ps || typeof ps !== 'object') return undefined;
	const p = ps as Record<string, unknown>;

	const kcal = asNonNegNumber(p.kcal);
	const protein_g = asNonNegNumber(p.protein_g);
	const carbs_g = asNonNegNumber(p.carbs_g);
	const fat_g = asNonNegNumber(p.fat_g);
	if (kcal === null || protein_g === null || carbs_g === null || fat_g === null) {
		return undefined;
	}

	const servingsUsed = asPositiveNumber(m.servingsUsed);
	if (servingsUsed === null) return undefined;
	if (typeof m.servingsParsed !== 'boolean') return undefined;

	const confidence = m.confidence;
	if (confidence !== 'estimate' && confidence !== 'rough') return undefined;

	const method = m.method === 'llm-per100g-v1' ? m.method : 'llm-per100g-v1';

	return {
		perServing: { kcal, protein_g, carbs_g, fat_g },
		servingsUsed,
		servingsParsed: m.servingsParsed,
		confidence,
		method
	};
}

/**
 * Build the macros row view, or `null` when the block is absent/unusable.
 *
 * Label discipline (plan §3a + discovery §0.4 + rough-class honesty):
 *   - estimate + parsed → "Estimated per serving"
 *   - rough + parsed → "Rough estimate"
 *   - servingsParsed false → append "(servings assumed: N)" — never silent
 *     about the fallback (N is servingsUsed, always 4 from the engine today)
 */
export function macrosRowView(
	macros: NourishMacros | null | undefined
): MacrosRowView | null {
	if (!macros?.perServing) return null;

	const figures = honestFigures(macros.perServing);
	const tone: MacrosRowTone = macros.confidence === 'rough' ? 'rough' : 'estimate';
	const base = tone === 'rough' ? 'Rough estimate' : 'Estimated per serving';
	const label =
		macros.servingsParsed === false
			? `${base} (servings assumed: ${macros.servingsUsed})`
			: base;

	return {
		label,
		tone,
		...figures
	};
}

/**
 * Honest precision at the render boundary: whole numbers only.
 * kcal is already rounded to 10s server-side — we never reformat to look
 * more precise (no decimals, no false trailing zeros).
 */
export function honestFigures(per: NourishMacroPerServing): {
	kcal: number;
	protein_g: number;
	carbs_g: number;
	fat_g: number;
} {
	return {
		kcal: Math.round(per.kcal),
		protein_g: Math.round(per.protein_g),
		carbs_g: Math.round(per.carbs_g),
		fat_g: Math.round(per.fat_g)
	};
}

function asNonNegNumber(v: unknown): number | null {
	if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
	return v;
}

function asPositiveNumber(v: unknown): number | null {
	if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
	return v;
}
