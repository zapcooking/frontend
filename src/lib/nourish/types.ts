export const NOURISH_CACHE_VERSION = '2.0';
export const NOURISH_PROMPT_VERSION = '1';

/**
 * Public key of the Zap Cooking service account that publishes Nourish analysis events.
 * Derived from NOTIFICATION_PRIVATE_KEY. Clients use this to filter relay queries
 * so only official Zap Cooking analyses are trusted.
 *
 * This must match the pubkey derived from the NOTIFICATION_PRIVATE_KEY env var.
 * To find this value: new NDKPrivateKeySigner(hexKey).user().then(u => u.pubkey)
 */
export const NOURISH_SERVICE_PUBKEY = 'fdd263f69f9e95a2a0a58ec3e7e8053011214fa66007d93b26d2f4717d31917b';

/** Result from querying the pantry relay for an existing Nourish analysis event. */
export interface NourishRelayResult {
  scores: NourishScores;
  improvements: string[];
  ingredientSignals: IngredientSignal[];
  /**
   * Audience scores — parallel dimension to Nourish, answering "will
   * this person eat it?" separately from "is this food good for you?"
   * Present on v2 events; undefined on v1 events (background mode —
   * no UI renders this yet; PR 3 Phase 2 #1d decision).
   */
  audienceScores?: AudienceScores;
  contentHash: string;
  promptVersion: string;
  nourishVersion: string;
  createdAt: number;
  /**
   * Unix seconds of the last admin rescore. Present only on events
   * published by the admin rescore endpoint; first-time-scored events
   * omit the `updated_at` tag and this field is undefined. Drives the
   * 24h "Updated" pill in the client UI.
   */
  updatedAt?: number;
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
	antiInflammatory: ScoreDetail;
	bloodSugar: ScoreDetail;
	immuneSupportive: ScoreDetail;
	brainHealth: ScoreDetail;
	overall: ScoreDetail;
	summary: string;
	cacheVersion: string;
}

/**
 * Audience scores — parallel dimension to Nourish. Answers "will
 * this person eat it?" independently of "is this food good for you?"
 * First entry is kidFriendly; future entries (elderlyFriendly,
 * athleteFriendly, etc.) add as named fields for TypeScript narrowing.
 *
 * Background mode (PR 3): scored + stored but not rendered. Future
 * UI will expose these separately from the Nourish weighted overall.
 */
export interface AudienceScores {
	kidFriendly: ScoreDetail;
}

// ─── Overall score weights (transparent) ─────────────────────
// Real Food is the foundation — ingredient quality affects everything
// else. Gut health is next (fiber, fermentation, plant diversity are
// strong markers of a nourishing meal). Protein is baseline. The four
// new dimensions contribute smaller weights until proven:
//   - antiInflammatory and bloodSugar each carry 10% — broad signals
//   - immuneSupportive (3%) and brainHealth (2%) are narrower — they
//     participate in the overall but don't dominate
export const NOURISH_WEIGHTS = {
	realFood: 0.35,
	gut: 0.25,
	protein: 0.15,
	antiInflammatory: 0.10,
	bloodSugar: 0.10,
	immuneSupportive: 0.03,
	brainHealth: 0.02
} as const;

/**
 * Compute the weighted overall Nourish score (0–10) from per-dimension
 * scores. Takes an object argument rather than positional args because
 * 7 positional numbers is unreadable and order-fragile.
 */
export function computeOverallScore(scores: {
	gut: number;
	protein: number;
	realFood: number;
	antiInflammatory: number;
	bloodSugar: number;
	immuneSupportive: number;
	brainHealth: number;
}): { score: number; label: string } {
	const raw =
		scores.realFood * NOURISH_WEIGHTS.realFood +
		scores.gut * NOURISH_WEIGHTS.gut +
		scores.protein * NOURISH_WEIGHTS.protein +
		scores.antiInflammatory * NOURISH_WEIGHTS.antiInflammatory +
		scores.bloodSugar * NOURISH_WEIGHTS.bloodSugar +
		scores.immuneSupportive * NOURISH_WEIGHTS.immuneSupportive +
		scores.brainHealth * NOURISH_WEIGHTS.brainHealth;
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
	/**
	 * Audience scores (kidFriendly + future audiences). Present on v2
	 * responses; undefined on v1 legacy responses. Background mode —
	 * no UI consumer renders this yet (PR 3).
	 */
	audience_scores?: AudienceScores;
	error?: string;
	promptVersion?: string;
	contentHash?: string;
	createdAt?: number;
	/**
	 * Set by the admin rescore endpoint when the server publishes with
	 * an `updated_at` tag. Undefined on normal compute responses.
	 */
	updatedAt?: number;
	/**
	 * Set by the admin rescore endpoint to report pantry publish outcome.
	 * Undefined on normal compute responses.
	 */
	published?: boolean;
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
	/**
	 * Audience scores — same shape as NourishResponse's field.
	 * Background mode; no UI consumer renders this yet.
	 */
	audience_scores?: AudienceScores;
	error?: string;
	promptVersion?: string;
	createdAt?: number;
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
	promptVersion?: string;
}
