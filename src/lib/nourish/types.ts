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
	summary: string;
	version: string;
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
