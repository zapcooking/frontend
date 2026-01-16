/**
 * Complete Membership Payment (Stripe)
 * 
 * Verifies Stripe payment and adds member to relay API for Cook+ or Pro Kitchen.
 * 
 * POST /api/membership/complete-payment
 * 
 * Body:
 * {
 *   sessionId: string,
 *   pubkey: string
 * }
 * 
 * Returns:
 * {
 *   success: boolean,
 *   tier?: string,
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
    const { sessionId, pubkey } = body;
    
    if (!sessionId || !pubkey) {
      return json(
        { error: 'sessionId and pubkey are required' },
        { status: 400 }
      );
    }
    
    // Get API secret
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (!API_SECRET) {
      console.error('[Membership Payment] RELAY_API_SECRET not configured');
      return json(
        { error: 'RELAY_API_SECRET not configured' },
        { status: 500 }
      );
    }
    
    // Verify Stripe session
    const stripeKey = platform?.env?.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      console.error('[Membership Payment] STRIPE_SECRET_KEY not configured');
      return json(
        { error: 'STRIPE_SECRET_KEY not configured' },
        { status: 500 }
      );
    }
    
    // Dynamic import to avoid Cloudflare Workers build issues
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-12-18.acacia',
      typescript: true,
    });
    
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status !== 'paid') {
      return json(
        { error: 'Payment not completed' },
        { status: 400 }
      );
    }
    
    // Extract tier and period from session metadata
    const tier = session.metadata?.tier || 'cook';
    const period = session.metadata?.period || 'annual';
    
    // Validate tier and period
    if (!['cook', 'pro'].includes(tier)) {
      return json(
        { error: 'Invalid tier in payment metadata' },
        { status: 400 }
      );
    }
    
    if (!['annual', '2year'].includes(period)) {
      return json(
        { error: 'Invalid period in payment metadata' },
        { status: 400 }
      );
    }
    
    // Calculate subscription end date
    const now = new Date();
    const subscriptionMonths = period === 'annual' ? 12 : 24;
    const subscriptionEnd = new Date(now);
    subscriptionEnd.setMonth(now.getMonth() + subscriptionMonths);
    
    // Validate pubkey format
    if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
      return json(
        { error: 'Invalid pubkey format' },
        { status: 400 }
      );
    }
    
    // Generate payment_id
    const paymentId = `${tier}_stripe_${Date.now()}`;
    
    console.log('[Membership Payment] Adding member to relay API...', {
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
        payment_method: 'stripe'
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
      console.error('[Membership Payment] Add member API returned error:', {
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
      
      console.log('[Membership Payment] Auto-claiming NIP-05:', suggestedUsername);
      
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
        console.log('[Membership Payment] NIP-05 claimed:', nip05);
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
          console.log('[Membership Payment] NIP-05 claimed (fallback):', nip05);
        } else {
          console.warn('[Membership Payment] Could not auto-claim NIP-05');
        }
      }
    } catch (nip05Error) {
      // NIP-05 claim is optional - don't fail the payment completion
      console.warn('[Membership Payment] NIP-05 auto-claim error:', nip05Error);
    }
    
    return json({
      success: true,
      tier,
      subscriptionEnd: subscriptionEnd.toISOString(),
      message: `${tier === 'cook' ? 'Cook+' : 'Pro Kitchen'} membership activated`,
      nip05,
      nip05Username
    });
    
  } catch (error: any) {
    console.error('[Membership Payment] Error completing payment:', error);
    
    return json(
      { 
        error: error.message || 'Failed to complete payment',
        success: false
      },
      { status: 500 }
    );
  }
};
