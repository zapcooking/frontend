export {
	NOURISH_CACHE_VERSION,
	NOURISH_WEIGHTS,
	computeOverallScore,
	type NourishRequest,
	type NourishResponse,
	type NourishScores,
	type ScoreDetail,
	type ScanRequest,
	type ScanResponse,
	type IngredientSignal,
	type IngredientRecord
} from './types';

export { getNourishScores, setNourishScores, getScanResult, setScanResult } from './cache';

export { generateSuggestions, mergeImprovements } from './suggestions';

export { ingredientStore } from './ingredientStore';
