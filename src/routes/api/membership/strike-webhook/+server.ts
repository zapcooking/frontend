/**
 * Strike Webhook Handler for Membership Payments
 *
 * Receives webhook notifications from Strike API when payments are confirmed.
 * Activates membership after payment verification.
 *
 * POST /api/membership/strike-webhook
 *
 * Configure in Strike Dashboard > Webhooks with event types:
 *   - receive-request.receive-completed
 *
 * Strike webhooks contain only the entityId — full data is fetched via API.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { handleWebhook, getReceiveRequestReceives } from '$lib/strikeService.server';
import { registerMember } from '$lib/memberRegistration.server';
import { getInvoiceMetadata } from '$lib/invoiceMetadataStore.server';

/**
 * GET handler - Returns info about the webhook endpoint
 */
export const GET: RequestHandler = async () => {
  return json({
    status: 'ok',
    endpoint: '/api/membership/strike-webhook',
    description: 'Strike webhook endpoint for membership payments',
    method: 'POST',
    note: 'This endpoint receives POST requests from Strike API when payments are confirmed. Configure this URL in your Strike Dashboard webhook settings.',
    events: ['receive-request.receive-completed']
  });
};

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Get webhook signature from X-Webhook-Signature header
    const signature = request.headers.get('x-webhook-signature') || '';

    // Read raw body for signature verification
    const rawBody = await request.text();
    const payload = JSON.parse(rawBody);

    console.log('[Strike Webhook] Received:', {
      eventType: payload.eventType,
      entityId: payload.data?.entityId,
    });

    // Verify webhook signature
    try {
      await handleWebhook(rawBody, signature, platform);
    } catch (verifyError) {
      console.error('[Strike Webhook] Signature verification failed:', verifyError);
      if (env.NODE_ENV === 'production') {
        return json({ error: 'Invalid webhook signature' }, { status: 401 });
      }
      console.warn('[Strike Webhook] Allowing unsigned webhook in development');
    }

    // Handle receive-request events (incoming Lightning payments)
    if (payload.eventType === 'receive-request.receive-completed') {
      const receiveRequestId = payload.data?.entityId;

      if (!receiveRequestId) {
        console.error('[Strike Webhook] No entityId in webhook payload');
        return json({ error: 'Missing entityId' }, { status: 400 });
      }

      // Look up stored metadata for this receive request
      const metadata = await getInvoiceMetadata(receiveRequestId, platform);

      if (!metadata) {
        console.warn('[Strike Webhook] No metadata found for receiveRequestId:', receiveRequestId);
        // Payment may still be verified client-side via verify-lightning-payment
        return json({
          received: true,
          message: 'No metadata found — awaiting client-side verification',
        });
      }

      // Verify payment is actually completed by fetching receives
      const receives = await getReceiveRequestReceives(receiveRequestId, platform);
      const completedReceive = receives.find(r => r.state === 'COMPLETED');

      if (!completedReceive) {
        console.log('[Strike Webhook] No completed receive found for:', receiveRequestId);
        return json({ received: true, message: 'No completed receive found' });
      }

      console.log('[Strike Webhook] Payment confirmed, registering member:', {
        receiveRequestId,
        pubkey: metadata.pubkey.substring(0, 16) + '...',
        tier: metadata.tier,
        period: metadata.period,
      });

      // Get API secret for relay API
      const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
      if (!API_SECRET) {
        console.error('[Strike Webhook] RELAY_API_SECRET not configured');
        return json({ received: true, error: 'RELAY_API_SECRET not configured' }, { status: 500 });
      }

      // Register member using shared idempotent logic
      try {
        const result = await registerMember({
          pubkey: metadata.pubkey,
          tier: metadata.tier,
          period: metadata.period,
          paymentMethod: 'lightning_strike',
          apiSecret: API_SECRET,
        });

        if (result.alreadyExists) {
          console.log('[Strike Webhook] Member already registered (idempotent)');
        } else {
          console.log('[Strike Webhook] Member registered successfully:', {
            subscriptionEnd: result.subscriptionEnd,
            nip05: result.nip05,
          });
        }
      } catch (regError: any) {
        console.error('[Strike Webhook] Member registration failed:', regError.message);
        // Don't throw — webhook should return 200 to prevent Strike retries.
        // Client-side verify endpoint serves as fallback.
      }

      return json({ received: true });

    } else if (payload.eventType === 'receive-request.receive-pending') {
      console.log('[Strike Webhook] Receive pending for:', payload.data?.entityId);
      return json({ received: true, message: 'Receive pending — waiting for completion' });
    } else {
      console.log('[Strike Webhook] Unhandled event type:', payload.eventType);
      return json({ received: true, message: 'Event type not handled' });
    }
  } catch (error: any) {
    console.error('[Strike Webhook] Error processing webhook:', error);
    return json({ error: 'Webhook processing failed' }, { status: 500 });
  }
};
