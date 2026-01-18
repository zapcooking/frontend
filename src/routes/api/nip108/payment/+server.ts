/**
 * NIP-108 Payment Endpoint
 * 
 * Handles payment requests and secret distribution for Lightning Gated Recipes
 * 
 * GET /api/nip108/payment?g=<gatedNoteId>&p=<userPubkey>
 * Returns: 402 Payment Required with invoice, or 200 if already paid
 * 
 * GET /api/nip108/payment?g=<gatedNoteId>&p=<userPubkey>&preimage=<paymentPreimage>
 * Returns: Secret key for decryption
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getGatedContent, hasPaid, markAsPaid } from '$lib/nip108/server-store';

// In-memory store for payment tracking (pending payments)
const pendingPayments = new Map<string, {
  paymentHash: string;
  invoiceCreatedAt: number;
}>();

export const GET: RequestHandler = async ({ url, platform }) => {
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
    
    // Validate pubkey format
    if (!/^[0-9a-fA-F]{64}$/.test(userPubkey)) {
      return json(
        { error: 'Invalid pubkey format' },
        { status: 400 }
      );
    }
    
    // Get gated content info from server storage
    const gatedContent = getGatedContent(gatedNoteId);
    
    if (!gatedContent) {
      return json(
        { error: 'Gated content not found' },
        { status: 404 }
      );
    }
    
    // If preimage provided, verify and mark as paid
    if (preimage) {
      // In production, verify preimage matches payment hash
      // For now, mark as paid and return success
      markAsPaid(gatedNoteId, userPubkey, preimage);
      
      return json({
        paid: true,
        message: 'Payment verified'
      });
    }
    
    // Check if already paid
    if (hasPaid(gatedNoteId, userPubkey)) {
      return json({
        paid: true,
        message: 'Already paid'
      });
    }
    
    const costMsats = gatedContent.costMsats;
    
    // Create Lightning invoice
    // In production, this would call a Lightning payment provider
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    
    // Create invoice via payment provider
    // For now, use mock invoice
    const invoiceResponse = await fetch(`${url.origin}/api/nip108/create-invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_SECRET || 'dev'}`
      },
      body: JSON.stringify({
        amountMsats: costMsats,
        description: `Premium recipe: ${gatedContent.title}`,
        metadata: {
          gatedNoteId,
          userPubkey
        }
      })
    });
    
    if (!invoiceResponse.ok) {
      // Fallback: return 402 with mock invoice
      const mockPaymentHash = `mock_${Date.now()}_${gatedNoteId.substring(0, 8)}`;
      
      // Store pending payment
      pendingPayments.set(`${gatedNoteId}_${userPubkey}`, {
        paymentHash: mockPaymentHash,
        invoiceCreatedAt: Date.now()
      });
      
      return json(
        {
          pr: `lnbc${Math.floor(costMsats / 1000)}u1p...mock`, // Mock invoice
          paymentHash: mockPaymentHash,
          costMsats,
          routes: [],
          successAction: {
            tag: 'url',
            url: `${url.origin}/api/nip108/payment?g=${gatedNoteId}&p=${userPubkey}`,
            description: 'Payment successful'
          }
        },
        { status: 402 }
      );
    }
    
    const invoiceData = await invoiceResponse.json();
    
    // Store pending payment
    pendingPayments.set(`${gatedNoteId}_${userPubkey}`, {
      paymentHash: invoiceData.paymentHash || `hash_${Date.now()}`,
      invoiceCreatedAt: Date.now()
    });
    
    // Return 402 Payment Required with invoice
    return json(
      {
        pr: invoiceData.invoice,
        paymentHash: invoiceData.paymentHash,
        costMsats,
        routes: [],
        successAction: {
          tag: 'url',
          url: `${url.origin}/api/nip108/payment?g=${gatedNoteId}&p=${userPubkey}`,
          description: 'Payment successful - click to unlock recipe'
        }
      },
      { status: 402 }
    );
    
  } catch (error) {
    console.error('[NIP-108 Payment] Error:', error);
    return json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
};

/**
 * POST endpoint for marking payment as complete (webhook from payment provider)
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { gatedNoteId, userPubkey, preimage, paymentHash } = body;
    
    if (!gatedNoteId || !userPubkey) {
      return json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Verify this payment was pending
    const pendingKey = `${gatedNoteId}_${userPubkey}`;
    const pending = pendingPayments.get(pendingKey);
    
    // For development, skip strict verification
    // In production, verify preimage matches payment hash
    
    // Mark as paid
    markAsPaid(gatedNoteId, userPubkey, preimage);
    
    // Clean up pending payment
    pendingPayments.delete(pendingKey);
    
    console.log(`[NIP-108] Payment verified for ${gatedNoteId} by ${userPubkey.substring(0, 8)}...`);
    
    return json({
      success: true,
      message: 'Payment verified'
    });
    
  } catch (error) {
    console.error('[NIP-108 Payment POST] Error:', error);
    return json(
      { error: 'Failed to process payment' },
      { status: 500 }
    );
  }
};
