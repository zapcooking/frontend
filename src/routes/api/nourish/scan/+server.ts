/**
 * Nourish Scan API — Analyze any food text
 *
 * Accepts free-form input (ingredient lists, restaurant dishes, partial recipes)
 * and returns Nourish scores, a quick take, upgrade suggestions, and
 * per-ingredient signals for the ingredient dataset.
 *
 * POST /api/nourish/scan
 *
 * Body:
 * {
 *   pubkey: string;
 *   text?: string;        // Free-form food description (>= 3 chars if provided)
 *   title?: string;       // Optional label
 *   imageData?: string;   // Optional base64-encoded image for vision analysis (max ~20MB)
 * }
 *
 * Success response:
 * {
 *   success: true,
 *   scores: NourishScores,              // includes cacheVersion
 *   quick_take: string,                 // one-line narrative
 *   improvements: string[],             // up to 5
 *   ingredient_signals: IngredientSignal[],
 *   promptVersion: string,              // model/prompt identity
 *   createdAt: number                   // unix seconds
 * }
 *
 * Error response:
 * {
 *   success: false,
 *   error: string
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { NOURISH_CACHE_VERSION, NOURISH_PROMPT_VERSION, computeOverallScore } from '$lib/nourish/types';
import { requireMembership } from '../membershipCheck';

const SCAN_PROMPT = `You are a food analysis assistant for a cooking platform. Analyze the following food description and return nine food scores: eight Nourish health dimensions, and one Audience appeal dimension.

The input may be an ingredient list, a restaurant dish description, a partial recipe, or any food-related text. Do your best with whatever information is provided.

SCORING RULES:
- All scores are integers from 0 to 10.
- Base your analysis ONLY on the information provided.
- Be consistent: similar ingredient profiles should produce similar scores.
- These are rough estimates. Err toward the middle of the range unless the input clearly skews high or low.

════════ NOURISH DIMENSIONS (HEALTH) ════════

GUT SCORE (0-10): How well does this food support digestive health?
- Fermented foods (yogurt, kimchi, sauerkraut, miso, kefir, sourdough): +2-3 points
- Prebiotic-rich ingredients (garlic, onions, leeks, asparagus, bananas, oats): +1-2 points
- High-fiber plants (legumes, whole grains, vegetables, fruits): +1-2 points
- Plant diversity (5+ different plants): +1 point
- Ultra-processed ingredients (artificial sweeteners, emulsifiers, processed oils): -1-2 points
- Low plant content or highly refined base: 0-2 score

PROTEIN SCORE (0-10): How useful is this food as a protein source?
- Contains high-protein main ingredient (meat, fish, eggs, tofu, tempeh, legumes): +3-4 points
- Protein-rich supporting ingredients (cheese, nuts, seeds, Greek yogurt): +1-2 points
- Protein appears as the main focus: +2 points
- Primarily carbohydrate/fat-focused with incidental protein: 2-4 score
- No meaningful protein source: 0-2 score

REAL FOOD SCORE (0-10): How close are the ingredients to their whole, unprocessed form?
- All recognizable whole foods (fresh produce, raw meat/fish, whole grains): 8-10
- Some minimally processed items (canned beans, pasta, bread, cheese): 5-7
- Contains refined ingredients (white sugar, white flour, vegetable oil): -1-2 points
- Contains ultra-processed items (processed cheese, instant mixes, artificial flavors): -2-3 points
- Mostly packaged/convenience ingredients: 0-3 score

ANTI-INFLAMMATORY SCORE (0-10): How well does this food support the body's anti-inflammatory response?
- Omega-3 rich (fatty fish, walnuts, flaxseed, chia): +2-3
- Turmeric, ginger, extra-virgin olive oil: +1-2
- Leafy greens, dark berries: +1-2
- Colorful vegetables (bell peppers, tomatoes, beets): +1
- Refined vegetable oils (corn, soybean, safflower): -1-2
- Processed meats (bacon, sausage, deli meat): -2
- Added sugar, refined carbs: -1-2
- Ultra-processed ingredients: -1-2

BLOOD SUGAR SCORE (0-10): How well does this food support stable blood sugar?
- Fiber + protein + healthy fat balance: +2-3
- Whole grains (oats, quinoa, brown rice), legumes: +1-2
- Added sugar (cane/honey/syrup/etc.): -1-2
- Refined flour, white rice, fruit juice: -1-2
- Ultra-processed snacks: -1-2

IMMUNE-SUPPORTIVE SCORE (0-10): How well does this food provide immune-supportive nutrients?
- Vitamin-C-rich (citrus, bell peppers, broccoli, kiwi): +1-2
- Zinc sources (pumpkin seeds, oysters, legumes, red meat): +1
- Alliums (garlic, onion, leek, shallot): +1
- Ginger, turmeric, mushrooms: +1
- Fermented foods (yogurt, kimchi, kefir, sauerkraut): +1-2
- Bone broth: +1
- Mostly refined/processed: 0-2 range

BRAIN HEALTH SCORE (0-10): How well does this food support cognitive health?
- Omega-3 fatty fish (salmon, sardines, mackerel): +2-3
- Leafy greens, berries: +1-2
- Walnuts, other nuts: +1-2
- Turmeric, whole grains, olive oil: +1
- Refined sugar, trans fats, ultra-processed: -1-2

HEART HEALTH SCORE (0-10): How well does this food support cardiovascular health?
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

KID-FRIENDLY SCORE (0-10): How likely is a typical kid (ages 5-10) to eat this food willingly?

IMPORTANT: This is NOT a health score. Do not penalize healthy food for being healthy, and do not reward unhealthy food for being palatable. It's a palate-appeal score: flavor familiarity, texture approachability, visual presentation, and how picky-eater-compatible the food is. A nutrient-dense stir-fry can score low on kid-friendly; a plain buttered pasta can score high. Both are legitimate signals and independent of health.

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

SUMMARY GUIDELINES:
- The summary is 1-2 sentences shown above the dimension grid on the scan card.
- It must reference ONLY the eight Nourish health dimensions: Real Food, Gut Health, Protein, Anti-inflammatory, Blood Sugar, Immune-supportive, Brain Health, Heart-healthy.
- Do NOT mention kid-friendliness or any audience score in the summary — that data is computed but not shown on the card and would confuse the reader.
- Lead with what the food brings (which 1-2 dimensions it scores well on). If a dimension is light, describe it gently ("lighter on protein", "less of a focus"), never as a failure or red flag.
- Affirming, plain language. No grades, no warnings.

Food Description:
{{text}}

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
  "quick_take": "<one short sentence describing what this food leans toward>",
  "ingredients": [
    { "name": "<ingredient>", "signals": ["<tag>"], "contribution": "<gut|protein|realFood|neutral>" }
  ],
  "improvements": ["<short actionable suggestion>"]
}

Do not include any text outside the JSON object.`;

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

function validateContribution(c: unknown): 'gut' | 'protein' | 'realFood' | 'neutral' {
	const valid = ['gut', 'protein', 'realFood', 'neutral'];
	if (typeof c === 'string' && valid.includes(c)) return c as any;
	return 'neutral';
}

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const OPENAI_API_KEY = (platform?.env as any)?.OPENAI_API_KEY || env.OPENAI_API_KEY;
		if (!OPENAI_API_KEY) {
			return json({ success: false, error: 'OpenAI API key not configured' }, { status: 500 });
		}

		const body = await request.json();
		const { pubkey, text, imageData } = body;

		const hasText = typeof text === 'string' && text.trim().length >= 3;
		const hasImage = typeof imageData === 'string' && imageData.length > 0;

		// Server-side image size limit (~20MB base64 ≈ ~27MB string)
		if (hasImage && imageData.length > 28_000_000) {
			return json(
				{ success: false, error: 'Image is too large. Please use an image under 20MB.' },
				{ status: 400 }
			);
		}

		// Validate image format if provided
		if (hasImage && !imageData.startsWith('data:image/')) {
			return json(
				{ success: false, error: 'Invalid image format.' },
				{ status: 400 }
			);
		}

		// Validate input — need at least text or image
		if (!hasText && !hasImage) {
			return json(
				{ success: false, error: 'Please enter some food text or upload an image to analyze' },
				{ status: 400 }
			);
		}

		// Membership check (fail-closed)
		const membershipError = await requireMembership(pubkey, platform);
		if (membershipError) return membershipError;

		// Build messages for OpenAI
		let messages: any[];

		if (hasImage) {
			// Vision mode: send image (with optional text context)
			const userContent: any[] = [
				{
					type: 'text',
					text: hasText
						? `Analyze this food image and the following description:\n\n${text.trim().slice(0, 2000)}`
						: 'Analyze this food image and identify the ingredients and dish.'
				},
				{
					type: 'image_url',
					image_url: {
						url: imageData.startsWith('data:') ? imageData : `data:image/jpeg;base64,${imageData}`
					}
				}
			];
			messages = [
				{ role: 'system', content: SCAN_PROMPT.replace('Food Description:\n{{text}}', 'Analyze the food shown in the image (and any text provided).') },
				{ role: 'user', content: userContent }
			];
		} else {
			// Text-only mode
			const prompt = SCAN_PROMPT.replace('{{text}}', text.trim().slice(0, 2000));
			messages = [{ role: 'system', content: prompt }];
		}

		// Call OpenAI
		const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${OPENAI_API_KEY}`
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages,
				max_tokens: 2000,
				temperature: 0.3
			})
		});

		if (!openaiResponse.ok) {
			console.error('[Nourish Scan] OpenAI error:', await openaiResponse.json().catch(() => ({})));
			return json(
				{ success: false, error: 'Failed to analyze. Please try again.' },
				{ status: 500 }
			);
		}

		const openaiData = await openaiResponse.json();
		const content = openaiData.choices?.[0]?.message?.content;

		if (!content) {
			return json(
				{ success: false, error: 'No response from AI. Please try again.' },
				{ status: 500 }
			);
		}

		// Parse response
		let parsed;
		try {
			const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
			parsed = JSON.parse(clean);
		} catch {
			console.error('[Nourish Scan] Failed to parse:', content);
			return json(
				{ success: false, error: 'Failed to parse analysis. Please try again.' },
				{ status: 500 }
			);
		}

		// Normalize scores defensively. SCAN_PROMPT already requests the
		// full current schema (8 Nourish dimensions + kidFriendly), but
		// model responses can still omit fields or return malformed
		// values. clampScore(undefined) falls back to 0 so a missing
		// dimension contributes nothing to the weighted overall rather
		// than throwing.
		const gutScore = clampScore(parsed.gut?.score);
		const proteinScore = clampScore(parsed.protein?.score);
		const realFoodScore = clampScore(parsed.realFood?.score);
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

		const scores = {
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

		// Parse optional fields gracefully
		const quick_take = typeof parsed.quick_take === 'string' ? parsed.quick_take : '';

		const improvements = Array.isArray(parsed.improvements)
			? parsed.improvements.filter((s: unknown) => typeof s === 'string').slice(0, 5)
			: [];

		const ingredient_signals = Array.isArray(parsed.ingredients)
			? parsed.ingredients
					.filter((i: any) => i && typeof i.name === 'string')
					.map((i: any) => ({
						name: String(i.name).toLowerCase().trim(),
						signals: Array.isArray(i.signals)
							? i.signals.filter((s: unknown) => typeof s === 'string')
							: [],
						contribution: validateContribution(i.contribution)
					}))
			: [];

		// Audience scores — v2 prompt returns kidFriendly. Defensive
		// parsing: undefined if the model omitted or truncated.
		const kfRaw = parsed.kidFriendly;
		const audience_scores =
			kfRaw && typeof kfRaw.score === 'number'
				? {
						kidFriendly: {
							score: clampScore(kfRaw.score),
							label: validateLabel(kfRaw.label),
							reason: String(kfRaw.reason || '')
						}
					}
				: undefined;

		return json({
			success: true,
			scores,
			quick_take,
			improvements,
			ingredient_signals,
			audience_scores,
			// Identity fields — scans have no durable pantry cache, but
			// response shape stays consistent with /api/nourish so clients
			// can reconcile by promptVersion / createdAt.
			promptVersion: NOURISH_PROMPT_VERSION,
			createdAt: Math.floor(Date.now() / 1000)
		});
	} catch (error: any) {
		console.error('[Nourish Scan] Error:', error);
		return json(
			{ success: false, error: error.message || 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
