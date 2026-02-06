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

    return json({
      found: true,
      isActive: result.isActive,
      isExpired: result.isExpired,
      member: result.member
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

