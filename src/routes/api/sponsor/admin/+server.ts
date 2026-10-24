/**
 * Admin Sponsor Moderation
 *
 * POST /api/sponsor/admin
 * Body: { action: 'hide' | 'unhide', sponsorId: string }
 *
 * Gated by NIP-98 HTTP Auth — the caller signs a kind-27235 event
 * bound to this URL, method, and the exact body bytes; the signing
 * pubkey must equal ADMIN_PUBKEY (same gate as /api/admin/promos).
 * The previous body-supplied `adminPubkey` check was spoofable: the
 * admin pubkey is public, so anyone could pass it in the body.
 *
 * Returns: { success: true, sponsor: { id, status } }
 * 403 for unauthorized requests
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { verifyNip98 } from '$lib/nip98.server';
import { getSponsor, hideSponsor, unhideSponsor } from '$lib/sponsorStore.server';

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    // Read body bytes ONCE — they back both the NIP-98 payload check
    // and the JSON parse below (avoids request.clone() semantics on
    // Workers; same pattern as /api/admin/promos).
    const bodyBytes = new Uint8Array(await request.arrayBuffer());
    const auth = await verifyNip98(request, {
      expectedPubkey: ADMIN_PUBKEY,
      bodyBytes
    });
    if (!auth.ok) {
      console.warn('[sponsor.admin.auth-failed]', { reason: auth.reason });
      return json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = JSON.parse(new TextDecoder().decode(bodyBytes)) as {
      action?: unknown;
      sponsorId?: unknown;
    };
    const { action, sponsorId } = body;

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
