/**
 * Stripe Webhook Handler
 *
 * Receives webhook events from Stripe for reliable server-side payment processing.
 * Handles checkout completion, subscription updates, and cancellations.
 *
 * POST /api/stripe/webhook
 *
 * Events handled:
 *  - checkout.session.completed  — registers member after successful payment
 *  - customer.subscription.updated — logs subscription changes
 *  - customer.subscription.deleted — logs cancellation
 *
 * Configure in Stripe Dashboard > Webhooks with signing secret in STRIPE_WEBHOOK_SECRET.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { registerMember } from '$lib/memberRegistration.server';

/**
 * GET handler — endpoint health check
 */
export const GET: RequestHandler = async () => {
  return json({
    status: 'ok',
    endpoint: '/api/stripe/webhook',
    description: 'Stripe webhook endpoint for membership payments',
    method: 'POST',
    events: [
      'checkout.session.completed',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ],
  });
};

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Get Stripe secret key
    const stripeKey = platform?.env?.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      console.error('[Stripe Webhook] STRIPE_SECRET_KEY not configured');
      return json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 500 });
    }

    // Get webhook signing secret
    const webhookSecret = platform?.env?.STRIPE_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
      return json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, { status: 500 });
    }

    // Read raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      console.error('[Stripe Webhook] Missing stripe-signature header');
      return json({ error: 'Missing stripe-signature header' }, { status: 400 });
    }

    // Dynamic import to avoid Cloudflare Workers build issues
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-12-18.acacia',
      typescript: true,
    });

    // Verify webhook signature
    let event: any;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: any) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return json({ error: 'Invalid signature' }, { status: 401 });
    }

    console.log('[Stripe Webhook] Received event:', {
      type: event.type,
      id: event.id,
    });

    // Handle events
    switch (event.type) {
      case 'checkout.session.completed': {
        await handleCheckoutCompleted(event.data.object, platform);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        console.log('[Stripe Webhook] Subscription updated:', {
          subscriptionId: subscription.id,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
        });
        // Future: extend subscription on renewal
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        console.log('[Stripe Webhook] Subscription deleted:', {
          subscriptionId: subscription.id,
          status: subscription.status,
        });
        // Membership expires naturally via subscription_end date
        break;
      }

      default: {
        console.log('[Stripe Webhook] Unhandled event type:', event.type);
      }
    }

    return json({ received: true });
  } catch (error: any) {
    console.error('[Stripe Webhook] Error processing webhook:', error);
    return json({ error: error.message || 'Webhook processing failed' }, { status: 500 });
  }
};

/**
 * Handle checkout.session.completed event.
 *
 * Extracts pubkey/tier/period from session metadata and registers the member.
 * Skips genesis sessions (complex founder-number logic handled client-side).
 */
async function handleCheckoutCompleted(session: any, platform: any) {
  const metadata = session.metadata || {};
  const { pubkey, tier, period } = metadata;

  console.log('[Stripe Webhook] Checkout completed:', {
    sessionId: session.id,
    paymentStatus: session.payment_status,
    tier,
    period,
    hasPubkey: !!pubkey,
  });

  // Skip if payment not actually paid
  if (session.payment_status !== 'paid') {
    console.log('[Stripe Webhook] Payment not paid, skipping. Status:', session.payment_status);
    return;
  }

  // Skip genesis sessions — handled by client-side genesis/complete-payment
  if (tier === 'genesis_founder') {
    console.log('[Stripe Webhook] Genesis session — skipping webhook registration (handled client-side)');
    return;
  }

  // Sessions without pubkey (created before this change) can't be auto-registered
  if (!pubkey) {
    console.warn('[Stripe Webhook] No pubkey in session metadata — skipping. Client-side flow will handle registration.');
    return;
  }

  // Validate pubkey format
  if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
    console.error('[Stripe Webhook] Invalid pubkey format in metadata:', pubkey);
    return;
  }

  // Validate tier
  if (!tier || !['cook', 'pro'].includes(tier)) {
    console.error('[Stripe Webhook] Invalid tier in metadata:', tier);
    return;
  }

  // Validate period
  if (!period || !['annual', '2year'].includes(period)) {
    console.error('[Stripe Webhook] Invalid period in metadata:', period);
    return;
  }

  // Get API secret for relay API
  const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
  if (!API_SECRET) {
    console.error('[Stripe Webhook] RELAY_API_SECRET not configured');
    return;
  }

  try {
    const result = await registerMember({
      pubkey,
      tier: tier as 'cook' | 'pro',
      period: period as 'annual' | '2year',
      paymentMethod: 'stripe',
      apiSecret: API_SECRET,
    });

    if (result.alreadyExists) {
      console.log('[Stripe Webhook] Member already registered (idempotent):', pubkey.substring(0, 16) + '...');
    } else {
      console.log('[Stripe Webhook] Member registered successfully:', {
        pubkey: pubkey.substring(0, 16) + '...',
        tier,
        period,
        subscriptionEnd: result.subscriptionEnd,
        nip05: result.nip05,
      });
    }
  } catch (regError: any) {
    console.error('[Stripe Webhook] Member registration failed:', regError.message);
    // Don't throw — webhook should still return 200 to prevent Stripe retries
    // The client-side complete-payment flow serves as a fallback
  }
}
