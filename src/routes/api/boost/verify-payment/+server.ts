/**
 * Verify Lightning Payment for Recipe Boost
 *
 * POST /api/boost/verify-payment
 *
 * Body:
 * {
 *   boostId: string,
 *   receiveRequestId: string,
 * }
 *
 * Returns:
 *   200 { success: true, expiresAt: number }
 *   402 { error: 'Payment not yet completed', paid: false }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getReceiveRequestReceives } from '$lib/strikeService.server';
import { getBoost, activateBoost } from '$lib/boostStore.server';

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const body = await request.json();
    const { boostId, receiveRequestId } = body;

    if (!boostId) {
      return json({ error: 'boostId is required' }, { status: 400 });
    }

    if (!receiveRequestId) {
      return json({ error: 'receiveRequestId is required' }, { status: 400 });
    }

    const kv = platform?.env?.GATED_CONTENT ?? null;
    if (!kv && env.NODE_ENV === 'production') {
      console.error('[Boost Verify] GATED_CONTENT KV binding is missing in production');
      return json({ error: 'Service unavailable' }, { status: 503 });
    }

    const boost = await getBoost(kv, boostId);
    if (!boost) {
      return json({ error: 'Boost not found or expired. Please create a new invoice.' }, { status: 404 });
    }

    // Already activated — return success (idempotent)
    if (boost.status === 'active') {
      return json({ success: true, expiresAt: boost.expiresAt });
    }

    // Verify receiveRequestId matches
    if (boost.receiveRequestId !== receiveRequestId) {
      return json({ error: 'receiveRequestId does not match' }, { status: 403 });
    }

    // Check payment status via Strike API
    const receives = await getReceiveRequestReceives(receiveRequestId, platform);
    const completedReceive = receives.find((r) => r.state === 'COMPLETED');

    if (!completedReceive) {
      return json({ error: 'Payment not yet completed', paid: false }, { status: 402 });
    }

    console.log('[Boost Verify] Payment confirmed:', {
      boostId,
      receiveRequestId,
      recipeTitle: boost.recipeTitle,
    });

    // Activate the boost
    const activated = await activateBoost(kv, boostId);

    return json({
      success: true,
      expiresAt: activated?.expiresAt ?? null,
    });
  } catch (error: any) {
    console.error('[Boost Verify] Error:', error);
    return json({ error: error.message || 'Failed to verify payment' }, { status: 500 });
  }
};
