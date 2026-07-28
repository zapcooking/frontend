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
 *  - invoice.paid                — extends membership on a recurring renewal
 *  - customer.subscription.updated — logs subscription changes
 *  - customer.subscription.deleted — logs cancellation
 *
 * `invoice.payment_succeeded` is intentionally NOT handled: Stripe fires it for
 * the same invoice as `invoice.paid`, so handling both would race two renewals
 * for one payment. `invoice.paid` must be enabled on the endpoint in the Stripe
 * Dashboard or renewals will silently do nothing.
 *
 * Configure in Stripe Dashboard > Webhooks with signing secret in STRIPE_WEBHOOK_SECRET.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { registerMember, renewMember } from '$lib/memberRegistration.server';
import { planRenewalFromInvoice } from '$lib/stripeRenewal';

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
      return json({ error: 'Payment service unavailable' }, { status: 500 });
    }

    // Get webhook signing secret
    const webhookSecret = platform?.env?.STRIPE_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
      return json({ error: 'Payment service unavailable' }, { status: 500 });
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
      apiVersion: '2025-12-15.clover',
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

      case 'invoice.paid': {
        await handleInvoicePaid(event.data.object, platform);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        console.log('[Stripe Webhook] Subscription updated:', {
          subscriptionId: subscription.id,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
        });
        // Renewal extension is driven by invoice.paid, not by this event —
        // subscription.updated fires for plan/price/status changes too, and
        // carries no signal that money actually moved.
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
    return json({ error: 'Webhook processing failed' }, { status: 500 });
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

  // Validate period (accept '2year' for backward compatibility with existing subscriptions)
  if (!period || !['annual', '2year', 'monthly'].includes(period)) {
    console.error('[Stripe Webhook] Invalid period in metadata:', period);
    return;
  }

  // Get API secret for relay API
  const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
  if (!API_SECRET) {
    console.error('[Stripe Webhook] RELAY_API_SECRET not configured');
    return;
  }

  // Normalize '2year' to 'annual' for backward compatibility with legacy subscriptions
  const normalizedPeriod: 'annual' | 'monthly' = period === '2year' ? 'annual' : period as 'annual' | 'monthly';

  try {
    const result = await registerMember({
      pubkey,
      tier: tier as 'cook' | 'pro',
      period: normalizedPeriod,
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

/**
 * Handle invoice.paid for a recurring subscription cycle.
 *
 * Extends the member's subscription_end by one billing period. This is the only
 * path that keeps a card member active past their first term — Stripe fires
 * checkout.session.completed on the initial checkout only.
 *
 * Unlike handleCheckoutCompleted, relay failures here are RETHROWN so the
 * endpoint returns 500 and Stripe redelivers. Registration has a client-side
 * fallback; renewal has none, so a swallowed error is a lost renewal and a
 * member locked out of access they paid for. Validation failures are still
 * logged-and-returned — a redelivery cannot fix missing metadata.
 */
async function handleInvoicePaid(invoice: any, platform: any) {
  const decision = planRenewalFromInvoice(invoice);

  if (decision.action === 'skip') {
    // 'no-pubkey' is the one skip that needs a person. It means a live card
    // subscription was created before subscription_data.metadata existed, so
    // nothing in this codebase can say whose membership to extend — it has to
    // be reconciled by hand against the Stripe customer. Everything else here
    // is an ordinary event we are correct to ignore.
    if (decision.reason === 'no-pubkey') {
      const subscriptionDetails = invoice?.parent?.subscription_details;
      console.error('[Stripe Webhook] Renewal invoice has no pubkey in subscription metadata — manual reconciliation required:', {
        invoiceId: invoice?.id,
        customer: invoice?.customer,
        subscription: typeof subscriptionDetails?.subscription === 'string'
          ? subscriptionDetails.subscription
          : subscriptionDetails?.subscription?.id,
      });
      return;
    }

    if (decision.reason === 'not-a-renewal-cycle') {
      console.log('[Stripe Webhook] Invoice paid, not a renewal cycle — skipping:', {
        invoiceId: invoice?.id,
        billingReason: decision.value,
      });
      return;
    }

    console.error(`[Stripe Webhook] Renewal invoice rejected (${decision.reason}):`, {
      invoiceId: invoice?.id,
      value: decision.value,
    });
    return;
  }

  console.log('[Stripe Webhook] Renewal invoice paid:', {
    invoiceId: invoice.id,
    tier: decision.tier,
    period: decision.period,
    subscriptionMonths: decision.subscriptionMonths,
  });

  const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
  if (!API_SECRET) {
    console.error('[Stripe Webhook] RELAY_API_SECRET not configured');
    return;
  }

  const result = await renewMember({
    pubkey: decision.pubkey,
    subscriptionMonths: decision.subscriptionMonths,
    paymentId: decision.paymentId,
    apiSecret: API_SECRET,
  });

  if (result.notFound) {
    console.error('[Stripe Webhook] Renewal for a pubkey with no membership record — nothing extended:', {
      invoiceId: invoice.id,
      pubkey: decision.pubkey.substring(0, 16) + '...',
    });
    return;
  }

  if (result.alreadyApplied) {
    console.log('[Stripe Webhook] Renewal already applied (repeat delivery):', {
      invoiceId: invoice.id,
      pubkey: decision.pubkey.substring(0, 16) + '...',
    });
    return;
  }

  console.log('[Stripe Webhook] Membership renewed:', {
    invoiceId: invoice.id,
    pubkey: decision.pubkey.substring(0, 16) + '...',
    subscriptionMonths: decision.subscriptionMonths,
    subscriptionEnd: result.subscriptionEnd,
  });
}
