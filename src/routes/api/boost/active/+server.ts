/**
 * Get Active Boosts (public, no auth required)
 *
 * GET /api/boost/active
 *
 * Returns:
 * {
 *   boosts: [{ naddr, recipeTitle, recipeImage, authorPubkey, tier, expiresAt }]
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getActiveBoosts } from '$lib/boostStore.server';

export const GET: RequestHandler = async ({ platform }) => {
  try {
    const kv = platform?.env?.GATED_CONTENT ?? null;
    const boosts = await getActiveBoosts(kv);

    return json(
      {
        boosts: boosts.map((b) => ({
          naddr: b.naddr,
          recipeTitle: b.recipeTitle,
          recipeImage: b.recipeImage,
          authorPubkey: b.authorPubkey,
          tier: b.tier,
          expiresAt: b.expiresAt,
        })),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=60',
        },
      },
    );
  } catch (error: any) {
    console.error('[Boost Active] Error:', error);
    return json({ boosts: [] }, { status: 500 });
  }
};
