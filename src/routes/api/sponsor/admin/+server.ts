/**
 * Admin Sponsor Moderation
 *
 * POST /api/sponsor/admin
 * Body: { action: 'hide' | 'unhide', sponsorId: string, adminPubkey: string }
 *
 * Returns: { success: true, sponsor: { id, status } }
 * 403 for unauthorized requests
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { isAdmin } from '$lib/adminAuth';
import { getSponsor, hideSponsor, unhideSponsor } from '$lib/sponsorStore.server';

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const body = await request.json();
    const { action, sponsorId, adminPubkey } = body;

    if (!isAdmin(adminPubkey)) {
      return json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!sponsorId || typeof sponsorId !== 'string') {
      return json({ error: 'Missing sponsorId' }, { status: 400 });
    }

    if (action !== 'hide' && action !== 'unhide') {
      return json({ error: 'Invalid action. Must be "hide" or "unhide".' }, { status: 400 });
    }

    const kv = platform?.env?.GATED_CONTENT ?? null;

    // Verify sponsor exists
    const existing = await getSponsor(kv, sponsorId);
    if (!existing) {
      return json({ error: 'Sponsor not found' }, { status: 404 });
    }

    let sponsor;
    if (action === 'hide') {
      sponsor = await hideSponsor(kv, sponsorId);
    } else {
      sponsor = await unhideSponsor(kv, sponsorId);
    }

    if (!sponsor) {
      return json({ error: 'Failed to update sponsor' }, { status: 500 });
    }

    return json({
      success: true,
      sponsor: { id: sponsor.id, status: sponsor.status },
    });
  } catch (error: any) {
    console.error('[Sponsor Admin] Error:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
