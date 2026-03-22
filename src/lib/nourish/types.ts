export const NOURISH_CACHE_VERSION = '1.1';

// ─── Recipe scoring (existing) ───────────────────────────────

export interface NourishRequest {
	pubkey: string;
	eventId: string;
	title: string;
	ingredients: string[];
	tags: string[];
	servings: string;
}

export interface ScoreDetail {
	score: number;
	label: string;
	reason: string;
}

export interface NourishScores {
	gut: ScoreDetail;
	protein: ScoreDetail;
	realFood: ScoreDetail;
	overall: ScoreDetail;
	summary: string;
	version: string;
}

// ─── Overall score weights (transparent) ─────────────────────
// Real Food is weighted highest because ingredient quality is the
// foundation — it affects everything else. Gut health is next because
// fiber, fermentation, and plant diversity are strong markers of a
// nourishing meal. Protein is weighted lowest (but still meaningful)
// because many healthy meals are naturally lower in protein.
export const NOURISH_WEIGHTS = {
	realFood: 0.45,
	gut: 0.35,
	protein: 0.20
} as const;

/** Compute the weighted overall Nourish score (0–10). */
export function computeOverallScore(
	gut: number,
	protein: number,
	realFood: number
): { score: number; label: string } {
	const raw =
		realFood * NOURISH_WEIGHTS.realFood +
		gut * NOURISH_WEIGHTS.gut +
		protein * NOURISH_WEIGHTS.protein;
	const score = Math.round(Math.max(0, Math.min(10, raw)));
	const label =
		score <= 2 ? 'Low' :
		score <= 4 ? 'Fair' :
		score <= 6 ? 'Moderate' :
		score <= 8 ? 'Strong' : 'Excellent';
	return { score, label };
}

export interface NourishResponse {
	success: boolean;
	scores?: NourishScores;
	improvements?: string[];
	ingredient_signals?: IngredientSignal[];
	error?: string;
}

// ─── Scan Anything ───────────────────────────────────────────

export interface ScanRequest {
	pubkey: string;
	text: string;
	title?: string;
}

export interface ScanResponse {
	success: boolean;
	scores?: NourishScores;
	quick_take?: string;
	improvements?: string[];
	ingredient_signals?: IngredientSignal[];
	error?: string;
}

// ─── Ingredient signals ──────────────────────────────────────

export interface IngredientSignal {
	name: string;
	signals: string[];
	contribution: 'gut' | 'protein' | 'realFood' | 'neutral';
}

export interface IngredientRecord {
	id: string;
	name: string;
	signals: string[];
	contribution: string;
	source: 'recipe' | 'scan';
	sourceId?: string;
	createdAt: number;
}
