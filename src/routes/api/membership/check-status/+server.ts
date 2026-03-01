/**
 * Check Membership Status
 *
 * Checks if a user's pubkey is in the members API.
 * Uses direct single-member lookup for O(1) performance.
 *
 * POST /api/membership/check-status
 *
 * Body:
 * {
 *   pubkey: string
 * }
 *
 * Returns:
 * {
 *   found: boolean,
 *   member?: {
 *     pubkey: string,
 *     tier: string,
 *     status: string,
 *     subscription_end: string,
 *     payment_id: string,
 *     ...
 *   }
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { lookupMember } from '$lib/membershipApi.server';

/**
 * Normalize relay tier values to the canonical app tiers.
 * Founders are stored as tier:'standard' with payment_id like 'genesis_1'.
 */
function normalizeRelayTier(tier: string | null | undefined, paymentId?: string | null): string {
  const pid = String(paymentId || '').trim().toLowerCase();
  if (pid.startsWith('genesis_') || pid.startsWith('founder')) return 'founders';

  const value = String(tier || '').trim().toLowerCase();
  if (value === 'cook_plus' || value === 'cook-plus' || value === 'cook plus' || value === 'cook') return 'cook_plus';
  if (value === 'pro_kitchen' || value === 'pro-kitchen' || value === 'pro kitchen' || value === 'pro') return 'pro_kitchen';
  if (value === 'founders' || value === 'founder' || value === 'genesis_founder' || value === 'genesis-founder') return 'founders';
  return 'open';
}

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { pubkey } = body;

    if (!pubkey) {
      return json(
        { error: 'pubkey is required' },
        { status: 400 }
      );
    }

    // Validate pubkey format
    if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
      return json(
        { error: 'Invalid pubkey format' },
        { status: 400 }
      );
    }

    // Get API secret
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (!API_SECRET) {
      return json(
        { error: 'RELAY_API_SECRET not configured' },
        { status: 500 }
      );
    }

    const result = await lookupMember(pubkey, API_SECRET);

    if (!result.found) {
      return json({ found: false });
    }

    const tier = normalizeRelayTier(result.member.tier, result.member.payment_id);
    const member = { ...result.member, tier };

    // Founders get lifetime access — ensure expiry is at least 10 years out
    if (tier === 'founders' && member.subscription_end) {
      const tenYearsFromNow = new Date();
      tenYearsFromNow.setFullYear(tenYearsFromNow.getFullYear() + 10);
      const currentExpiry = new Date(member.subscription_end);
      if (currentExpiry < tenYearsFromNow) {
        member.subscription_end = tenYearsFromNow.toISOString();
      }
    }

    return json({
      found: true,
      isActive: result.isActive,
      isExpired: result.isExpired,
      member
    });

  } catch (error: any) {
    console.error('[Membership Status] Error checking status:', error);

    return json(
      {
        error: error.message || 'Failed to check membership status',
        found: false
      },
      { status: 500 }
    );
  }
};

