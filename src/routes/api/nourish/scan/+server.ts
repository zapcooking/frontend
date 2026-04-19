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
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { NOURISH_CACHE_VERSION, NOURISH_PROMPT_VERSION, computeOverallScore } from '$lib/nourish/types';
import { requireMembership } from '../membershipCheck';

const SCAN_PROMPT = `You are a food analysis assistant for a cooking platform. Analyze the following food description and return quality scores.

The input may be an ingredient list, a restaurant dish description, a partial recipe, or any food-related text. Do your best with whatever information is provided.

SCORING RULES:
- All scores are integers from 0 to 10.
- Base your analysis ONLY on the information provided.
- Be consistent: similar ingredient profiles should produce similar scores.
- These are rough estimates. Err toward the middle of the range unless the input clearly skews high or low.

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

LABELS:
- 0-2: "Low"
- 3-4: "Fair"
- 5-6: "Moderate"
- 7-8: "Strong"
- 9-10: "Excellent"

Food Description:
{{text}}

Return ONLY valid JSON with this exact structure:
{
  "gut": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "protein": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "realFood": { "score": <number>, "label": "<string>", "reason": "<one sentence>" },
  "summary": "<1-2 sentences>",
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
				max_tokens: 1500,
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

		// Normalize scores
		const gutScore = clampScore(parsed.gut?.score);
		const proteinScore = clampScore(parsed.protein?.score);
		const realFoodScore = clampScore(parsed.realFood?.score);
		const overall = computeOverallScore(gutScore, proteinScore, realFoodScore);

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
			overall: {
				score: overall.score,
				label: overall.label,
				reason: `Weighted: Real Food 45%, Gut 35%, Protein 20%`
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

		return json({
			success: true,
			scores,
			quick_take,
			improvements,
			ingredient_signals,
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
