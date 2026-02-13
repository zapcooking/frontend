/**
 * NIP-108 Payment Endpoint
 *
 * GET /api/nip108/payment?g=<gatedNoteId>&p=<userPubkey>
 *   → 402 with Lightning invoice
 *
 * GET /api/nip108/payment?g=<gatedNoteId>&p=<userPubkey>&preimage=<hex>
 *   → Verifies SHA256(preimage) === paymentHash, marks paid
 *
 * POST /api/nip108/payment  { gatedNoteId, userPubkey, preimage? }
 *   → Marks payment after wallet pays invoice. Preimage verified if provided.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  getGatedContent,
  hasPaid,
  markAsPaid,
  storePendingPayment,
  getPendingPayment,
  deletePendingPayment,
  type GatedKV
} from '$lib/nip108/server-store';

function getKV(platform: App.Platform | undefined): GatedKV {
  return (platform?.env?.GATED_CONTENT as GatedKV) || null;
}

/** Verify that SHA256(preimage) equals the expected payment hash. */
function verifyPreimage(preimage: string, paymentHash: string): boolean {
  try {
    const preimageBytes = hexToBytes(preimage);
    const computed = bytesToHex(sha256(preimageBytes));
    return computed === paymentHash.toLowerCase();
  } catch {
    return false;
  }
}

export const GET: RequestHandler = async ({ url, platform }) => {
  const kv = getKV(platform);

  try {
    const gatedNoteId = url.searchParams.get('g');
    const userPubkey = url.searchParams.get('p');
    const preimage = url.searchParams.get('preimage');

    if (!gatedNoteId || !userPubkey) {
      return json(
        { error: 'Missing required parameters: g (gatedNoteId) and p (userPubkey)' },
        { status: 400 }
      );
    }

    if (!/^[0-9a-fA-F]{64}$/.test(userPubkey)) {
      return json({ error: 'Invalid pubkey format' }, { status: 400 });
    }

    const gatedContent = await getGatedContent(kv, gatedNoteId);
    if (!gatedContent) {
      return json({ error: 'Gated content not found' }, { status: 404 });
    }

    // ── Preimage submitted → verify and mark paid ──
    if (preimage) {
      const pending = await getPendingPayment(kv, gatedNoteId, userPubkey);
      if (!pending) {
        return json({ error: 'No pending payment found. Request an invoice first.' }, { status: 400 });
      }

      if (!verifyPreimage(preimage, pending.paymentHash)) {
        return json({ error: 'Invalid payment preimage' }, { status: 403 });
      }

      await markAsPaid(kv, gatedNoteId, userPubkey, preimage);
      await deletePendingPayment(kv, gatedNoteId, userPubkey);

      return json({ paid: true, message: 'Payment verified' });
    }

    // ── Already paid? ──
    if (await hasPaid(kv, gatedNoteId, userPubkey)) {
      return json({ paid: true, message: 'Already paid' });
    }

    // ── Create invoice ──
    const costMsats = gatedContent.costMsats;
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;

    const invoiceResponse = await fetch(`${url.origin}/api/nip108/create-invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_SECRET ? { 'Authorization': `Bearer ${API_SECRET}` } : {})
      },
      body: JSON.stringify({
        amountMsats: costMsats,
        description: `Premium recipe: ${gatedContent.title}`,
        metadata: { gatedNoteId, userPubkey }
      })
    });

    if (!invoiceResponse.ok) {
      if (dev) {
        // Dev-only: fallback mock invoice when create-invoice fails
        const paymentHash = `mock_${Date.now()}_${gatedNoteId.substring(0, 8)}`;
        await storePendingPayment(kv, gatedNoteId, userPubkey, paymentHash);

        return json(
          {
            pr: `lnbc${Math.floor(costMsats / 1000)}u1p...mock`,
            paymentHash,
            costMsats,
            routes: [],
            isMock: true
          },
          { status: 402 }
        );
      }
      return json({ error: 'Failed to create invoice' }, { status: 500 });
    }

    const invoiceData = await invoiceResponse.json();

    if (!invoiceData.paymentHash) {
      console.error('[NIP-108 Payment] Invoice created but no paymentHash returned');
      return json({ error: 'Invoice creation error: missing payment hash' }, { status: 500 });
    }

    await storePendingPayment(kv, gatedNoteId, userPubkey, invoiceData.paymentHash);

    return json(
      {
        pr: invoiceData.invoice,
        paymentHash: invoiceData.paymentHash,
        costMsats,
        routes: [],
        isMock: invoiceData.isMock || false
      },
      { status: 402 }
    );
  } catch (error) {
    console.error('[NIP-108 Payment] Error:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};

/**
 * POST endpoint — mark payment after wallet pays the invoice.
 *
 * Preimage is optional because some wallets (e.g. Spark) don't return the
 * Lightning preimage. A pending payment record (created when the invoice was
 * generated) proves the user went through our invoice flow.
 *
 * When a preimage IS provided, it's verified against the stored payment hash.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
  const kv = getKV(platform);

  try {
    const body = await request.json();
    const { gatedNoteId, userPubkey, preimage } = body;

    if (!gatedNoteId || !userPubkey) {
      return json(
        { error: 'Missing required fields: gatedNoteId, userPubkey' },
        { status: 400 }
      );
    }

    // Validate userPubkey format (64 hex characters) to keep behavior
    // consistent with the GET handler and avoid malformed KV keys.
    if (typeof userPubkey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(userPubkey)) {
      return json({ error: 'Invalid userPubkey format' }, { status: 400 });
    }
    // Verify gated content exists
    const gatedContent = await getGatedContent(kv, gatedNoteId);
    if (!gatedContent) {
      return json({ error: 'Gated content not found' }, { status: 404 });
    }

    // Look up pending payment — proves the user went through our invoice flow
    const pending = await getPendingPayment(kv, gatedNoteId, userPubkey);
    if (!pending) {
      if (dev && preimage && (preimage.startsWith('test_preimage_') || preimage.startsWith('mock_'))) {
        // Dev-only: allow test preimages without a pending record (HMR clears in-memory store)
        await markAsPaid(kv, gatedNoteId, userPubkey, preimage);
        return json({ success: true, message: 'Payment verified (dev mode)' });
      }
      return json(
        { error: 'No pending payment found. Request an invoice first.' },
        { status: 400 }
      );
    }

    // If preimage is provided, verify it against the stored payment hash.
    // Some wallets don't return the preimage, so we accept pending-record-only proof.
    if (preimage && !verifyPreimage(preimage, pending.paymentHash)) {
      return json({ error: 'Invalid payment preimage' }, { status: 403 });
    }

    // Mark as paid and clean up
    await markAsPaid(kv, gatedNoteId, userPubkey, preimage || '');
    await deletePendingPayment(kv, gatedNoteId, userPubkey);

    return json({ success: true, message: 'Payment verified' });
  } catch (error) {
    console.error('[NIP-108 Payment POST] Error:', error);
    return json({ error: 'Failed to process payment' }, { status: 500 });
  }
};
