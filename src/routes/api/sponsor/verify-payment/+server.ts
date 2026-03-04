/**
 * Verify Lightning Payment for Sponsor Placement
 *
 * POST /api/sponsor/verify-payment
 *
 * Body:
 * {
 *   sponsorId: string,
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
import { getSponsor, activateSponsor } from '$lib/sponsorStore.server';

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const body = await request.json();
    const { sponsorId, receiveRequestId } = body;

    if (!sponsorId) {
      return json({ error: 'sponsorId is required' }, { status: 400 });
    }

    if (!receiveRequestId) {
      return json({ error: 'receiveRequestId is required' }, { status: 400 });
    }

    const kv = platform?.env?.GATED_CONTENT ?? null;
    if (!kv && env.NODE_ENV === 'production') {
      console.error('[Sponsor Verify] GATED_CONTENT KV binding is missing in production');
      return json({ error: 'Service unavailable' }, { status: 503 });
    }

    const sponsor = await getSponsor(kv, sponsorId);
    if (!sponsor) {
      return json({ error: 'Sponsor not found or expired. Please create a new invoice.' }, { status: 404 });
    }

    // Already activated — return success (idempotent)
    if (sponsor.status === 'active') {
      return json({ success: true, expiresAt: sponsor.expiresAt });
    }

    // Verify receiveRequestId matches
    if (sponsor.receiveRequestId !== receiveRequestId) {
      return json({ error: 'receiveRequestId does not match' }, { status: 403 });
    }

    // Check payment status via Strike API
    const receives = await getReceiveRequestReceives(receiveRequestId, platform);
    const completedReceive = receives.find((r) => r.state === 'COMPLETED');

    if (!completedReceive) {
      return json({ error: 'Payment not yet completed', paid: false }, { status: 402 });
    }

    console.log('[Sponsor Verify] Payment confirmed:', {
      sponsorId,
      receiveRequestId,
      title: sponsor.title,
    });

    // Activate the sponsor
    const activated = await activateSponsor(kv, sponsorId);

    return json({
      success: true,
      expiresAt: activated?.expiresAt ?? null,
    });
  } catch (error: any) {
    console.error('[Sponsor Verify] Error:', error);
    return json({ error: error.message || 'Failed to verify payment' }, { status: 500 });
  }
};
