/**
 * Verify Lightning Payment for Genesis Founder
 *
 * Verifies that a Lightning payment was completed via Strike API
 * and registers the Genesis Founder membership.
 *
 * POST /api/genesis/verify-lightning-payment
 *
 * Body:
 * {
 *   receiveRequestId: string,  // Strike receive request ID
 *   paymentHash: string,       // Payment hash (fallback lookup)
 *   pubkey: string,
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getReceiveRequestReceives } from '$lib/strikeService.server';
// autoClaimNip05 not used — NIP-05 claiming is handled by the confirmation page
import { getInvoiceMetadata, getInvoiceMetadataByPaymentHash } from '$lib/invoiceMetadataStore.server';

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { receiveRequestId, paymentHash, pubkey } = body;

    if (!pubkey) {
      return json({ error: 'pubkey is required' }, { status: 400 });
    }

    if (!receiveRequestId && !paymentHash) {
      return json(
        { error: 'receiveRequestId or paymentHash is required' },
        { status: 400 }
      );
    }

    // Validate pubkey format
    if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
      return json({ error: 'Invalid pubkey format' }, { status: 400 });
    }

    // Look up stored metadata to verify the request
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

    // Verify payment completion via Strike API
    const lookupId = metadata.receiveRequestId;
    const receives = await getReceiveRequestReceives(lookupId, platform);
    const completedReceive = receives.find(r => r.state === 'COMPLETED');

    if (!completedReceive) {
      return json(
        { error: 'Payment not yet completed', verified: false },
        { status: 402 }
      );
    }

    console.log('[Genesis Lightning] Payment confirmed via Strike API:', {
      receiveRequestId: lookupId,
      pubkey: pubkey.substring(0, 16) + '...',
    });

    // Get API secret for members API
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (!API_SECRET) {
      return json({ error: 'RELAY_API_SECRET not configured' }, { status: 500 });
    }

    // Get current founders count
    const membersRes = await fetch('https://pantry.zap.cooking/api/members', {
      headers: { 'Authorization': `Bearer ${API_SECRET}` }
    });

    if (!membersRes.ok) {
      throw new Error(`Failed to fetch members: ${membersRes.status}`);
    }

    const membersData = await membersRes.json();

    // Check if this pubkey is already an active founder (idempotency)
    const existingFounder = membersData.members.find((m: any) => {
      if (m.status === 'cancelled') return false;
      const pid = m.payment_id?.toLowerCase() || '';
      return m.pubkey === pubkey && (pid.startsWith('genesis_') || pid.startsWith('founder'));
    });

    if (existingFounder) {
      const match = existingFounder.payment_id?.match(/(\d+)$/);
      const existingNumber = match ? parseInt(match[1], 10) : null;
      return json({
        verified: true,
        founderNumber: existingNumber,
        message: 'Genesis Founder membership already active',
        nip05: null,
        nip05Username: null
      });
    }

    // Count active Genesis Founders and assign next number (exclude cancelled)
    const founders = membersData.members.filter((m: any) => {
      if (m.status === 'cancelled') return false;
      const pid = m.payment_id?.toLowerCase() || '';
      return pid.startsWith('genesis_') || pid.startsWith('founder');
    });

    let maxFounderNumber = 0;
    founders.forEach((m: any) => {
      const pid = m.payment_id?.toLowerCase() || '';
      const match = pid.match(/(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxFounderNumber) maxFounderNumber = num;
      } else if (pid === 'founder') {
        maxFounderNumber = Math.max(maxFounderNumber, 1);
      }
    });

    const founderNumber = maxFounderNumber + 1;

    if (founderNumber > 21) {
      return json({ error: 'All Genesis Founder spots are taken' }, { status: 400 });
    }

    // Add member to relay API
    const addMemberRes = await fetch('https://pantry.zap.cooking/api/members', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pubkey,
        subscription_months: 0,
        payment_id: `genesis_${founderNumber}`,
        tier: 'standard',
        subscription_end: '2099-12-31T23:59:59Z',
        payment_method: 'lightning_strike'
      })
    });

    if (!addMemberRes.ok) {
      const responseText = await addMemberRes.text().catch(() => '');
      let errorData: any = {};
      try { errorData = JSON.parse(responseText); } catch {}
      if (addMemberRes.status === 409 || errorData.error?.includes('already exists')) {
        // Member already exists — continue
      } else {
        throw new Error(errorData.error || `Failed to add member: ${addMemberRes.status}`);
      }
    }

    // Don't auto-claim NIP-05 here — let the confirmation page
    // show the username chooser so the user can pick their own name or skip
    return json({
      verified: true,
      founderNumber,
      message: 'Genesis Founder membership activated via Lightning',
      nip05: null,
      nip05Username: null
    });

  } catch (error: any) {
    console.error('[Genesis Lightning] Error:', error);

    return json(
      {
        error: error.message || 'Failed to verify payment',
        verified: false
      },
      { status: 500 }
    );
  }
};
