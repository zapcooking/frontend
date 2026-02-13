/**
 * Verify Lightning Payment for Membership
 *
 * Verifies that a Lightning payment was completed via Strike API
 * and registers the member using shared idempotent logic.
 *
 * POST /api/membership/verify-lightning-payment
 *
 * Body:
 * {
 *   receiveRequestId: string,  // Strike receive request ID
 *   paymentHash: string,       // Payment hash (fallback lookup)
 *   pubkey: string,
 *   tier: 'cook' | 'pro',
 *   period: 'annual' | 'monthly',
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getReceiveRequestReceives } from '$lib/strikeService.server';
import { registerMember } from '$lib/memberRegistration.server';
import { getInvoiceMetadata, getInvoiceMetadataByPaymentHash } from '$lib/invoiceMetadataStore.server';

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { receiveRequestId, paymentHash, pubkey, tier, period } = body;

    if (!pubkey || !tier || !period) {
      return json(
        { error: 'pubkey, tier, and period are required' },
        { status: 400 }
      );
    }

    if (!receiveRequestId && !paymentHash) {
      return json(
        { error: 'receiveRequestId or paymentHash is required' },
        { status: 400 }
      );
    }

    if (!['cook', 'pro'].includes(tier)) {
      return json(
        { error: 'Invalid tier. Must be "cook" or "pro"' },
        { status: 400 }
      );
    }

    if (!['annual', 'monthly'].includes(period)) {
      return json(
        { error: 'Invalid period. Must be "annual" or "monthly"' },
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

    // Look up stored metadata to verify the request matches what was created
    const metadata = receiveRequestId
      ? getInvoiceMetadata(receiveRequestId)
      : getInvoiceMetadataByPaymentHash(paymentHash);

    if (!metadata) {
      return json(
        { error: 'Invoice not found or expired. Please create a new invoice.' },
        { status: 404 }
      );
    }

    // Verify pubkey matches the one that created the invoice
    if (metadata.pubkey !== pubkey) {
      return json(
        { error: 'Pubkey does not match the invoice creator' },
        { status: 403 }
      );
    }

    // Validate that metadata has required tier and period fields
    // This is a data integrity check - metadata should always have these fields
    if (!metadata.tier || !metadata.period) {
      console.error('[Verify Lightning] Invalid metadata - missing tier or period:', {
        receiveRequestId: metadata.receiveRequestId,
        hasTier: !!metadata.tier,
        hasPeriod: !!metadata.period,
      });
      return json(
        { error: 'Invoice metadata is invalid. Please create a new invoice.' },
        { status: 500 }
      );
    }

    // Validate metadata tier and period values (data integrity check)
    if (!['cook', 'pro'].includes(metadata.tier)) {
      console.error('[Verify Lightning] Invalid metadata tier:', {
        receiveRequestId: metadata.receiveRequestId,
        tier: metadata.tier,
      });
      return json(
        { error: 'Invoice metadata is invalid. Please create a new invoice.' },
        { status: 500 }
      );
    }

    if (!['annual', 'monthly'].includes(metadata.period)) {
      console.error('[Verify Lightning] Invalid metadata period:', {
        receiveRequestId: metadata.receiveRequestId,
        period: metadata.period,
      });
      return json(
        { error: 'Invoice metadata is invalid. Please create a new invoice.' },
        { status: 500 }
      );
    }

    // Verify payment completion via Strike API
    const lookupId = metadata.receiveRequestId;
    const receives = await getReceiveRequestReceives(lookupId, platform);
    const completedReceive = receives.find(r => r.state === 'COMPLETED');

    if (!completedReceive) {
      return json(
        { error: 'Payment not yet completed', paid: false },
        { status: 402 }
      );
    }

    console.log('[Verify Lightning] Payment confirmed via Strike API:', {
      receiveRequestId: lookupId,
      pubkey: pubkey.substring(0, 16) + '...',
      tier,
      period,
    });

    // Get API secret for relay API
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (!API_SECRET) {
      return json(
        { error: 'RELAY_API_SECRET not configured' },
        { status: 500 }
      );
    }

    // Register member using authoritative tier/period from invoice metadata
    // SECURITY: Only use metadata values, never client-supplied tier/period
    const result = await registerMember({
      pubkey,
      tier: metadata.tier,
      period: metadata.period,
      paymentMethod: 'lightning_strike',
      apiSecret: API_SECRET,
    });

    return json({
      success: true,
      subscriptionEnd: result.subscriptionEnd,
      message: `${tier === 'cook' ? 'Cook+' : 'Pro Kitchen'} membership activated via Lightning`,
      nip05: result.nip05,
      nip05Username: result.nip05Username,
      alreadyExists: result.alreadyExists,
    });

  } catch (error: any) {
    console.error('[Verify Lightning] Error:', error);

    return json(
      {
        error: error.message || 'Failed to verify payment',
        success: false
      },
      { status: 500 }
    );
  }
};
