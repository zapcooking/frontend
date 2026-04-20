/**
 * Nourish Scoring Engine (server-side)
 *
 * Shared LLM scoring pipeline used by both the user-facing compute
 * endpoint (`/api/nourish`) and the admin rescore endpoint
 * (`/api/admin/nourish/rescore`). Extracted in PR 4 commit 9a so both
 * endpoints drive through one implementation — preventing drift
 * between them as either evolves.
 *
 * This module handles ONLY the deterministic-shape parts of scoring:
 * prompt construction, OpenAI invocation, response parsing,
 * validation, and final NourishScores assembly. It does NOT handle
 * auth (caller's concern), request-body validation (caller's
 * concern), or pantry publishing (caller's concern).
 *
 * Behavior is identical to the pre-extraction logic in
 * `/api/nourish/+server.ts`. Non-shape outputs (LLM-derived scores)
 * are non-deterministic; only the shape/validation is preserved.
 */

import { NOURISH_CACHE_VERSION, computeOverallScore } from './types';
import type { IngredientSignal, NourishScores } from './types';

// ─── Prompt template ────────────────────────────────────────

const NOURISH_PROMPT = `You are a recipe analysis assistant for a cooking platform. Analyze the recipe below and return three food quality scores.

SCORING RULES:
- All scores are integers from 0 to 10.
- Base your analysis ONLY on the ingredient list provided.
- Be consistent: similar ingredient profiles should produce similar scores.
- These are rough estimates. Err toward the middle of the range unless the recipe clearly skews high or low.

GUT SCORE (0-10): How well does this recipe support digestive health?
- Fermented foods (yogurt, kimchi, sauerkraut, miso, kefir, sourdough): +2-3 points
- Prebiotic-rich ingredients (garlic, onions, leeks, asparagus, bananas, oats): +1-2 points
- High-fiber plants (legumes, whole grains, vegetables, fruits): +1-2 points
- Plant diversity (5+ different plants): +1 point
- Ultra-processed ingredients (artificial sweeteners, emulsifiers, processed oils): -1-2 points
- Low plant content or highly refined base: 0-2 score

PROTEIN SCORE (0-10): How useful is this recipe as a protein source?
- Contains high-protein main ingredient (meat, fish, eggs, tofu, tempeh, legumes): +3-4 points
- Protein-rich supporting ingredients (cheese, nuts, seeds, Greek yogurt): +1-2 points
- Protein appears as the main focus of the dish: +2 points
- Recipe is primarily carbohydrate/fat-focused with incidental protein: 2-4 score
- No meaningful protein source: 0-2 score

REAL FOOD SCORE (0-10): How close are ingredients to their whole, unprocessed form?
- All recognizable whole foods (fresh produce, raw meat/fish, whole grains): 8-10
- Some minimally processed items (canned beans, pasta, bread, cheese): 5-7
- Contains refined ingredients (white sugar, white flour, vegetable oil): -1-2 points
- Contains ultra-processed items (processed cheese, instant mixes, artificial flavors): -2-3 points
- Mostly packaged/convenience ingredients: 0-3 score

LABELS:
- 0-2: "Low"
- 3-4: "Fair"
- 5-6: "Moderate"
- 7-8: "Strong"
- 9-10: "Excellent"

Recipe Title: {{title}}
Servings: {{servings}}
Tags: {{tags}}

Ingredients:
{{ingredients}}

Return ONLY valid JSON with this exact structure:
{
  "gut": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "protein": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "realFood": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "summary": "<1-2 sentences>",
  "ingredients": [
    { "name": "<ingredient>", "signals": ["<tag>"], "contribution": "<gut|protein|realFood|neutral>" }
  ],
  "improvements": ["<short actionable suggestion>"]
}

Do not include any text outside the JSON object.`;

// ─── Validators (module-private) ────────────────────────────

function clampScore(value: unknown): number {
	const num = typeof value === 'number' ? value : parseInt(String(value), 10);
	if (isNaN(num)) return 0;
	return Math.max(0, Math.min(10, Math.round(num)));
}

function validateLabel(label: unknown): string {
	const valid = ['Low', 'Fair', 'Moderate', 'Strong', 'Excellent'];
	if (typeof label === 'string' && valid.includes(label)) return label;
	return 'Moderate';
}

function validateImprovements(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((s: unknown): s is string => typeof s === 'string')
		.slice(0, 5);
}

function validateIngredientSignals(raw: unknown): IngredientSignal[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((i: any) => i && typeof i.name === 'string')
		.map((i: any) => ({
			name: String(i.name).toLowerCase().trim(),
			signals: Array.isArray(i.signals)
				? i.signals.filter((s: unknown): s is string => typeof s === 'string')
				: [],
			contribution: ['gut', 'protein', 'realFood', 'neutral'].includes(i.contribution)
				? i.contribution
				: 'neutral'
		}));
}

// ─── Public API ─────────────────────────────────────────────

export interface ScoringPipelineInput {
	title: string;
	ingredients: string[];
	tags: string[];
	servings: string;
}

export type ScoringPipelineResult =
	| {
			ok: true;
			scores: NourishScores;
			improvements: string[];
			ingredientSignals: IngredientSignal[];
	  }
	| { ok: false; status: number; error: string };

/**
 * Run the LLM scoring pipeline end-to-end.
 *
 * Behavior mirrors the pre-extraction inline logic from
 * /api/nourish/+server.ts:
 *   1. Construct prompt from input
 *   2. POST to OpenAI chat completions (gpt-4o-mini, 1500 tokens, temp 0.3)
 *   3. Parse JSON with markdown-fence stripping
 *   4. Clamp + validate per-dimension scores and labels
 *   5. Compute overall score via the shared weighting
 *   6. Parse improvements + ingredient signals
 *
 * Caller is responsible for: auth/membership gating, request body
 * validation (title/ingredients non-empty), OPENAI_API_KEY
 * provisioning, and pantry publishing.
 */
export async function runScoringPipeline(
	openAiKey: string,
	input: ScoringPipelineInput
): Promise<ScoringPipelineResult> {
	const { title, ingredients, tags, servings } = input;

	const prompt = NOURISH_PROMPT.replace('{{title}}', title || 'Untitled')
		.replace('{{servings}}', servings || 'Not specified')
		.replace('{{tags}}', Array.isArray(tags) && tags.length > 0 ? tags.join(', ') : 'None')
		.replace(
			'{{ingredients}}',
			ingredients.map((i: string) => `- ${i}`).join('\n')
		);

	const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${openAiKey}`
		},
		body: JSON.stringify({
			model: 'gpt-4o-mini',
			messages: [{ role: 'system', content: prompt }],
			max_tokens: 1500,
			temperature: 0.3
		})
	});

	if (!openaiResponse.ok) {
		const errorData = await openaiResponse.json().catch(() => ({}));
		console.error('[Nourish] OpenAI API error:', errorData);
		return { ok: false, status: 500, error: 'Failed to analyze recipe. Please try again.' };
	}

	const openaiData = await openaiResponse.json();
	const content = openaiData.choices?.[0]?.message?.content;

	if (!content) {
		return { ok: false, status: 500, error: 'No response from AI. Please try again.' };
	}

	let parsed;
	try {
		const cleanContent = content
			.replace(/```json\n?/g, '')
			.replace(/```\n?/g, '')
			.trim();
		parsed = JSON.parse(cleanContent);
	} catch (err) {
		console.error('[Nourish] Failed to parse AI response:', content);
		return { ok: false, status: 500, error: 'Failed to parse analysis. Please try again.' };
	}

	const gutScore = clampScore(parsed.gut?.score);
	const proteinScore = clampScore(parsed.protein?.score);
	const realFoodScore = clampScore(parsed.realFood?.score);
	// v1 prompt doesn't score the four new dimensions — clampScore(undefined)
	// returns 0 so they contribute nothing to the weighted overall until
	// commit 2 ships the v2 prompt. Placeholder reason kept empty so a
	// downstream "why this score" consumer can't mistake silence for signal.
	const antiInflammatoryScore = clampScore(parsed.antiInflammatory?.score);
	const bloodSugarScore = clampScore(parsed.bloodSugar?.score);
	const immuneSupportiveScore = clampScore(parsed.immuneSupportive?.score);
	const brainHealthScore = clampScore(parsed.brainHealth?.score);
	const overall = computeOverallScore({
		gut: gutScore,
		protein: proteinScore,
		realFood: realFoodScore,
		antiInflammatory: antiInflammatoryScore,
		bloodSugar: bloodSugarScore,
		immuneSupportive: immuneSupportiveScore,
		brainHealth: brainHealthScore
	});

	const scores: NourishScores = {
		gut: {
			score: gutScore,
			label: validateLabel(parsed.gut?.label),
			reason: String(parsed.gut?.reason || '')
		},
		protein: {
			score: proteinScore,
			label: validateLabel(parsed.protein?.label),
			reason: String(parsed.protein?.reason || '')
		},
		realFood: {
			score: realFoodScore,
			label: validateLabel(parsed.realFood?.label),
			reason: String(parsed.realFood?.reason || '')
		},
		antiInflammatory: {
			score: antiInflammatoryScore,
			label: validateLabel(parsed.antiInflammatory?.label),
			reason: String(parsed.antiInflammatory?.reason || '')
		},
		bloodSugar: {
			score: bloodSugarScore,
			label: validateLabel(parsed.bloodSugar?.label),
			reason: String(parsed.bloodSugar?.reason || '')
		},
		immuneSupportive: {
			score: immuneSupportiveScore,
			label: validateLabel(parsed.immuneSupportive?.label),
			reason: String(parsed.immuneSupportive?.reason || '')
		},
		brainHealth: {
			score: brainHealthScore,
			label: validateLabel(parsed.brainHealth?.label),
			reason: String(parsed.brainHealth?.reason || '')
		},
		overall: {
			score: overall.score,
			label: overall.label,
			reason: `Weighted: Real Food 35%, Gut 25%, Protein 15%, Anti-Inflammatory 10%, Blood Sugar 10%, Immune-Supportive 3%, Brain Health 2%`
		},
		summary: String(parsed.summary || ''),
		cacheVersion: NOURISH_CACHE_VERSION
	};

	return {
		ok: true,
		scores,
		improvements: validateImprovements(parsed.improvements),
		ingredientSignals: validateIngredientSignals(parsed.ingredients)
	};
}
