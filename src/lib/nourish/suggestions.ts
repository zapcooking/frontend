/**
 * Rule-based suggestion engine for Nourish upgrade recommendations.
 *
 * Generates short, actionable improvement suggestions based on score
 * thresholds. Merged with LLM-generated improvements for consistency.
 */

import type { NourishScores } from './types';

interface UpgradeRule {
	threshold: number;
	suggestions: string[];
}

const UPGRADE_RULES: Record<string, UpgradeRule[]> = {
	protein: [
		{
			threshold: 4,
			suggestions: [
				'Add eggs, chicken, or tofu for a protein boost',
				'Stir in Greek yogurt or cottage cheese',
				'Top with nuts, seeds, or hemp hearts',
				'Add beans, lentils, or chickpeas'
			]
		}
	],
	gut: [
		{
			threshold: 4,
			suggestions: [
				'Add kimchi, sauerkraut, or pickled vegetables on the side',
				'Swap regular bread for sourdough',
				'Add garlic, onions, or leeks for prebiotic fiber',
				'Include more diverse plants (aim for 5+)'
			]
		}
	],
	realFood: [
		{
			threshold: 4,
			suggestions: [
				'Swap vegetable oil for olive oil or butter',
				'Use whole grains instead of refined',
				'Replace processed sauces with simple homemade versions',
				'Choose whole ingredients over pre-made mixes'
			]
		}
	]
};

/** Pick 1–2 random suggestions from a list. */
function pickSuggestions(pool: string[], count: number): string[] {
	const shuffled = [...pool].sort(() => Math.random() - 0.5);
	return shuffled.slice(0, count);
}

/**
 * Generate rule-based suggestions from score values.
 * Returns 0–3 short actionable strings.
 */
export function generateSuggestions(scores: NourishScores): string[] {
	const results: string[] = [];

	for (const [dimension, rules] of Object.entries(UPGRADE_RULES)) {
		const scoreDetail = scores[dimension as keyof Pick<NourishScores, 'gut' | 'protein' | 'realFood'>];
		const score = scoreDetail?.score ?? 10;
		for (const rule of rules) {
			if (score <= rule.threshold) {
				results.push(...pickSuggestions(rule.suggestions, 1));
			}
		}
	}

	return results.slice(0, 3);
}

/**
 * Merge rule-based and LLM-generated improvements.
 * Prefers rule-based (shorter, more consistent), supplements with LLM.
 * Caps at 3 total.
 */
export function mergeImprovements(
	ruleBased: string[],
	llmImprovements: string[]
): string[] {
	const merged = [...ruleBased];

	for (const imp of llmImprovements) {
		if (merged.length >= 3) break;
		// Skip if it overlaps with an existing suggestion (simple substring check)
		const lower = imp.toLowerCase();
		const isDuplicate = merged.some((m) => {
			const ml = m.toLowerCase();
			return ml.includes(lower.slice(0, 20)) || lower.includes(ml.slice(0, 20));
		});
		if (!isDuplicate) {
			merged.push(imp);
		}
	}

	return merged.slice(0, 3);
}
