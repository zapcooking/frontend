export const NOURISH_CACHE_VERSION = '1.0';

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
	error?: string;
}
