/**
 * POST /api/cookbook-intro — Pro-gated AI helper that polishes a Recipe
 * Pack description into a short cookbook-style introduction.
 *
 * Auth: NIP-98. The caller's pubkey comes from the verified auth event,
 * NOT from the body — see the note at the verification call below.
 *
 * Body:
 *   {
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
import { verifyNip98 } from '$lib/nip98.server';

const MAX_INTRO_TOKENS = 220;
const HEX64_RE = /^[0-9a-fA-F]{64}$/;

export const POST: RequestHandler = async ({ request, platform }) => {
	const OPENAI_API_KEY = platform?.env?.OPENAI_API_KEY || env.OPENAI_API_KEY;
	if (!OPENAI_API_KEY) {
		return json({ success: false, error: 'OpenAI API key not configured' }, { status: 500 });
	}

	// Body read ONCE as bytes: NIP-98 binds the signature to this exact
	// payload, and request.json() would consume the stream first.
	let bodyBytes: Uint8Array;
	try {
		bodyBytes = new Uint8Array(await request.arrayBuffer());
	} catch {
		return json({ success: false, error: 'Invalid request body' }, { status: 400 });
	}

	let body: Record<string, unknown>;
	try {
		body = JSON.parse(new TextDecoder().decode(bodyBytes)) as Record<string, unknown>;
	} catch {
		return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
	}

	// NIP-98 replaces the old client-supplied `pubkey` body field, which was
	// an identity CLAIM: a non-member could paste a known Pro member's
	// pubkey and spend our OpenAI budget against that membership. There is
	// no anonymous tier on this endpoint, so a signature is mandatory.
	// Uniform 401 regardless of reason; the reason is logged.
	const verification = await verifyNip98(request, { bodyBytes });
	if (!verification.ok) {
		console.warn(`[cookbook-intro] NIP-98 rejected (${verification.reason})`);
		return json({ success: false, error: 'Authentication required' }, { status: 401 });
	}
	const pubkey = verification.pubkey;
	const packTitle = typeof body.packTitle === 'string' ? body.packTitle.trim() : '';
	const packDescription =
		typeof body.packDescription === 'string' ? body.packDescription.trim() : '';
	const creatorName = typeof body.creatorName === 'string' ? body.creatorName.trim() : '';
	const recipeCount = Number(body.recipeCount) || 0;
	const recipeTitles = Array.isArray(body.recipeTitles)
		? body.recipeTitles.filter((t): t is string => typeof t === 'string').slice(0, 10)
		: [];

	// verifyNip98 returns the pubkey from a validated event, so the shape
	// check is belt-and-braces rather than input validation.
	if (!HEX64_RE.test(pubkey)) {
		return json({ success: false, error: 'Authentication required' }, { status: 401 });
	}
	if (!packTitle) {
		return json({ success: false, error: 'packTitle is required' }, { status: 400 });
	}

	// Gate — same pattern as /api/extract-recipe image/text path.
	const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
	if (MEMBERSHIP_ENABLED?.toLowerCase() === 'true') {
		const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
		// Fail closed on misconfiguration. A missing API secret while
		// gating is enabled is a deployment error — silently skipping
		// the membership check would let any caller through to OpenAI
		// on the server's dime.
		if (!API_SECRET) {
			console.error(
				'[cookbook-intro] MEMBERSHIP_ENABLED=true but RELAY_API_SECRET is not configured'
			);
			return json(
				{ success: false, error: 'Membership service not configured' },
				{ status: 503 }
			);
		}
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
			// Fail open on membership-API *outage* (transient network
			// errors etc.) — same convention as /api/extract-recipe. The
			// distinction matters: a misconfigured secret is admin error
			// and should fail closed; a flaky upstream relay shouldn't
			// nuke a paid feature for every active member.
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
