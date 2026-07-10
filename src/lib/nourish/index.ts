export {
	NOURISH_CACHE_VERSION,
	NOURISH_PROMPT_VERSION,
	NOURISH_WEIGHTS,
	computeOverallScore,
	type NourishRequest,
	type NourishResponse,
	type NourishScores,
	type NourishMacros,
	type NourishMacroPerServing,
	type NourishLabel,
	type ScoreDetail,
	type ScanRequest,
	type ScanResponse,
	type IngredientSignal,
	type IngredientRecord
} from './types';

export { getNourishCache, setNourishScores, clearNourishCache } from './cache';
export type { NourishCacheKey } from './cache';

export { generateSuggestions, mergeImprovements } from './suggestions';

export { ingredientStore } from './ingredientStore';

export { parseServings } from './servings';
export type { ServingsParseResult } from './servings';

export {
	computeMacrosFromIngredients,
	computeMacrosAndLabels,
	deriveFreeLabel,
	deriveThresholdLabels,
	deriveNourishLabels,
	deriveMacroConfidence,
	roundMacros,
	macroDerivedKcal
} from './macros';
