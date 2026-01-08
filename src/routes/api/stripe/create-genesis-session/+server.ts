/**
 * Genesis Founder Stripe Checkout Session API Endpoint
 * 
 * Creates a Stripe checkout session for Genesis Founder lifetime membership.
 * 
 * POST /api/stripe/create-genesis-session
 * 
 * Body:
 * {
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
import { env } from '$env/dynamic/private';

const GENESIS_PRICE_CENTS = 21000; // $210.00

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard - return 403 when disabled
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { successUrl, cancelUrl, customerEmail } = body;
    
    if (!successUrl || !cancelUrl) {
      return json(
        { error: 'successUrl and cancelUrl are required' },
        { status: 400 }
      );
    }
    
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
    
    // Create checkout session for one-time payment (not subscription)
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Genesis Founder - Lifetime Membership',
              description: 'Lifetime Pro Kitchen membership with Genesis Founder badge (#1-21)',
            },
            unit_amount: GENESIS_PRICE_CENTS,
          },
          quantity: 1,
        },
      ],
      mode: 'payment', // One-time payment, not subscription
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: customerEmail,
      metadata: {
        tier: 'genesis_founder',
        type: 'lifetime',
      },
    });
    
    if (!session.url) {
      throw new Error('Stripe session created but no URL returned');
    }
    
    return json({
      sessionId: session.id,
      url: session.url,
    });
    
  } catch (error: any) {
    console.error('[Genesis Stripe API] Error creating checkout session:', error);
    
    return json(
      { 
        error: error.message || 'Failed to create checkout session',
      },
      { status: 500 }
    );
  }
};

