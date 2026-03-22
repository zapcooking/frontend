/**
 * Nourish Scan API — Analyze any food text
 *
 * Accepts free-form input (ingredient lists, restaurant dishes, partial recipes)
 * and returns Nourish scores, a quick take, upgrade suggestions, and
 * per-ingredient signals for the ingredient dataset.
 *
 * POST /api/nourish/scan
 *
 * Body: { pubkey: string, text: string, title?: string }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { NOURISH_CACHE_VERSION } from '$lib/nourish/types';
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
		const { pubkey, text, title } = body;

		// Validate input
		if (!text || typeof text !== 'string' || text.trim().length < 3) {
			return json(
				{ success: false, error: 'Please enter some food text to analyze' },
				{ status: 400 }
			);
		}

		// Membership check (fail-closed)
		const membershipError = await requireMembership(pubkey, platform);
		if (membershipError) return membershipError;

		// Build prompt
		const prompt = SCAN_PROMPT.replace('{{text}}', text.trim().slice(0, 2000));

		// Call OpenAI
		const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${OPENAI_API_KEY}`
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [{ role: 'system', content: prompt }],
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
		const scores = {
			gut: {
				score: clampScore(parsed.gut?.score),
				label: validateLabel(parsed.gut?.label),
				reason: String(parsed.gut?.reason || '')
			},
			protein: {
				score: clampScore(parsed.protein?.score),
				label: validateLabel(parsed.protein?.label),
				reason: String(parsed.protein?.reason || '')
			},
			realFood: {
				score: clampScore(parsed.realFood?.score),
				label: validateLabel(parsed.realFood?.label),
				reason: String(parsed.realFood?.reason || '')
			},
			summary: String(parsed.summary || ''),
			version: NOURISH_CACHE_VERSION
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
			ingredient_signals
		});
	} catch (error: any) {
		console.error('[Nourish Scan] Error:', error);
		return json(
			{ success: false, error: error.message || 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
