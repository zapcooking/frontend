/**
 * Complete Membership Payment (Stripe)
 *
 * Verifies Stripe payment and registers member via shared registerMember().
 *
 * POST /api/membership/complete-payment
 *
 * Body:
 * {
 *   sessionId: string,
 *   pubkey: string
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { registerMember } from '$lib/memberRegistration.server';

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

    // Validate pubkey format
    if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
      return json(
        { error: 'Invalid pubkey format' },
        { status: 400 }
      );
    }

    // Get secrets
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (!API_SECRET) {
      console.error('[Membership Payment] RELAY_API_SECRET not configured');
      return json({ error: 'Payment service unavailable' }, { status: 500 });
    }

    const stripeKey = platform?.env?.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      console.error('[Membership Payment] STRIPE_SECRET_KEY not configured');
      return json({ error: 'Payment service unavailable' }, { status: 500 });
    }

    // Verify Stripe session
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-12-18.acacia',
      typescript: true,
    });

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return json({ error: 'Payment not completed' }, { status: 400 });
    }

    // Verify pubkey matches session metadata (prevents claiming another user's payment)
    if (session.metadata?.pubkey && session.metadata.pubkey !== pubkey) {
      return json({ error: 'Pubkey does not match payment session' }, { status: 403 });
    }

    // Extract tier and period from session metadata
    const tier = session.metadata?.tier;
    const period = session.metadata?.period;

    if (!tier || !['cook', 'pro'].includes(tier)) {
      return json({ error: 'Invalid tier in payment metadata' }, { status: 400 });
    }

    if (!period || !['annual', 'monthly'].includes(period)) {
      return json({ error: 'Invalid period in payment metadata' }, { status: 400 });
    }

    // Register member using shared logic
    const result = await registerMember({
      pubkey,
      tier: tier as 'cook' | 'pro',
      period: period as 'annual' | 'monthly',
      paymentMethod: 'stripe',
      apiSecret: API_SECRET,
    });

    return json({
      success: true,
      tier,
      subscriptionEnd: result.subscriptionEnd,
      message: `${tier === 'cook' ? 'Cook+' : 'Pro Kitchen'} membership activated`,
      nip05: result.nip05,
      nip05Username: result.nip05Username,
    });

  } catch (error: any) {
    console.error('[Membership Payment] Error completing payment:', error.message);

    return json(
      { error: 'Failed to complete payment', success: false },
      { status: 500 }
    );
  }
};
