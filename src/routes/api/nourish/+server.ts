/**
 * Nourish API — Recipe Intelligence Scoring
 *
 * Uses OpenAI GPT-4o-mini to analyze recipe ingredients and return
 * three food quality scores: Gut, Protein, and Real Food.
 *
 * POST /api/nourish
 *
 * Body:
 * {
 *   pubkey: string,
 *   eventId: string,
 *   title: string,
 *   ingredients: string[],
 *   tags: string[],
 *   servings: string
 * }
 *
 * Returns:
 * {
 *   success: boolean,
 *   scores?: NourishScores,
 *   error?: string
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { NOURISH_CACHE_VERSION } from '$lib/nourish/types';

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
  "summary": "<1-2 sentences>"
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

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const OPENAI_API_KEY = (platform?.env as any)?.OPENAI_API_KEY || env.OPENAI_API_KEY;
		if (!OPENAI_API_KEY) {
			return json({ success: false, error: 'OpenAI API key not configured' }, { status: 500 });
		}

		const body = await request.json();
		const { pubkey, eventId, title, ingredients, tags, servings } = body;

		// Validate request
		if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
			return json(
				{ success: false, error: 'Ingredients list is required' },
				{ status: 400 }
			);
		}

		if (!eventId || typeof eventId !== 'string') {
			return json(
				{ success: false, error: 'Event ID is required' },
				{ status: 400 }
			);
		}

		// Check membership status — fail closed: require valid pubkey and active membership
		const MEMBERSHIP_ENABLED =
			(platform?.env as any)?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
		const membershipEnabled =
			typeof MEMBERSHIP_ENABLED === 'string'
				? MEMBERSHIP_ENABLED.toLowerCase() === 'true'
				: Boolean(MEMBERSHIP_ENABLED);

		if (membershipEnabled) {
			if (typeof pubkey !== 'string' || pubkey.trim().length === 0) {
				return json(
					{ success: false, error: 'A valid pubkey is required for Nourish' },
					{ status: 400 }
				);
			}

			const API_SECRET = (platform?.env as any)?.RELAY_API_SECRET || env.RELAY_API_SECRET;
			if (!API_SECRET) {
				console.error('[Nourish] Membership API secret is missing');
				return json(
					{ success: false, error: 'Membership service unavailable' },
					{ status: 500 }
				);
			}

			try {
				const { hasActiveMembership } = await import('$lib/membershipApi.server');
				const isActive = await hasActiveMembership(pubkey, API_SECRET);
				if (!isActive) {
					return json(
						{ success: false, error: 'Premium membership required for Nourish' },
						{ status: 403 }
					);
				}
			} catch (err) {
				console.error('[Nourish] Error checking membership:', err);
				return json(
					{ success: false, error: 'Unable to verify membership at this time' },
					{ status: 500 }
				);
			}
		}

		// Build prompt with recipe data
		const prompt = NOURISH_PROMPT.replace('{{title}}', title || 'Untitled')
			.replace('{{servings}}', servings || 'Not specified')
			.replace('{{tags}}', Array.isArray(tags) && tags.length > 0 ? tags.join(', ') : 'None')
			.replace(
				'{{ingredients}}',
				ingredients.map((i: string) => `- ${i}`).join('\n')
			);

		// Call OpenAI API
		const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${OPENAI_API_KEY}`
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [
					{ role: 'system', content: prompt }
				],
				max_tokens: 1024,
				temperature: 0.3
			})
		});

		if (!openaiResponse.ok) {
			const errorData = await openaiResponse.json().catch(() => ({}));
			console.error('[Nourish] OpenAI API error:', errorData);
			return json(
				{ success: false, error: 'Failed to analyze recipe. Please try again.' },
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

		// Parse JSON response
		let parsed;
		try {
			const cleanContent = content
				.replace(/```json\n?/g, '')
				.replace(/```\n?/g, '')
				.trim();
			parsed = JSON.parse(cleanContent);
		} catch (err) {
			console.error('[Nourish] Failed to parse AI response:', content);
			return json(
				{ success: false, error: 'Failed to parse analysis. Please try again.' },
				{ status: 500 }
			);
		}

		// Normalize and validate scores
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

		return json({ success: true, scores });
	} catch (error: any) {
		console.error('[Nourish] Error:', error);
		return json(
			{ success: false, error: error.message || 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
