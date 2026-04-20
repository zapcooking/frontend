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
 *   servings: string,
 *   recipePubkey?: string,     // hex — required for pantry publish
 *   recipeDTag?: string,       // required for pantry publish
 *   contentHash?: string       // SHA-256 hex — required for pantry publish
 * }
 *
 * Success response:
 * {
 *   success: true,
 *   scores: NourishScores,              // includes cacheVersion
 *   improvements: string[],             // up to 5
 *   ingredient_signals: IngredientSignal[],
 *   promptVersion: string,              // model/prompt identity
 *   contentHash?: string,               // echoed when valid
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
import { NOURISH_PROMPT_VERSION } from '$lib/nourish/types';
import { runScoringPipeline } from '$lib/nourish/scoringEngine.server';
import { requireMembership } from './membershipCheck';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const OPENAI_API_KEY = (platform?.env as any)?.OPENAI_API_KEY || env.OPENAI_API_KEY;
		if (!OPENAI_API_KEY) {
			return json({ success: false, error: 'OpenAI API key not configured' }, { status: 500 });
		}

		const body = await request.json();
		const { pubkey, eventId, title, ingredients, tags, servings, recipePubkey, recipeDTag, contentHash } = body;

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

		// Membership check (fail-closed)
		const membershipError = await requireMembership(pubkey, platform);
		if (membershipError) return membershipError;

		// Run the shared scoring pipeline (prompt → OpenAI → parse → validate)
		const pipelineResult = await runScoringPipeline(OPENAI_API_KEY, {
			title,
			ingredients,
			tags,
			servings
		});
		if (!pipelineResult.ok) {
			return json(
				{ success: false, error: pipelineResult.error },
				{ status: pipelineResult.status }
			);
		}
		const { scores, improvements, ingredientSignals } = pipelineResult;
		const ingredient_signals = ingredientSignals;

		// Publish Nourish event to relay (awaited — not fire-and-forget).
		// On CF Workers, background WebSocket tasks die after response. We await
		// the publish before returning so it actually completes. Adds ~1-2s to
		// the response, but GPT already takes 2-5s so this is acceptable.
		const HEX_64_RE = /^[a-fA-F0-9]{64}$/;
		const validRecipePubkey = typeof recipePubkey === 'string' && HEX_64_RE.test(recipePubkey.trim());
		const validContentHash = typeof contentHash === 'string' && HEX_64_RE.test(contentHash.trim());
		const validRecipeDTag = typeof recipeDTag === 'string' && recipeDTag.trim().length > 0 && recipeDTag.trim().length <= 200;

		if (validRecipePubkey && validRecipeDTag && validContentHash) {
			const NOTIFICATION_PRIVATE_KEY = (platform?.env as any)?.NOTIFICATION_PRIVATE_KEY || env.NOTIFICATION_PRIVATE_KEY;
			if (NOTIFICATION_PRIVATE_KEY) {
				try {
					const { publishNourishEvent } = await import('$lib/nourish/nourishPublisher.server');
					const published = await publishNourishEvent({
						privateKey: NOTIFICATION_PRIVATE_KEY,
						recipePubkey: recipePubkey.trim(),
						recipeDTag: recipeDTag.trim(),
						contentHash: contentHash.trim(),
						scores,
						improvements,
						ingredientSignals: ingredient_signals
					});
					console.log(`[Nourish] Publish ${published ? 'succeeded' : 'failed'} for ${recipeDTag}`);
				} catch (err) {
					console.error('[Nourish] Failed to publish event:', err);
				}
			}
		}

		return json({
			success: true,
			scores,
			improvements,
			ingredient_signals,
			// Identity fields — let clients cache/reconcile by promptVersion
			// + contentHash + createdAt instead of inferring from cacheVersion.
			promptVersion: NOURISH_PROMPT_VERSION,
			contentHash: validContentHash ? contentHash.trim() : undefined,
			createdAt: Math.floor(Date.now() / 1000)
		});
	} catch (error: any) {
		console.error('[Nourish] Error:', error);
		return json(
			{ success: false, error: error.message || 'An unexpected error occurred' },
			{ status: 500 }
		);
	}
};
