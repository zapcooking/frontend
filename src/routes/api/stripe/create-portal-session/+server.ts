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
      apiVersion: '2025-12-15.clover',
      typescript: true,
    });

    let customerId: string | null = null;

    // Resolve pubkey -> customer from subscription metadata.
    //
    // createCheckoutSession stamps the pubkey onto `subscription_data.metadata`,
    // so every subscription created from this deploy onward is addressable by
    // it. That is the same write the invoice.paid renewal handler reads, used in
    // the other direction: the renewal needs Stripe object -> pubkey, the portal
    // needs pubkey -> Stripe object.
    //
    // Cancelled and past_due subscriptions are searchable too, which is correct
    // here — a member managing their billing is often exactly the member whose
    // subscription is no longer active.
    try {
      const found = await stripe.subscriptions.search({
        query: `metadata['pubkey']:'${pubkey}'`,
        limit: 1,
      });

      const subscription = found.data[0];
      if (subscription?.customer) {
        customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;
      }
    } catch (searchError: any) {
      // Search is a separate Stripe surface with its own index and its own
      // failure modes. Losing it must not take the portal down — the fallback
      // below is what shipped before this and still resolves recent checkouts.
      console.error('[Stripe Portal] Subscription metadata search failed, falling back:', searchError?.message);
    }

    // Fallback: walk recent checkout sessions.
    //
    // Retained, not replaced. It is the only path that resolves a customer for
    // a subscription created before subscription_data.metadata was added, and
    // the only one that resolves a one-time `mode: 'payment'` customer (the
    // Founders) at all, since those have no subscription to search. Its known
    // limit is that it is account-wide and capped at 10, so it silently stops
    // working for anyone who is not among the last ten checkouts platform-wide.
    // Deleting it is a separate decision from adding the search above.
    if (!customerId) {
      const sessions = await stripe.checkout.sessions.list({
        limit: 10,
      });

      for (const session of sessions.data) {
        if (session.metadata?.pubkey === pubkey && session.customer) {
          customerId = typeof session.customer === 'string'
            ? session.customer
            : session.customer.id;
          break;
        }
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
