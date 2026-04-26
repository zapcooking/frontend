/**
 * POST /api/cookbook-intro — Pro-gated AI helper that polishes a Recipe
 * Pack description into a short cookbook-style introduction.
 *
 * Body:
 *   {
 *     pubkey: string,         // signed-in user's pubkey, required
 *     packTitle: string,
 *     packDescription?: string,
 *     creatorName?: string,
 *     recipeCount: number,
 *     recipeTitles?: string[] // first ~10, used as light context only
 *   }
 *
 * Returns: { success: true, introduction: string } | { success: false, error }
 *
 * Membership gating: matches the image/text path in
 * /api/extract-recipe — Pro Kitchen + Founders are the intended
 * audience but we use the same `hasActiveMembership` check (any
 * active tier) since that's the established server-side primitive.
 * The client-side check on the modal only opens this for Pro/Founders,
 * so anyone reaching this endpoint with cook_plus is either bypassing
 * the UI or has a stale tier — fail-closed on the modal side keeps
 * the UX clean either way.
 *
 * AI is treated as best-effort polish: the caller falls back to the
 * raw description on any failure here. Rules:
 *   - Don't invent facts about recipes.
 *   - Don't change recipe content.
 *   - Keep it short (≈80-130 words).
 *   - Plain text. No markdown headers. No emojis.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const MAX_INTRO_TOKENS = 220;

export const POST: RequestHandler = async ({ request, platform }) => {
	const OPENAI_API_KEY = platform?.env?.OPENAI_API_KEY || env.OPENAI_API_KEY;
	if (!OPENAI_API_KEY) {
		return json({ success: false, error: 'OpenAI API key not configured' }, { status: 500 });
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
	}

	const pubkey = typeof body.pubkey === 'string' ? body.pubkey.trim() : '';
	const packTitle = typeof body.packTitle === 'string' ? body.packTitle.trim() : '';
	const packDescription =
		typeof body.packDescription === 'string' ? body.packDescription.trim() : '';
	const creatorName = typeof body.creatorName === 'string' ? body.creatorName.trim() : '';
	const recipeCount = Number(body.recipeCount) || 0;
	const recipeTitles = Array.isArray(body.recipeTitles)
		? body.recipeTitles.filter((t): t is string => typeof t === 'string').slice(0, 10)
		: [];

	if (!pubkey) {
		return json({ success: false, error: 'Pro Kitchen membership required' }, { status: 401 });
	}
	if (!packTitle) {
		return json({ success: false, error: 'packTitle is required' }, { status: 400 });
	}

	// Gate — same pattern as /api/extract-recipe image/text path.
	const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
	if (MEMBERSHIP_ENABLED?.toLowerCase() === 'true') {
		const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
		if (API_SECRET) {
			try {
				const { hasActiveMembership } = await import('$lib/membershipApi.server');
				const isActive = await hasActiveMembership(pubkey, API_SECRET);
				if (!isActive) {
					return json(
						{ success: false, error: 'Pro Kitchen membership required' },
						{ status: 403 }
					);
				}
			} catch (err) {
				console.error('[cookbook-intro] membership check failed', err);
				// Fail open on membership-API outage — same convention as
				// /api/extract-recipe.
			}
		}
	}

	const userMsg = [
		`Pack title: ${packTitle}`,
		creatorName ? `Curated by: ${creatorName}` : '',
		packDescription ? `Existing description (use as the basis):\n${packDescription}` : '',
		`Recipe count: ${recipeCount}`,
		recipeTitles.length ? `Recipe titles: ${recipeTitles.join(' · ')}` : ''
	]
		.filter(Boolean)
		.join('\n\n');

	try {
		const res = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${OPENAI_API_KEY}`
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				temperature: 0.6,
				max_tokens: MAX_INTRO_TOKENS,
				messages: [
					{
						role: 'system',
						content: [
							'You write short, warm, cookbook-style introductions for personal recipe collections.',
							'Rules:',
							'- Tone: warm, humble, natural. Not marketing copy.',
							'- ≈80-130 words, two short paragraphs.',
							'- Plain text only. No markdown headers. No emojis. No exclamation marks.',
							"- Use the existing description as the basis when one is provided — don't override the curator's voice.",
							"- Don't invent facts about specific recipes you weren't given.",
							"- Don't promise anything (e.g. 'these are the best…').",
							'- It is fine to say very little if there is little to say.'
						].join('\n')
					},
					{
						role: 'user',
						content: userMsg
					}
				]
			})
		});

		if (!res.ok) {
			console.error('[cookbook-intro] openai non-2xx', res.status);
			return json({ success: false, error: 'AI request failed' }, { status: 502 });
		}

		const data = (await res.json()) as {
			choices?: { message?: { content?: string } }[];
		};
		const intro = data.choices?.[0]?.message?.content?.trim() || '';
		if (!intro) {
			return json({ success: false, error: 'No content returned' }, { status: 502 });
		}
		return json({ success: true, introduction: intro });
	} catch (err) {
		console.error('[cookbook-intro] error', err);
		return json({ success: false, error: 'AI request failed' }, { status: 502 });
	}
};
