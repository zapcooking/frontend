/**
 * Check Membership Status
 * 
 * Checks if a user's pubkey is in the members API.
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
    
    // Fetch all members
    const membersRes = await fetch('https://pantry.zap.cooking/api/members', {
      headers: {
        'Authorization': `Bearer ${API_SECRET}`
      }
    });
    
    if (!membersRes.ok) {
      throw new Error(`Failed to fetch members: ${membersRes.status}`);
    }
    
    const data = await membersRes.json();
    const member = data.members?.find((m: any) => 
      m.pubkey?.toLowerCase() === pubkey.toLowerCase()
    );
    
    if (member) {
      // Check if subscription is still active (not expired)
      const now = new Date();
      let isActive = member.status === 'active';
      let isExpired = false;
      
      if (member.subscription_end) {
        const endDate = new Date(member.subscription_end);
        if (endDate < now) {
          isExpired = true;
          isActive = false; // Expired members are not active
        }
      }
      
      return json({
        found: true,
        isActive,
        isExpired,
        member: {
          pubkey: member.pubkey,
          tier: member.tier,
          status: member.status,
          subscription_end: member.subscription_end,
          subscription_start: member.subscription_start,
          payment_id: member.payment_id,
          payment_method: member.payment_method,
          created_at: member.created_at,
          updated_at: member.updated_at
        }
      });
    } else {
      return json({
        found: false,
        totalMembers: data.total || 0
      });
    }
    
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

