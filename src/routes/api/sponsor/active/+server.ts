/**
 * Get Active Sponsors (public)
 *
 * GET /api/sponsor/active
 *
 * Optional query param: ?tier=headline or ?tier=kitchen_card
 *
 * Admin mode: ?admin=true returns all sponsors (active + hidden)
 * with full details. Gated by NIP-98 HTTP Auth — the signing pubkey
 * must equal ADMIN_PUBKEY. The previous ?pubkey= comparison was
 * spoofable since the admin pubkey is public.
 *
 * Returns:
 * {
 *   sponsors: [{ id, title, description, imageUrl, linkUrl, tier, expiresAt }]
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getActiveSponsors, getAllSponsors, type SponsorTier } from '$lib/sponsorStore.server';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { verifyNip98 } from '$lib/nip98.server';

const VALID_TIERS: SponsorTier[] = ['headline', 'kitchen_card'];

export const GET: RequestHandler = async ({ url, request, platform }) => {
  try {
    const kv = platform?.env?.GATED_CONTENT ?? null;

    // Admin mode: return all sponsors (active + hidden) with full details
    const adminParam = url.searchParams.get('admin');
    if (adminParam === 'true') {
      const auth = await verifyNip98(request, { expectedPubkey: ADMIN_PUBKEY });
      if (!auth.ok) {
        console.warn('[sponsor.active.admin-auth-failed]', { reason: auth.reason });
        return json({ error: 'forbidden' }, { status: 403 });
      }
      const allSponsors = await getAllSponsors(kv);
      const adminSponsors = allSponsors.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        imageUrl: s.imageUrl,
        linkUrl: s.linkUrl,
        tier: s.tier,
        expiresAt: s.expiresAt,
        status: s.status,
        buyerPubkey: s.buyerPubkey,
      }));
      return json({ sponsors: adminSponsors });
    }

    const tierParam = url.searchParams.get('tier');
    let tier: SponsorTier | undefined;
    if (tierParam && VALID_TIERS.includes(tierParam as SponsorTier)) {
      tier = tierParam as SponsorTier;
    }

    const sponsors = await getActiveSponsors(kv, tier);

    const publicSponsors = sponsors.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      imageUrl: s.imageUrl,
      linkUrl: s.linkUrl,
      tier: s.tier,
      expiresAt: s.expiresAt,
    }));

    return json(
      { sponsors: publicSponsors },
      {
        headers: {
          'Cache-Control': 'public, max-age=60',
        },
      },
    );
  } catch (error: any) {
    console.error('[Sponsor Active] Error:', error);
    return json({ error: 'Failed to fetch active sponsors' }, { status: 500 });
  }
};
