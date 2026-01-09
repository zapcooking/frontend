/**
 * Stripe Checkout Session API Endpoint
 * 
 * Creates a Stripe checkout session for membership payments.
 * 
 * POST /api/stripe/create-session
 * 
 * Body:
 * {
 *   tier: 'cook' | 'pro',
 *   period: 'annual' | '2year',
 *   successUrl: string,
 *   cancelUrl: string,
 *   customerEmail?: string
 * }
 * 
 * Returns:
 * {
 *   sessionId: string,
 *   url: string
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { createCheckoutSession } from '$lib/stripeService.server';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard - return 403 when disabled
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    
    // Validate required fields
    const { tier, period, successUrl, cancelUrl, customerEmail } = body;
    
    if (!tier || !['cook', 'pro'].includes(tier)) {
      return json(
        { error: 'Invalid tier. Must be "cook" or "pro"' },
        { status: 400 }
      );
    }
    
    if (!period || !['annual', '2year'].includes(period)) {
      return json(
        { error: 'Invalid period. Must be "annual" or "2year"' },
        { status: 400 }
      );
    }
    
    if (!successUrl || !cancelUrl) {
      return json(
        { error: 'successUrl and cancelUrl are required' },
        { status: 400 }
      );
    }
    
    // Create Stripe checkout session
    const session = await createCheckoutSession({
      tier,
      period,
      successUrl,
      cancelUrl,
      customerEmail,
    });
    
    return json({
      sessionId: session.sessionId,
      url: session.url,
    });
    
  } catch (error: any) {
    console.error('[Stripe API] Error creating checkout session:', error);
    
    // Don't expose internal error details in production
    return json(
      { 
        error: error.message || 'Failed to create checkout session',
        // Include helpful message if Stripe key is missing
        ...(error.message?.includes('STRIPE_SECRET_KEY') 
          ? { hint: 'Stripe secret key is not configured. Please set STRIPE_SECRET_KEY environment variable.' }
          : {})
      },
      { status: 500 }
    );
  }
};

