/**
 * Nourish Seed API — publish a Nourish analysis event for a recipe.
 *
 * POST /api/nourish/seed
 *
 * This endpoint allows re-publishing Nourish analysis results to the relay
 * for recipes that were analyzed before relay publishing was implemented.
 * Requires the CRON_SECRET for authorization (same as other admin endpoints).
 *
 * Body: {
 *   recipePubkey: string,
 *   recipeDTag: string,
 *   contentHash: string,
 *   scores: NourishScores,
 *   improvements: string[],
 *   ingredientSignals: IngredientSignal[]
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    // Auth check — require CRON_SECRET
    const authHeader = request.headers.get('Authorization');
    const CRON_SECRET = (platform?.env as any)?.CRON_SECRET || env.CRON_SECRET;
    if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
      return json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const NOTIFICATION_PRIVATE_KEY = (platform?.env as any)?.NOTIFICATION_PRIVATE_KEY || env.NOTIFICATION_PRIVATE_KEY;
    if (!NOTIFICATION_PRIVATE_KEY) {
      return json({ success: false, error: 'NOTIFICATION_PRIVATE_KEY not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { recipePubkey, recipeDTag, contentHash, scores, improvements, ingredientSignals } = body;

    if (!recipePubkey || !recipeDTag || !contentHash || !scores) {
      return json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const HEX_64_RE = /^[a-fA-F0-9]{64}$/;
    if (!HEX_64_RE.test(recipePubkey)) {
      return json({ success: false, error: 'Invalid recipePubkey format' }, { status: 400 });
    }
    if (!HEX_64_RE.test(contentHash)) {
      return json({ success: false, error: 'Invalid contentHash format' }, { status: 400 });
    }

    const { publishNourishEvent } = await import('$lib/nourish/nourishPublisher.server');
    const published = await publishNourishEvent({
      privateKey: NOTIFICATION_PRIVATE_KEY,
      recipePubkey,
      recipeDTag,
      contentHash,
      scores,
      improvements: improvements || [],
      ingredientSignals: ingredientSignals || []
    });

    return json({ success: published });
  } catch (error: any) {
    console.error('[Nourish Seed] Error:', error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
};
