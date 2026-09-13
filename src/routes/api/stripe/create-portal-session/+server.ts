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
 * Requires a NIP-98 `Authorization` header signed by `pubkey` itself
 * (pair with signNip98AuthHeader in $lib/nip98). Unlike check-status,
 * which degrades to a public shape when the signature is absent, this
 * endpoint refuses: everything behind it is private billing data.
 *
 * The portal it opens is the member's whole Stripe billing console —
 * cancel the subscription, read invoice history with name, email,
 * billing address and card last4, change the payment method. A pubkey
 * is public by construction on Nostr, so possession of one cannot be
 * the credential. Before this gate, a request body was the only thing
 * standing between any pubkey and that console.
 *
 * Returns:
 * {
 *   url: string           // Stripe-hosted portal URL
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifyNip98 } from '$lib/nip98.server';

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  // Read the body bytes ONCE — NIP-98 payload verification and JSON
  // parsing must see the same bytes (see verifyNip98's doc comment on
  // body-consumption semantics on Cloudflare Workers).
  let pubkey: unknown;
  let returnUrl: unknown;
  let bodyBytes: Uint8Array;
  try {
    bodyBytes = new Uint8Array(await request.arrayBuffer());
    ({ pubkey, returnUrl } = JSON.parse(new TextDecoder().decode(bodyBytes)));
  } catch {
    return json({ error: 'pubkey is required' }, { status: 400 });
  }

  if (!pubkey || typeof pubkey !== 'string') {
    return json({ error: 'pubkey is required' }, { status: 400 });
  }

  if (!returnUrl || typeof returnUrl !== 'string') {
    return json({ error: 'returnUrl is required' }, { status: 400 });
  }

  // Validate pubkey format
  if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
    return json({ error: 'Invalid pubkey format' }, { status: 400 });
  }

  // Identity gate. The pubkey in the body names whose billing console
  // this opens, so it is exactly the pubkey that has to have signed.
  // Ordered after the shape checks above because expectedPubkey is
  // derived from the body — and before any Stripe call, so an
  // unauthenticated request costs us no API request and learns nothing
  // about whether that pubkey has a subscription.
  const verification = await verifyNip98(request, {
    expectedPubkey: pubkey.toLowerCase(),
    bodyBytes
  });
  if (!verification.ok) {
    console.warn('[Stripe Portal] NIP-98 rejected:', verification.reason);
    return json({ error: 'forbidden' }, { status: 403 });
  }

  // Constrain the post-portal redirect to this deployment's own origin.
  //
  // Derived from `request.url`, NOT from the client-supplied `Origin`
  // header: an attacker sets that header freely, so validating against
  // it authorizes whatever it claims. (create-session/+server.ts:62-72
  // validates its successUrl/cancelUrl against the header — same
  // endpoint family, same weakness, separate change.)
  //
  // Relative values are resolved against that origin, so the common
  // `window.location.href` and a bare `/settings` both pass.
  const requestOrigin = new URL(request.url).origin;
  let resolvedReturnUrl: string;
  try {
    const target = new URL(returnUrl, requestOrigin);
    if (target.origin !== requestOrigin) {
      return json({ error: 'returnUrl must match the request origin' }, { status: 400 });
    }
    resolvedReturnUrl = target.toString();
  } catch {
    return json({ error: 'Invalid returnUrl format' }, { status: 400 });
  }

  try {
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
      return_url: resolvedReturnUrl,
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
