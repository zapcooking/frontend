/**
 * Simulate Lightning Payment (DEVELOPMENT ONLY)
 * 
 * This endpoint simulates a successful Lightning payment for testing purposes.
 * Only available in development mode.
 * 
 * POST /api/membership/simulate-payment
 * 
 * Body:
 * {
 *   pubkey: string,
 *   tier: 'cook' | 'pro',
 *   period: 'annual' | '2year',
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

export const POST: RequestHandler = async ({ request, platform }) => {
  // Only allow in development mode
  if (!dev) {
    return json({ error: 'This endpoint is only available in development mode' }, { status: 403 });
  }

  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { pubkey, tier, period } = body;
    
    if (!pubkey || !tier || !period) {
      return json(
        { error: 'pubkey, tier, and period are required' },
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
    
    // Get API secret for members API
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (!API_SECRET) {
      console.warn('[Simulate Payment] RELAY_API_SECRET not configured - skipping relay API call');
      // In dev mode without relay secret, just return success
      const now = new Date();
      const subscriptionMonths = period === 'annual' ? 12 : 24;
      const subscriptionEnd = new Date(now);
      subscriptionEnd.setMonth(now.getMonth() + subscriptionMonths);
      
      return json({
        success: true,
        simulated: true,
        message: `${tier === 'cook' ? 'Cook+' : 'Pro Kitchen'} membership simulated (relay API not configured)`,
        pubkey: pubkey.substring(0, 16) + '...',
        tier,
        period,
        subscriptionEnd: subscriptionEnd.toISOString(),
        nip05: null,
        nip05Username: null
      });
    }
    
    // Calculate subscription end date
    const now = new Date();
    const subscriptionMonths = period === 'annual' ? 12 : 24;
    const subscriptionEnd = new Date(now);
    subscriptionEnd.setMonth(now.getMonth() + subscriptionMonths);
    
    // Generate payment_id
    const paymentId = `${tier}_simulated_${Date.now()}`;
    
    console.log('[Simulate Payment] Adding member to relay API...', {
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
        tier: 'standard',
        subscription_end: subscriptionEnd.toISOString(),
        payment_method: 'lightning_simulated'
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
      console.error('[Simulate Payment] Add member API returned error:', {
        status: addMemberRes.status,
        error: errorData
      });
      throw new Error(errorData.error || `Failed to add member: ${addMemberRes.status}`);
    }
    
    // Auto-claim NIP-05 for the new member
    let nip05: string | null = null;
    let nip05Username: string | null = null;
    
    try {
      const suggestedUsername = pubkey.substring(0, 8).toLowerCase();
      
      console.log('[Simulate Payment] Auto-claiming NIP-05:', suggestedUsername);
      
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
        console.log('[Simulate Payment] NIP-05 claimed:', nip05);
      }
    } catch (nip05Error) {
      console.warn('[Simulate Payment] NIP-05 auto-claim error:', nip05Error);
    }
    
    console.log('[Simulate Payment] Membership activated successfully');
    
    return json({
      success: true,
      simulated: true,
      message: `${tier === 'cook' ? 'Cook+' : 'Pro Kitchen'} membership activated (simulated)`,
      pubkey: pubkey.substring(0, 16) + '...',
      tier,
      period,
      subscriptionEnd: subscriptionEnd.toISOString(),
      nip05,
      nip05Username
    });
    
  } catch (error: any) {
    console.error('[Simulate Payment] Error:', error);
    
    return json(
      { 
        error: error.message || 'Failed to simulate payment',
        success: false
      },
      { status: 500 }
    );
  }
};

export const GET: RequestHandler = async () => {
  if (!dev) {
    return json({ error: 'This endpoint is only available in development mode' }, { status: 403 });
  }
  
  return json({
    status: 'ok',
    endpoint: '/api/membership/simulate-payment',
    description: 'Development-only endpoint to simulate Lightning payment completion',
    method: 'POST',
    body: {
      pubkey: 'string (64 hex characters)',
      tier: 'cook | pro',
      period: 'annual | 2year'
    }
  });
};
