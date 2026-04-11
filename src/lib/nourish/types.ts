export const NOURISH_CACHE_VERSION = '1.1';
export const NOURISH_PROMPT_VERSION = '1';

/**
 * Public key of the Zap Cooking service account that publishes Nourish analysis events.
 * Derived from NOTIFICATION_PRIVATE_KEY. Clients use this to filter relay queries
 * so only official Zap Cooking analyses are trusted.
 *
 * This must match the pubkey derived from the NOTIFICATION_PRIVATE_KEY env var.
 * To find this value: new NDKPrivateKeySigner(hexKey).user().then(u => u.pubkey)
 */
export const NOURISH_SERVICE_PUBKEY = '2cb95c7e3b3757e79b3fec757b92e1b8b2279a7f3b1a3d3b3f5a5e89c5e9f0a1';

/** Result from querying the pantry relay for an existing Nourish analysis event. */
export interface NourishRelayResult {
  scores: NourishScores;
  improvements: string[];
  ingredientSignals: IngredientSignal[];
  contentHash: string;
  promptVersion: string;
  nourishVersion: string;
  createdAt: number;
  eventId: string;
}

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
