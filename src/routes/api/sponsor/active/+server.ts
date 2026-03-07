/**
 * Get Active Sponsors (public)
 *
 * GET /api/sponsor/active
 *
 * Optional query param: ?tier=headline or ?tier=kitchen_card
 *
 * Returns:
 * {
 *   sponsors: [{ id, title, description, imageUrl, linkUrl, tier, expiresAt }]
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getActiveSponsors, getAllSponsors, type SponsorTier } from '$lib/sponsorStore.server';
import { isAdmin } from '$lib/adminAuth';

const VALID_TIERS: SponsorTier[] = ['headline', 'kitchen_card'];

export const GET: RequestHandler = async ({ url, platform }) => {
  try {
    const kv = platform?.env?.GATED_CONTENT ?? null;

    // Admin mode: return all sponsors (active + hidden) with full details
    const adminParam = url.searchParams.get('admin');
    const pubkeyParam = url.searchParams.get('pubkey');
    if (adminParam === 'true' && isAdmin(pubkeyParam)) {
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
