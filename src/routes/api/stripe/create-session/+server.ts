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
 *   period: 'annual' | 'monthly',
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
    const { tier, period, successUrl, cancelUrl, customerEmail, pubkey } = body;
    
    if (!tier || !['cook', 'pro'].includes(tier)) {
      return json(
        { error: 'Invalid tier. Must be "cook" or "pro"' },
        { status: 400 }
      );
    }
    
    if (!period || !['annual', 'monthly'].includes(period)) {
      return json(
        { error: 'Invalid period. Must be "annual" or "monthly"' },
        { status: 400 }
      );
    }
    
    if (!successUrl || !cancelUrl) {
      return json(
        { error: 'successUrl and cancelUrl are required' },
        { status: 400 }
      );
    }

    // Validate redirect URLs belong to the same origin
    const requestOrigin = request.headers.get('origin');
    if (requestOrigin) {
      try {
        const successOrigin = new URL(successUrl).origin;
        const cancelOrigin = new URL(cancelUrl).origin;
        if (successOrigin !== requestOrigin || cancelOrigin !== requestOrigin) {
          return json(
            { error: 'Redirect URLs must match the request origin' },
            { status: 400 }
          );
        }
      } catch {
        return json(
          { error: 'Invalid redirect URL format' },
          { status: 400 }
        );
      }
    }

    // Create Stripe checkout session
    const session = await createCheckoutSession({
      tier,
      period,
      successUrl,
      cancelUrl,
      customerEmail,
      pubkey,
    });
    
    return json({
      sessionId: session.sessionId,
      url: session.url,
    });
    
  } catch (error: any) {
    console.error('[Stripe API] Error creating checkout session:', error);
    
    return json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
};

