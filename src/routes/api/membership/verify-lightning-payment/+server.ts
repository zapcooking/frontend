/**
 * Verify Lightning Payment for Membership
 * 
 * Verifies that a Lightning payment was completed and processes the membership.
 * This is a simulation endpoint - in production, this would verify with a Lightning node.
 * 
 * POST /api/membership/verify-lightning-payment
 * 
 * Body:
 * {
 *   paymentHash: string,
 *   invoice: string,
 *   pubkey: string,
 *   tier: 'cook' | 'pro',
 *   period: 'annual' | '2year',
 *   preimage?: string // Payment preimage for verification
 * }
 * 
 * Returns:
 * {
 *   success: boolean,
 *   subscriptionEnd?: string
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
    const { paymentHash, invoice, pubkey, tier, period, preimage } = body;
    
    if (!paymentHash || !invoice || !pubkey || !tier || !period) {
      return json(
        { error: 'paymentHash, invoice, pubkey, tier, and period are required' },
        { status: 400 }
      );
    }
    
    if (!['cook', 'pro'].includes(tier)) {
      return json(
        { error: 'Invalid tier. Must be "cook" or "pro"' },
        { status: 400 }
      );
    }
    
    if (!['annual', '2year'].includes(period)) {
      return json(
        { error: 'Invalid period. Must be "annual" or "2year"' },
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
    
    // TODO: In production, verify payment with Lightning node
    const isSimulated = invoice.includes('simulated');
    
    if (isSimulated) {
      console.log('[Membership Lightning] Simulated payment - accepting for testing');
    } else if (!preimage) {
      return json(
        { error: 'Payment verification required - please provide preimage' },
        { status: 400 }
      );
    }
    
    // Get API secret for members API
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (!API_SECRET) {
      return json(
        { error: 'RELAY_API_SECRET not configured' },
        { status: 500 }
      );
    }
    
    // Calculate subscription end date
    const now = new Date();
    const subscriptionMonths = period === 'annual' ? 12 : 24;
    const subscriptionEnd = new Date(now);
    subscriptionEnd.setMonth(now.getMonth() + subscriptionMonths);
    
    // Generate payment_id
    const paymentId = `${tier}_${Date.now()}`;
    
    console.log('[Membership Lightning] Adding member to relay API...', {
      pubkey: pubkey.substring(0, 16) + '...',
      tier,
      period,
      subscriptionEnd: subscriptionEnd.toISOString()
    });
    
    // Add member to relay API
    const addMemberRes = await fetch('https://pantry.zap.cooking/api/members', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pubkey: pubkey,
        subscription_months: subscriptionMonths,
        payment_id: paymentId,
        tier: 'standard', // Use 'standard' tier like existing members
        subscription_end: subscriptionEnd.toISOString(),
        payment_method: 'lightning'
      })
    });
    
    if (!addMemberRes.ok) {
      const responseText = await addMemberRes.text();
      let errorData;
      try {
        errorData = JSON.parse(responseText);
      } catch (e) {
        errorData = { error: responseText };
      }
      console.error('[Membership Lightning] Add member API returned error:', {
        status: addMemberRes.status,
        error: errorData
      });
      throw new Error(errorData.error || `Failed to add member: ${addMemberRes.status}`);
    }
    
    // Auto-claim NIP-05 for the new member
    let nip05: string | null = null;
    let nip05Username: string | null = null;
    
    try {
      // Generate username from pubkey (first 8 chars)
      const suggestedUsername = pubkey.substring(0, 8).toLowerCase();
      
      console.log('[Membership Lightning] Auto-claiming NIP-05:', suggestedUsername);
      
      const nip05Res = await fetch('https://pantry.zap.cooking/api/nip05/claim', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_SECRET}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: suggestedUsername,
          pubkey,
          tier: tier as 'cook' | 'pro'
        })
      });
      
      if (nip05Res.ok) {
        nip05Username = suggestedUsername;
        nip05 = `${suggestedUsername}@zap.cooking`;
        console.log('[Membership Lightning] NIP-05 claimed:', nip05);
      } else {
        // If default username fails, try with timestamp suffix
        const fallbackUsername = `${pubkey.substring(0, 6)}${Date.now().toString(36).slice(-2)}`.toLowerCase();
        
        const fallbackRes = await fetch('https://pantry.zap.cooking/api/nip05/claim', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_SECRET}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username: fallbackUsername,
            pubkey,
            tier: tier as 'cook' | 'pro'
          })
        });
        
        if (fallbackRes.ok) {
          nip05Username = fallbackUsername;
          nip05 = `${fallbackUsername}@zap.cooking`;
          console.log('[Membership Lightning] NIP-05 claimed (fallback):', nip05);
        } else {
          console.warn('[Membership Lightning] Could not auto-claim NIP-05');
        }
      }
    } catch (nip05Error) {
      // NIP-05 claim is optional - don't fail the payment verification
      console.warn('[Membership Lightning] NIP-05 auto-claim error:', nip05Error);
    }
    
    return json({
      success: true,
      subscriptionEnd: subscriptionEnd.toISOString(),
      message: `${tier === 'cook' ? 'Cook+' : 'Pro Kitchen'} membership activated via Lightning`,
      nip05,
      nip05Username
    });
    
  } catch (error: any) {
    console.error('[Membership Lightning] Error verifying payment:', error);
    
    return json(
      { 
        error: error.message || 'Failed to verify payment',
        success: false
      },
      { status: 500 }
    );
  }
};
