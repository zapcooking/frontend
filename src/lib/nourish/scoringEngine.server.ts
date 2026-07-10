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
 * Prompt v4 adds per-ingredient grams_estimate / per100g / flags.
 * Macro arithmetic and label derivation are server-side
 * (`macros.ts` / `servings.ts`) — the model never does recipe totals.
 */

import { NOURISH_CACHE_VERSION, computeOverallScore } from './types';
import type {
	AudienceScores,
	IngredientSignal,
	NourishLabel,
	NourishMacros,
	NourishScores
} from './types';
import { computeMacrosAndLabels } from './macros';

// ─── Prompt template (v4) ───────────────────────────────────

const NOURISH_PROMPT = `You are a recipe analysis assistant for a cooking platform. Analyze the recipe below and return nine food scores: eight Nourish health dimensions, and one Audience appeal dimension. ALSO estimate per-ingredient edible weights, per-100g nutrition, and preference flags.

SCORING RULES:
- All scores are integers from 0 to 10.
- Base your analysis ONLY on the ingredient list provided.
- Be consistent: similar ingredient profiles should produce similar scores.
- These are rough estimates. Err toward the middle of the range unless the recipe clearly skews high or low.

════════ NOURISH DIMENSIONS (HEALTH) ════════

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

ANTI-INFLAMMATORY SCORE (0-10): How well does this recipe support the body's anti-inflammatory response?
- Omega-3 rich (fatty fish, walnuts, flaxseed, chia): +2-3
- Turmeric, ginger, extra-virgin olive oil: +1-2
- Leafy greens, dark berries: +1-2
- Colorful vegetables (bell peppers, tomatoes, beets): +1
- Refined vegetable oils (corn, soybean, safflower): -1-2
- Processed meats (bacon, sausage, deli meat): -2
- Added sugar, refined carbs: -1-2
- Ultra-processed ingredients: -1-2

BLOOD SUGAR SCORE (0-10): How well does this recipe support stable blood sugar?
- Fiber + protein + healthy fat balance: +2-3
- Whole grains (oats, quinoa, brown rice), legumes: +1-2
- Added sugar (cane/honey/syrup/etc.): -1-2
- Refined flour, white rice, fruit juice: -1-2
- Ultra-processed snacks: -1-2

IMMUNE-SUPPORTIVE SCORE (0-10): How well does this recipe provide immune-supportive nutrients?
- Vitamin-C-rich (citrus, bell peppers, broccoli, kiwi): +1-2
- Zinc sources (pumpkin seeds, oysters, legumes, red meat): +1
- Alliums (garlic, onion, leek, shallot): +1
- Ginger, turmeric, mushrooms: +1
- Fermented foods (yogurt, kimchi, kefir, sauerkraut): +1-2
- Bone broth: +1
- Mostly refined/processed: 0-2 range

BRAIN HEALTH SCORE (0-10): How well does this recipe support cognitive health?
- Omega-3 fatty fish (salmon, sardines, mackerel): +2-3
- Leafy greens, berries: +1-2
- Walnuts, other nuts: +1-2
- Turmeric, whole grains, olive oil: +1
- Refined sugar, trans fats, ultra-processed: -1-2

HEART HEALTH SCORE (0-10): How well does this recipe support cardiovascular health?
- Healthy fats (extra-virgin olive oil, avocado, nuts, seeds): +2-3
- Fatty fish (salmon, sardines, mackerel): +2
- Fiber-rich ingredients (oats, legumes, whole grains, vegetables, fruit): +1-2
- Potassium-rich ingredients (leafy greens, beans, bananas, sweet potato, avocado): +1-2
- Whole grains (oats, quinoa, brown rice, barley, whole-wheat): +1
- Heavily salted or cured items (bacon, sausage, processed deli meats, instant broths): -2
- Added salt beyond a pinch, soy sauce-heavy, high-sodium packaged sauces: -1-2
- Saturated fat heavy (butter, coconut oil, fatty cuts of red meat): -1
- Trans fats or partially-hydrogenated oils (shortening, some margarines): -2
- Refined carbs + added sugar together (baked goods, sweetened drinks): -1-2

════════ AUDIENCE DIMENSION (APPEAL) ════════

KID-FRIENDLY SCORE (0-10): How likely is a typical kid (ages 5-10) to eat this dish willingly?

IMPORTANT: This is NOT a health score. Do not penalize healthy food for being healthy, and do not reward unhealthy food for being palatable. It's a palate-appeal score: flavor familiarity, texture approachability, visual presentation, and how picky-eater-compatible the dish is. A nutrient-dense stir-fry can score low on kid-friendly; a plain buttered pasta can score high. Both are legitimate signals and independent of health.

- Familiar flavors (mild cheese, pasta, rice, mild chicken, butter): +2-3
- Slightly sweet or savory-sweet profile: +1
- Finger foods, nugget/patty shapes, pizza, tacos, dips: +1-2
- Visual appeal (colorful, fun shapes, dippable components): +1
- Hidden-veggie dishes (blended into sauces): +1
- Strong/bitter flavors (olives, blue cheese, bitter greens, heavy spices): -1-2
- Unfamiliar textures (raw fish, tripe, very chewy): -1-2
- Visible large pieces of commonly-resisted vegetables: -1
- Complex plated dishes requiring utensil skill: -1
- Many separately-prepared components: 0-2 range

LABELS:
- 0-2: "Low"
- 3-4: "Fair"
- 5-6: "Moderate"
- 7-8: "Strong"
- 9-10: "Excellent"

════════ PER-INGREDIENT MACROS + FLAGS (v4) ════════

For EACH ingredient in the list, also return:
- grams_estimate: EDIBLE, AS-CONSUMED weight in grams for the WHOLE recipe (not per serving, not purchase weight).
- per100g: { kcal, protein_g, carbs_g, fat_g } on the SAME as-consumed basis as grams_estimate.
- flags: { seed_oil, added_sugar, red_meat } each "yes" | "no" | "unknown"

BASIS RULES (critical — wrong basis is the #1 error):
1. Dry grains / pasta / quinoa / rice / dry lentils: grams_estimate = COOKED edible weight for the whole recipe; per100g = COOKED reference values. Never use dry weight with dry per-100g (or dry weight with cooked per-100g).
2. Bone-in / whole birds / bone-in chops: grams_estimate = EDIBLE yield only (meat + skin if eaten), NOT purchase/carcass weight. Boneless cuts: use trimmed edible weight.
3. Pan-fried / deep-fried / breaded-and-fried items: include a reasonable absorbed-oil allowance in grams_estimate (or in the oil ingredient's grams) and use as-consumed per100g. Breading that stays on the food counts toward the breaded item's edible grams.
4. Do NOT compute recipe or per-serving totals — the server does that.
5. Prefer whole numbers for grams_estimate. per100g may use one decimal.

FLAG RULES:
- seed_oil "yes": canola, soybean, corn, sunflower, safflower, grapeseed, cottonseed, rice bran, "vegetable oil", shortening, margarine.
- seed_oil "no": extra-virgin olive oil, avocado oil, coconut oil, butter, ghee, animal fats, non-oil ingredients.
- seed_oil "unknown": ambiguous "oil", "oil for frying", "canola or olive oil", unspecified frying fat.
- added_sugar "yes": cane/white/brown sugar, syrups, honey, maple, agave, powdered sugar as an ingredient.
- added_sugar "no": unsweetened ingredients, fruit used as fruit.
- added_sugar "unknown": "sugar or honey to taste", optional sweetener choice.
- red_meat "yes": beef, pork, lamb, goat, venison, bison (muscle meat).
- red_meat "no": poultry, fish, seafood, plant proteins, dairy, non-meat.
- red_meat "unknown": ambiguous "meat", unspecified ground meat.

FEW-SHOT BASIS EXAMPLES (follow these patterns):

Example A — dry grain → cooked:
Ingredient line: "1 cup dry quinoa"
→ { "name": "quinoa", "grams_estimate": 555, "per100g": { "kcal": 120, "protein_g": 4.4, "carbs_g": 21.3, "fat_g": 1.9 }, "flags": { "seed_oil": "no", "added_sugar": "no", "red_meat": "no" } }
(1 cup dry ≈ 170g dry → ~555g cooked; per100g is COOKED quinoa.)

Example B — whole bird → edible yield:
Ingredient line: "1 whole chicken (4 lb)"
→ { "name": "chicken", "grams_estimate": 1100, "per100g": { "kcal": 215, "protein_g": 27, "carbs_g": 0, "fat_g": 12 }, "flags": { "seed_oil": "no", "added_sugar": "no", "red_meat": "no" } }
(~4 lb purchase ≈ 1810g; edible roast yield ~55–65% → ~1100g edible; NOT 1810g.)

Example C — breaded + fried with oil absorption:
Ingredient lines: "4 chicken breasts", "1 cup breadcrumbs", "1/4 cup olive oil" (for pan-frying)
→ chicken+breading edible grams include coating that sticks; olive oil grams_estimate reflects oil absorbed/retained in the dish (often ~30–50% of oil poured), not the full pour discarded in the pan. per100g for the cutlet is as-consumed breaded chicken; oil row uses olive-oil per100g for the absorbed portion only.

Recipe Title: {{title}}
Servings: {{servings}}
Tags: {{tags}}

Ingredients:
{{ingredients}}

SUMMARY GUIDELINES:
- The summary is 1-2 sentences shown above the dimension grid on the recipe card.
- It must reference ONLY the eight Nourish health dimensions: Real Food, Gut Health, Protein, Anti-inflammatory, Blood Sugar, Immune-supportive, Brain Health, Heart-healthy.
- Do NOT mention kid-friendliness or any audience score in the summary — that data is computed but not shown on the card and would confuse the reader.
- Lead with what the recipe brings (which 1-2 dimensions it scores well on). If a dimension is light, describe it gently ("lighter on protein", "less of a focus"), never as a failure or red flag.
- Affirming, plain language. No grades, no warnings.
- Do NOT put calorie or gram figures in the summary.

Return ONLY valid JSON with this exact structure:
{
  "gut": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "protein": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "realFood": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "antiInflammatory": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "bloodSugar": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "immuneSupportive": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "brainHealth": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "heartHealth": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "kidFriendly": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "summary": "<1-2 sentences referencing only the eight Nourish dimensions above — no kid-friendly mention>",
  "ingredients": [
    {
      "name": "<ingredient>",
      "signals": ["<tag>"],
      "contribution": "<gut|protein|realFood|neutral>",
      "grams_estimate": <number>,
      "per100g": { "kcal": <number>, "protein_g": <number>, "carbs_g": <number>, "fat_g": <number> },
      "flags": { "seed_oil": "yes|no|unknown", "added_sugar": "yes|no|unknown", "red_meat": "yes|no|unknown" }
    }
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
	return raw.filter((s: unknown): s is string => typeof s === 'string').slice(0, 5);
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
			/**
			 * Audience scores from the v2+ prompt (kidFriendly only for now).
			 * Undefined if the LLM response didn't include the kidFriendly
			 * field — shouldn't happen with the current prompt, but defensive
			 * parsing keeps the pipeline resilient to truncated responses.
			 */
			audienceScores?: AudienceScores;
			/**
			 * Estimated per-serving macros (v4). Undefined when per-ingredient
			 * data was unusable — scores still return; macros degrade to omitted.
			 */
			macros?: NourishMacros;
			/** Derived discovery labels (v4). Always an array on ok results. */
			labels: NourishLabel[];
	  }
	| { ok: false; status: number; error: string };

/**
 * Run the LLM scoring pipeline end-to-end.
 *
 *   1. Construct prompt from input
 *   2. POST to OpenAI chat completions (gpt-4o-mini)
 *   3. Parse JSON with markdown-fence stripping
 *   4. Clamp + validate per-dimension scores and labels
 *   5. Compute overall score via the shared weighting
 *   6. Parse improvements + ingredient signals
 *   7. Deterministic macros + discovery labels (server-side)
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
			// v4 responses are larger (per-ingredient grams/per100g/flags).
			max_tokens: 4000,
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
	// Defensive parse: if the model omits a field or truncates its JSON,
	// clampScore(undefined) falls back to 0 so the missing dimension
	// contributes nothing to the weighted overall rather than throwing.
	const antiInflammatoryScore = clampScore(parsed.antiInflammatory?.score);
	const bloodSugarScore = clampScore(parsed.bloodSugar?.score);
	const immuneSupportiveScore = clampScore(parsed.immuneSupportive?.score);
	const brainHealthScore = clampScore(parsed.brainHealth?.score);
	const heartHealthScore = clampScore(parsed.heartHealth?.score);
	const overall = computeOverallScore({
		gut: gutScore,
		protein: proteinScore,
		realFood: realFoodScore,
		antiInflammatory: antiInflammatoryScore,
		bloodSugar: bloodSugarScore,
		immuneSupportive: immuneSupportiveScore,
		brainHealth: brainHealthScore,
		heartHealth: heartHealthScore
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
		heartHealth: {
			score: heartHealthScore,
			label: validateLabel(parsed.heartHealth?.label),
			reason: String(parsed.heartHealth?.reason || '')
		},
		overall: {
			score: overall.score,
			label: overall.label,
			reason: `Weighted: Real Food 22%, Gut 18%, Protein/Anti-Inflammatory/Blood Sugar/Heart/Immune/Brain 10% each`
		},
		summary: String(parsed.summary || ''),
		cacheVersion: NOURISH_CACHE_VERSION
	};

	// Audience — defensive parse: if omitted, leave undefined.
	let audienceScores: AudienceScores | undefined = undefined;
	const kfRaw = parsed.kidFriendly;
	if (kfRaw && typeof kfRaw.score === 'number') {
		audienceScores = {
			kidFriendly: {
				score: clampScore(kfRaw.score),
				label: validateLabel(kfRaw.label),
				reason: String(kfRaw.reason || '')
			}
		};
	}

	const ingredientSignals = validateIngredientSignals(parsed.ingredients);

	// Macros + labels: server arithmetic. Degrade to omitted macros with
	// a logged reason; scores still return. Classification free-labels
	// may still emit when macro rows are unusable.
	const { macros, labels, omitReason } = computeMacrosAndLabels(parsed.ingredients, servings);
	if (omitReason) {
		console.warn('[Nourish] macros omitted:', omitReason);
	}

	return {
		ok: true,
		scores,
		improvements: validateImprovements(parsed.improvements),
		ingredientSignals,
		audienceScores,
		macros,
		labels
	};
}
