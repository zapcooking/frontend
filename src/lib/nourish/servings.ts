/**
 * Servings string parser for Nourish per-serving macros (Phase 0 §0.4).
 *
 * Pure / deterministic — no I/O. Used by the scoring engine and unit tests.
 */

export interface ServingsParseResult {
	/** Value used for displayed per-serving macros (midpoint for ranges). */
	n: number;
	parsed: boolean;
	/** Present when a numeric range was parsed — drives fail-safe label bounds. */
	lo?: number;
	hi?: number;
}

const DEFAULT_SERVINGS = 4;

/**
 * Parse a free-form servings string from a recipe.
 *
 * Spec (binding Phase 0 finding):
 * 1. Empty / missing → `{ n: 4, parsed: false }`
 * 2. Leading integer → use it (`4 (~3-tbsp…)` → 4)
 * 3. Range `A-B` / `A–B` / `A to B` → midpoint for `n`, keep lo/hi
 * 4. Anything else → `{ n: 4, parsed: false }`
 */
export function parseServings(raw: unknown): ServingsParseResult {
	if (raw == null) return { n: DEFAULT_SERVINGS, parsed: false };
	const s = String(raw).trim();
	if (!s) return { n: DEFAULT_SERVINGS, parsed: false };

	const range = s.match(/(\d+(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d+(?:\.\d+)?)/i);
	if (range) {
		const a = Number(range[1]);
		const b = Number(range[2]);
		if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
			const lo = Math.min(a, b);
			const hi = Math.max(a, b);
			return { n: Math.round((lo + hi) / 2), parsed: true, lo, hi };
		}
	}

	const lead = s.match(/(\d+(?:\.\d+)?)/);
	if (lead) {
		const n = Number(lead[1]);
		if (Number.isFinite(n) && n > 0) {
			return { n: Math.round(n), parsed: true };
		}
	}

	return { n: DEFAULT_SERVINGS, parsed: false };
}
