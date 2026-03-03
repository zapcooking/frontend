/**
 * Strike Webhook Handler for Boost Payments
 *
 * POST /api/boost/strike-webhook
 *
 * Receives webhook notifications from Strike API when boost payments are confirmed.
 * Activates the boost after payment verification.
 *
 * Configure in Strike Dashboard > Webhooks with event types:
 *   - receive-request.receive-completed
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { handleWebhook, getReceiveRequestReceives } from '$lib/strikeService.server';
import { getBoostByReceiveRequestId, activateBoost } from '$lib/boostStore.server';

export const GET: RequestHandler = async () => {
  return json({
    status: 'ok',
    endpoint: '/api/boost/strike-webhook',
    description: 'Strike webhook endpoint for boost payments',
    method: 'POST',
    events: ['receive-request.receive-completed'],
  });
};

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const signature = request.headers.get('x-webhook-signature') || '';
    const rawBody = await request.text();
    const payload = JSON.parse(rawBody);

    console.log('[Boost Webhook] Received:', {
      eventType: payload.eventType,
      entityId: payload.data?.entityId,
    });

    // Verify webhook signature
    try {
      await handleWebhook(rawBody, signature, platform);
    } catch (verifyError) {
      console.error('[Boost Webhook] Signature verification failed:', verifyError);
      if (env.NODE_ENV === 'production') {
        return json({ error: 'Invalid webhook signature' }, { status: 401 });
      }
      console.warn('[Boost Webhook] Allowing unsigned webhook in development');
    }

    if (payload.eventType === 'receive-request.receive-completed') {
      const receiveRequestId = payload.data?.entityId;

      if (!receiveRequestId) {
        console.error('[Boost Webhook] No entityId in webhook payload');
        return json({ error: 'Missing entityId' }, { status: 400 });
      }

      const kv = platform?.env?.GATED_CONTENT ?? null;
      if (!kv && env.NODE_ENV === 'production') {
        console.error('[Boost Webhook] GATED_CONTENT KV binding is missing in production');
        return json({ error: 'Service unavailable' }, { status: 503 });
      }

      const boost = await getBoostByReceiveRequestId(kv, receiveRequestId);

      if (!boost) {
        // Not a boost payment — might be a membership payment handled by the other webhook
        console.log('[Boost Webhook] No boost found for receiveRequestId:', receiveRequestId);
        return json({ received: true, message: 'No boost found — may be handled elsewhere' });
      }

      // Verify payment is actually completed
      const receives = await getReceiveRequestReceives(receiveRequestId, platform);
      const completedReceive = receives.find((r) => r.state === 'COMPLETED');

      if (!completedReceive) {
        console.log('[Boost Webhook] No completed receive found for:', receiveRequestId);
        return json({ received: true, message: 'No completed receive found' });
      }

      console.log('[Boost Webhook] Payment confirmed, activating boost:', {
        boostId: boost.id,
        recipeTitle: boost.recipeTitle,
        durationKey: boost.durationKey,
      });

      try {
        await activateBoost(kv, boost.id);
        console.log('[Boost Webhook] Boost activated successfully');
      } catch (activateError: any) {
        console.error('[Boost Webhook] Boost activation failed:', activateError.message);
        // Don't throw — webhook should return 200 to prevent Strike retries
      }

      return json({ received: true });
    }

    console.log('[Boost Webhook] Unhandled event type:', payload.eventType);
    return json({ received: true, message: 'Event type not handled' });
  } catch (error: any) {
    console.error('[Boost Webhook] Error processing webhook:', error);
    return json({ error: 'Webhook processing failed' }, { status: 500 });
  }
};
