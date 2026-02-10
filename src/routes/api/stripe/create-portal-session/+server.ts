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
 *   pubkey: string,      // User's public key (used to find Stripe customer)
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
    const { pubkey, returnUrl } = body;

    if (!pubkey) {
      return json({ error: 'pubkey is required' }, { status: 400 });
    }

    if (!returnUrl) {
      return json({ error: 'returnUrl is required' }, { status: 400 });
    }

    // Validate pubkey format
    if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
      return json({ error: 'Invalid pubkey format' }, { status: 400 });
    }

    // Get Stripe secret key
    const stripeKey = platform?.env?.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      console.error('[Stripe Portal] STRIPE_SECRET_KEY not configured');
      return json({ error: 'Payment service unavailable' }, { status: 500 });
    }

    // Dynamic import to avoid Cloudflare Workers build issues
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-12-18.acacia',
      typescript: true,
    });

    // Find the customer by searching checkout sessions with this pubkey in metadata
    const sessions = await stripe.checkout.sessions.list({
      limit: 10,
    });

    let customerId: string | null = null;

    for (const session of sessions.data) {
      if (session.metadata?.pubkey === pubkey && session.customer) {
        customerId = typeof session.customer === 'string'
          ? session.customer
          : session.customer.id;
        break;
      }
    }

    if (!customerId) {
      return json(
        { error: 'No Stripe subscription found for this account' },
        { status: 404 }
      );
    }

    // Create portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return json({ url: portalSession.url });
  } catch (error: any) {
    console.error('[Stripe Portal] Error creating portal session:', error);

    return json(
      { error: 'Failed to create portal session' },
      { status: 500 }
    );
  }
};
