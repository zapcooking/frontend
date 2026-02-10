/**
 * Stripe Customer Portal Session API Endpoint
 *
 * Creates a Stripe Customer Portal session so members can manage their subscription
 * (cancel, update payment method, view invoices).
 *
 * POST /api/stripe/create-portal-session
 *
 * Body:
 * {
 *   sessionId: string,   // Original Stripe checkout session ID
 *   returnUrl: string     // URL to redirect back to after portal
 * }
 *
 * Returns:
 * {
 *   url: string           // Stripe-hosted portal URL
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
    const { sessionId, returnUrl } = body;

    if (!sessionId) {
      return json({ error: 'sessionId is required' }, { status: 400 });
    }

    if (!returnUrl) {
      return json({ error: 'returnUrl is required' }, { status: 400 });
    }

    // Get Stripe secret key
    const stripeKey = platform?.env?.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 500 });
    }

    // Dynamic import to avoid Cloudflare Workers build issues
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-12-18.acacia',
      typescript: true,
    });

    // Retrieve the original checkout session to get the customer ID
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);

    if (!checkoutSession.customer) {
      return json(
        { error: 'No customer associated with this session' },
        { status: 400 }
      );
    }

    const customerId = typeof checkoutSession.customer === 'string'
      ? checkoutSession.customer
      : checkoutSession.customer.id;

    // Create portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return json({ url: portalSession.url });
  } catch (error: any) {
    console.error('[Stripe Portal] Error creating portal session:', error);

    return json(
      { error: error.message || 'Failed to create portal session' },
      { status: 500 }
    );
  }
};
