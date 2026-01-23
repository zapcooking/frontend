/**
 * Strike Webhook Handler for Membership Payments
 * 
 * Receives webhook notifications from Strike API when payments are confirmed.
 * Activates membership after payment verification.
 * 
 * POST /api/membership/strike-webhook
 * 
 * This endpoint should be configured in Strike API webhook settings.
 * Strike will call this endpoint when invoice state changes (e.g., PAID).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { handleWebhook, checkInvoiceStatus } from '$lib/strikeService.server';

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Get webhook signature from headers
    const signature = request.headers.get('x-strike-signature') || request.headers.get('strike-signature') || '';
    
    // Read raw body for signature verification
    const rawBody = await request.text();
    const payload = JSON.parse(rawBody);
    
    console.log('[Membership Strike Webhook] Received webhook:', {
      eventType: payload.eventType,
      entityId: payload.entityId,
      timestamp: payload.timestamp,
    });
    
    // Verify webhook signature
    try {
      await handleWebhook(rawBody, signature, platform);
      console.log('[Membership Strike Webhook] Signature verified');
    } catch (verifyError) {
      console.error('[Membership Strike Webhook] Signature verification failed:', verifyError);
      // In development, you might want to allow unsigned webhooks
      // In production, always verify signatures
      if (env.NODE_ENV === 'production') {
        return json({ error: 'Invalid webhook signature' }, { status: 401 });
      }
      console.warn('[Membership Strike Webhook] Allowing unsigned webhook in development');
    }
    
    // Handle different webhook event types
    if (payload.eventType === 'invoice.state.changed' || payload.eventType === 'invoice.paid') {
      const invoiceId = payload.entityId;
      
      if (!invoiceId) {
        console.error('[Membership Strike Webhook] No invoice ID in webhook payload');
        return json({ error: 'Missing invoice ID' }, { status: 400 });
      }
      
      // Check invoice status to confirm it's paid
      console.log('[Membership Strike Webhook] Checking invoice status:', invoiceId);
      const invoice = await checkInvoiceStatus(invoiceId, platform);
      
      if (invoice.state !== 'PAID') {
        console.log('[Membership Strike Webhook] Invoice not paid yet, state:', invoice.state);
        return json({ received: true, message: 'Invoice not paid' });
      }
      
      console.log('[Membership Strike Webhook] Invoice is paid, processing membership activation...');
      
      // Extract membership details from invoice description
      // Format: "ZapCooking {Tier} {Period} Membership - {pubkey}"
      const description = invoice.description || '';
      const match = description.match(/ZapCooking\s+(Cook\+|Pro Kitchen)\s+(\d+yr)\s+Membership\s+-\s+([0-9a-fA-F]{64})/);
      
      if (!match) {
        console.error('[Membership Strike Webhook] Could not parse membership details from description:', description);
        return json({ 
          received: true, 
          error: 'Could not extract membership details from invoice',
          invoiceId 
        }, { status: 400 });
      }
      
      const [, tierName, periodLabel, pubkey] = match;
      const tier = tierName === 'Cook+' ? 'cook' : 'pro';
      const period = periodLabel === '1yr' ? 'annual' : '2year';
      
      // Validate pubkey format
      if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
        console.error('[Membership Strike Webhook] Invalid pubkey format:', pubkey);
        return json({ 
          received: true, 
          error: 'Invalid pubkey format in invoice description',
          invoiceId 
        }, { status: 400 });
      }
      
      console.log('[Membership Strike Webhook] Extracted membership details:', {
        tier,
        period,
        pubkey: pubkey.substring(0, 16) + '...',
        invoiceId,
      });
      
      // Get API secret for relay API
      const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
      if (!API_SECRET) {
        console.error('[Membership Strike Webhook] RELAY_API_SECRET not configured');
        return json({ 
          received: true, 
          error: 'RELAY_API_SECRET not configured',
          invoiceId 
        }, { status: 500 });
      }
      
      // Calculate subscription end date
      const now = new Date();
      const subscriptionMonths = period === 'annual' ? 12 : 24;
      const subscriptionEnd = new Date(now);
      subscriptionEnd.setMonth(now.getMonth() + subscriptionMonths);
      
      // Generate payment_id
      const paymentId = `${tier}_strike_${Date.now()}`;
      
      console.log('[Membership Strike Webhook] Adding member to relay API...', {
        pubkey: pubkey.substring(0, 16) + '...',
        tier,
        period,
        subscriptionEnd: subscriptionEnd.toISOString()
      });
      
      // Add member to relay API
      const addMemberRes = await fetch('https://pantry.zap.cooking/api/members', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_SECRET}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          pubkey: pubkey,
          subscription_months: subscriptionMonths,
          payment_id: paymentId,
          tier: 'standard', // Use 'standard' tier like existing members
          subscription_end: subscriptionEnd.toISOString(),
          payment_method: 'lightning_strike'
        })
      });
      
      if (!addMemberRes.ok) {
        const responseText = await addMemberRes.text();
        let errorData;
        try {
          errorData = JSON.parse(responseText);
        } catch (e) {
          errorData = { error: responseText };
        }
        console.error('[Membership Strike Webhook] Add member API returned error:', {
          status: addMemberRes.status,
          error: errorData
        });
        throw new Error(errorData.error || `Failed to add member: ${addMemberRes.status}`);
      }
      
      // Auto-claim NIP-05 for the new member
      let nip05: string | null = null;
      let nip05Username: string | null = null;
      
      try {
        // Generate username from pubkey (first 8 chars)
        const suggestedUsername = pubkey.substring(0, 8).toLowerCase();
        
        console.log('[Membership Strike Webhook] Auto-claiming NIP-05:', suggestedUsername);
        
        const nip05Res = await fetch('https://pantry.zap.cooking/api/nip05/claim', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_SECRET}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username: suggestedUsername,
            pubkey,
            tier: tier as 'cook' | 'pro'
          })
        });
        
        if (nip05Res.ok) {
          nip05Username = suggestedUsername;
          nip05 = `${suggestedUsername}@zap.cooking`;
          console.log('[Membership Strike Webhook] NIP-05 claimed:', nip05);
        } else {
          // If default username fails, try with timestamp suffix
          const fallbackUsername = `${pubkey.substring(0, 6)}${Date.now().toString(36).slice(-2)}`.toLowerCase();
          
          const fallbackRes = await fetch('https://pantry.zap.cooking/api/nip05/claim', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${API_SECRET}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              username: fallbackUsername,
              pubkey,
              tier: tier as 'cook' | 'pro'
            })
          });
          
          if (fallbackRes.ok) {
            nip05Username = fallbackUsername;
            nip05 = `${fallbackUsername}@zap.cooking`;
            console.log('[Membership Strike Webhook] NIP-05 claimed (fallback):', nip05);
          } else {
            console.warn('[Membership Strike Webhook] Could not auto-claim NIP-05');
          }
        }
      } catch (nip05Error) {
        // NIP-05 claim is optional - don't fail the payment verification
        console.warn('[Membership Strike Webhook] NIP-05 auto-claim error:', nip05Error);
      }
      
      console.log('[Membership Strike Webhook] Membership activated successfully');
      
      return json({
        received: true,
        success: true,
        message: `${tier === 'cook' ? 'Cook+' : 'Pro Kitchen'} membership activated via Strike`,
        invoiceId,
        pubkey: pubkey.substring(0, 16) + '...',
        tier,
        period,
        subscriptionEnd: subscriptionEnd.toISOString(),
        nip05,
        nip05Username
      });
      
    } else {
      console.log('[Membership Strike Webhook] Unhandled event type:', payload.eventType);
      return json({ received: true, message: 'Event type not handled' });
    }
    
  } catch (error: any) {
    console.error('[Membership Strike Webhook] Error processing webhook:', error);
    
    return json(
      { 
        error: error.message || 'Failed to process webhook',
      },
      { status: 500 }
    );
  }
};
