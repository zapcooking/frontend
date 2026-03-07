/**
 * Strike Webhook Handler for Sponsor Payments
 *
 * POST /api/sponsor/strike-webhook
 *
 * Receives webhook notifications from Strike API when sponsor payments are confirmed.
 * Activates the sponsor after payment verification.
 *
 * Configure in Strike Dashboard > Webhooks with event types:
 *   - receive-request.receive-completed
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { handleWebhook, getReceiveRequestReceives } from '$lib/strikeService.server';
import { getSponsorByReceiveRequestId, activateSponsor } from '$lib/sponsorStore.server';

export const GET: RequestHandler = async () => {
  return json({
    status: 'ok',
    endpoint: '/api/sponsor/strike-webhook',
    description: 'Strike webhook endpoint for sponsor payments',
    method: 'POST',
    events: ['receive-request.receive-completed'],
  });
};

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const signature = request.headers.get('x-webhook-signature') || '';
    const rawBody = await request.text();
    const payload = JSON.parse(rawBody);

    console.log('[Sponsor Webhook] Received:', {
      eventType: payload.eventType,
      entityId: payload.data?.entityId,
    });

    // Verify webhook signature
    try {
      await handleWebhook(rawBody, signature, platform);
    } catch (verifyError) {
      console.error('[Sponsor Webhook] Signature verification failed:', verifyError);
      if (env.NODE_ENV === 'production') {
        return json({ error: 'Invalid webhook signature' }, { status: 401 });
      }
      console.warn('[Sponsor Webhook] Allowing unsigned webhook in development');
    }

    if (payload.eventType === 'receive-request.receive-completed') {
      const receiveRequestId = payload.data?.entityId;

      if (!receiveRequestId) {
        console.error('[Sponsor Webhook] No entityId in webhook payload');
        return json({ error: 'Missing entityId' }, { status: 400 });
      }

      const kv = platform?.env?.GATED_CONTENT ?? null;
      if (!kv && env.NODE_ENV === 'production') {
        console.error('[Sponsor Webhook] GATED_CONTENT KV binding is missing in production');
        return json({ error: 'Service unavailable' }, { status: 503 });
      }

      const sponsor = await getSponsorByReceiveRequestId(kv, receiveRequestId);

      if (!sponsor) {
        // Not a sponsor payment — might be a boost or membership payment handled elsewhere
        console.log('[Sponsor Webhook] No sponsor found for receiveRequestId:', receiveRequestId);
        return json({ received: true, message: 'No sponsor found — may be handled elsewhere' });
      }

      // Verify payment is actually completed
      const receives = await getReceiveRequestReceives(receiveRequestId, platform);
      const completedReceive = receives.find((r) => r.state === 'COMPLETED');

      if (!completedReceive) {
        console.log('[Sponsor Webhook] No completed receive found for:', receiveRequestId);
        return json({ received: true, message: 'No completed receive found' });
      }

      console.log('[Sponsor Webhook] Payment confirmed, activating sponsor:', {
        sponsorId: sponsor.id,
        title: sponsor.title,
        tier: sponsor.tier,
        durationKey: sponsor.durationKey,
      });

      try {
        await activateSponsor(kv, sponsor.id);
        console.log('[Sponsor Webhook] Sponsor activated successfully');
      } catch (activateError: any) {
        console.error('[Sponsor Webhook] Sponsor activation failed:', activateError.message);
        // Don't throw — webhook should return 200 to prevent Strike retries
      }

      return json({ received: true });
    }

    console.log('[Sponsor Webhook] Unhandled event type:', payload.eventType);
    return json({ received: true, message: 'Event type not handled' });
  } catch (error: any) {
    console.error('[Sponsor Webhook] Error processing webhook:', error);
    return json({ error: 'Webhook processing failed' }, { status: 500 });
  }
};
