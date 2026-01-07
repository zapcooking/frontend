/**
 * Complete Genesis Founder Payment
 * 
 * Verifies Stripe payment and adds member to relay API
 * 
 * POST /api/genesis/complete-payment
 * 
 * Body:
 * {
 *   sessionId: string,
 *   pubkey: string
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, platform }) => {
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
      return json(
        { error: 'RELAY_API_SECRET not configured' },
        { status: 500 }
      );
    }
    
    // Verify Stripe session
    const stripeKey = env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
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
    
    // Get current founders count to determine founder number
    const membersRes = await fetch('https://members.zap.cooking/api/members', {
      headers: {
        'Authorization': `Bearer ${API_SECRET}`
      }
    });
    
    if (!membersRes.ok) {
      throw new Error(`Failed to fetch members: ${membersRes.status}`);
    }
    
    const membersData = await membersRes.json();
    const founders = membersData.members.filter((m: any) => 
      m.payment_id?.startsWith('genesis_')
    );
    
    const founderNumber = founders.length + 1;
    
    if (founderNumber > 21) {
      return json(
        { error: 'All Genesis Founder spots are taken' },
        { status: 400 }
      );
    }
    
    // Add member to relay API
    const addMemberRes = await fetch('https://members.zap.cooking/api/members', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pubkey: pubkey,
        subscription_months: 0, // Lifetime - will set subscription_end to 2099
        payment_id: `genesis_${founderNumber}`,
        tier: 'genesis_founder',
        subscription_end: '2099-12-31T23:59:59Z' // Far future date for lifetime
      })
    });
    
    if (!addMemberRes.ok) {
      const errorData = await addMemberRes.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to add member: ${addMemberRes.status}`);
    }
    
    return json({
      success: true,
      founderNumber,
      message: 'Genesis Founder membership activated'
    });
    
  } catch (error: any) {
    console.error('[Genesis Payment] Error completing payment:', error);
    
    return json(
      { 
        error: error.message || 'Failed to complete payment',
      },
      { status: 500 }
    );
  }
};

