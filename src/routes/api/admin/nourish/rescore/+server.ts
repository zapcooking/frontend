/**
 * POST /api/admin/nourish/rescore — admin-triggered Nourish rescore.
 *
 * Runs the shared scoring pipeline (identical to /api/nourish) then
 * publishes a fresh kind-30078 pantry event under
 * NOURISH_SERVICE_PUBKEY with an `updated_at` tag — the tag drives
 * the client-side "Updated" badge visible for 24h after rescore.
 *
 * Auth: NIP-98 HTTP Auth. Caller sends `Authorization: Nostr <base64>`
 * containing a signed kind-27235 event bound to this URL, POST
 * method, and the exact request body (via `payload` tag hash).
 * Server verifies signature, timestamp skew (±60s), URL/method match,
 * body hash, and that the signing pubkey === ADMIN_PUBKEY. See
 * src/lib/nip98.server.ts for verifier details.
 *
 * The companion read endpoint /api/admin/nourish-flags still uses
 * the older `x-admin-pubkey` header pattern pending a follow-up
 * migration — read endpoints leak info at worst, whereas this write
 * endpoint spends LLM credit and signs pantry events under the
 * service pubkey, so the auth models diverge for now.
 *
 * Request body:
 *   {
 *     recipePubkey: string,    // hex-64
 *     recipeDTag: string,      // non-empty, ≤200 chars
 *     title: string,
 *     ingredients: string[],   // non-empty
 *     tags: string[],
 *     servings: string,
 *     contentHash: string,     // hex-64 — admin UI computes client-side
 *     reason?: string          // optional admin note, logged but not persisted
 *   }
 *
 * Success response:
 *   {
 *     success: true,
 *     scores: NourishScores,
 *     improvements: string[],
 *     ingredient_signals: IngredientSignal[],
 *     promptVersion: string,
 *     contentHash: string,
 *     createdAt: number,
 *     updatedAt: number,
 *     published: boolean
 *   }
 *
 * Error response:
 *   { error: 'forbidden' }            // 403 — auth failed (reason logged only)
 *   { success: false, error: string } // 400/500 — validation or server error
 *
 * The admin UI captures the previous score client-side via
 * queryNourishEvent before POSTing, so the response does NOT include
 * previousScore — the caller holds that state.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { NOURISH_PROMPT_VERSION } from '$lib/nourish/types';
import { runScoringPipeline } from '$lib/nourish/scoringEngine.server';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { verifyNip98 } from '$lib/nip98.server';

const HEX_64_RE = /^[a-fA-F0-9]{64}$/;

export const POST: RequestHandler = async ({ request, platform }) => {
	// Read the body ONCE — we need the raw bytes for NIP-98 payload
	// verification AND the JSON parse below. Reading via arrayBuffer
	// then decoding avoids the request.clone() pattern (whose body-
	// consumption semantics on Cloudflare Workers are worth not
	// depending on when a single read works fine).
	const bodyBytes = new Uint8Array(await request.arrayBuffer());

	const auth = await verifyNip98(request, {
		expectedPubkey: ADMIN_PUBKEY,
		bodyBytes
	});
	if (!auth.ok) {
		console.warn('[nourish.rescore.auth-failed]', { reason: auth.reason });
		return json({ error: 'forbidden' }, { status: 403 });
	}

	try {
		const OPENAI_API_KEY = (platform?.env as any)?.OPENAI_API_KEY || env.OPENAI_API_KEY;
		if (!OPENAI_API_KEY) {
			return json({ success: false, error: 'OpenAI API key not configured' }, { status: 500 });
		}

		let body: any;
		try {
			body = JSON.parse(new TextDecoder().decode(bodyBytes));
		} catch {
			return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
		}
		const {
			recipePubkey,
			recipeDTag,
			title,
			ingredients,
			tags,
			servings,
			contentHash,
			reason
		} = body ?? {};

		// Request validation. Admin endpoint requires the publish
		// coordinates upfront (unlike /api/nourish where they're optional
		// and gate only the publish side — here rescore without publish
		// would be pointless).
		const validRecipePubkey = typeof recipePubkey === 'string' && HEX_64_RE.test(recipePubkey.trim());
		const validRecipeDTag =
			typeof recipeDTag === 'string' &&
			recipeDTag.trim().length > 0 &&
			recipeDTag.trim().length <= 200;
		const validContentHash = typeof contentHash === 'string' && HEX_64_RE.test(contentHash.trim());
		if (!validRecipePubkey || !validRecipeDTag || !validContentHash) {
			return json(
				{ success: false, error: 'Invalid rescore coordinates' },
				{ status: 400 }
			);
		}

		if (!Array.isArray(ingredients) || ingredients.length === 0) {
			return json(
				{ success: false, error: 'Ingredients list is required' },
				{ status: 400 }
			);
		}

		// Optional audit-trail context; logged, not persisted. Keeps the
		// happy-path admin action greppable in Workers logs.
		if (typeof reason === 'string' && reason.length > 0) {
			console.log(
				`[Nourish Rescore] admin=${auth.pubkey} target=${recipeDTag.trim()} reason=${reason.slice(0, 200)}`
			);
		} else {
			console.log(`[Nourish Rescore] admin=${auth.pubkey} target=${recipeDTag.trim()}`);
		}

		// Run the shared scoring pipeline — same implementation as the
		// user compute endpoint.
		const pipelineResult = await runScoringPipeline(OPENAI_API_KEY, {
			title: typeof title === 'string' ? title : '',
			ingredients,
			tags: Array.isArray(tags) ? tags : [],
			servings: typeof servings === 'string' ? servings : ''
		});
		if (!pipelineResult.ok) {
			return json(
				{ success: false, error: pipelineResult.error },
				{ status: pipelineResult.status }
			);
		}
		const { scores, improvements, ingredientSignals, audienceScores } = pipelineResult;

		// Publish the new pantry event with the `updated_at` tag that
		// drives the 24h "Updated" badge on the client.
		const NOTIFICATION_PRIVATE_KEY =
			(platform?.env as any)?.NOTIFICATION_PRIVATE_KEY || env.NOTIFICATION_PRIVATE_KEY;
		if (!NOTIFICATION_PRIVATE_KEY) {
			return json(
				{ success: false, error: 'Publisher not configured' },
				{ status: 500 }
			);
		}

		const updatedAt = Math.floor(Date.now() / 1000);
		let published = false;
		try {
			const { publishNourishEvent } = await import('$lib/nourish/nourishPublisher.server');
			published = await publishNourishEvent({
				privateKey: NOTIFICATION_PRIVATE_KEY,
				recipePubkey: recipePubkey.trim(),
				recipeDTag: recipeDTag.trim(),
				contentHash: contentHash.trim(),
				scores,
				improvements,
				ingredientSignals,
				audienceScores,
				updatedAt
			});
			console.log(
				`[Nourish Rescore] publish ${published ? 'succeeded' : 'failed'} for ${recipeDTag.trim()}`
			);
		} catch (err) {
			console.error('[Nourish Rescore] publish error:', err);
			return json({ success: false, error: 'Publish failed' }, { status: 500 });
		}

		// Publish attempt returned false (no relay accepted the event) —
		// treat as a server-side failure so the admin UI can surface a
		// clear error instead of showing a misleading "Rescore failed"
		// on a success response.
		if (!published) {
			return json(
				{ success: false, error: 'Publish failed: no relay accepted the event' },
				{ status: 500 }
			);
		}

		return json({
			success: true,
			scores,
			improvements,
			ingredient_signals: ingredientSignals,
			audience_scores: audienceScores,
			promptVersion: NOURISH_PROMPT_VERSION,
			contentHash: contentHash.trim(),
			createdAt: updatedAt,
			updatedAt,
			published
		});
	} catch (error: any) {
		console.error('[Nourish Rescore] Error:', error);
		return json(
			{ success: false, error: error.message || 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
