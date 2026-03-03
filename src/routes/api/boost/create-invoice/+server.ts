/**
 * Create Lightning Invoice for Recipe Boost
 *
 * POST /api/boost/create-invoice
 *
 * Body:
 * {
 *   naddr: string,        // naddr1... encoded recipe address
 *   recipeTitle: string,
 *   recipeImage: string,
 *   authorPubkey: string,  // hex pubkey of recipe author
 *   buyerPubkey: string,   // hex pubkey of buyer
 *   durationKey: '24h' | '7d' | '30d',
 * }
 *
 * Returns:
 * {
 *   boostId: string,
 *   invoice: string,
 *   paymentHash: string,
 *   receiveRequestId: string,
 *   expiresAt: number,
 *   amountSats: number,
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createInvoice as createStrikeInvoice } from '$lib/strikeService.server';
import {
  storeBoost,
  BOOST_PRICING,
  type BoostDurationKey,
  type BoostRecord,
} from '$lib/boostStore.server';

const HEX64_RE = /^[0-9a-fA-F]{64}$/;

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const body = await request.json();
    const { naddr, recipeTitle, recipeImage, authorPubkey, buyerPubkey, durationKey } = body;

    // ── Validation ──────────────────────────────────────────────
    if (!naddr || typeof naddr !== 'string' || !naddr.startsWith('naddr1')) {
      return json({ error: 'A valid naddr is required' }, { status: 400 });
    }

    if (!recipeTitle || typeof recipeTitle !== 'string') {
      return json({ error: 'recipeTitle is required' }, { status: 400 });
    }

    if (!authorPubkey || !HEX64_RE.test(authorPubkey)) {
      return json({ error: 'Invalid authorPubkey format' }, { status: 400 });
    }

    if (!buyerPubkey || !HEX64_RE.test(buyerPubkey)) {
      return json({ error: 'Invalid buyerPubkey format' }, { status: 400 });
    }

    if (!durationKey || !BOOST_PRICING[durationKey as BoostDurationKey]) {
      return json(
        { error: 'Invalid durationKey. Must be "24h", "7d", or "30d"' },
        { status: 400 },
      );
    }

    const pricing = BOOST_PRICING[durationKey as BoostDurationKey];
    const amountSats = pricing.sats;

    // Convert sats → BTC string for Strike API
    const btcAmount = (amountSats / 100_000_000).toFixed(8);
    const description = `zap.cooking Boost: "${recipeTitle}" (${pricing.label})`;

    // ── Create invoice via Strike API ───────────────────────────
    console.log('[Boost] Creating invoice via Strike API...', { amountSats, durationKey });
    const strikeResponse = await createStrikeInvoice(btcAmount, 'BTC', description, platform);

    const bolt11Data = (strikeResponse as any).bolt11;
    const invoice = bolt11Data?.invoice || strikeResponse.invoice;

    if (!invoice) {
      throw new Error('Strike API did not return a BOLT11 invoice');
    }

    const paymentHash = bolt11Data?.paymentHash || strikeResponse.paymentHash || '';
    const receiveRequestId = strikeResponse.receiveRequestId;

    let expiresAt: number;
    const expiresString = bolt11Data?.expires || strikeResponse.expires;
    if (expiresString) {
      expiresAt = Math.floor(new Date(expiresString).getTime() / 1000);
    } else {
      expiresAt = Math.floor(Date.now() / 1000) + 3600;
    }

    // ── Store pending boost record ──────────────────────────────
    const boostId = crypto.randomUUID();
    const kv = platform?.env?.GATED_CONTENT ?? null;

    if (!kv && env.NODE_ENV === 'production') {
      console.error('[Boost] GATED_CONTENT KV binding is missing in production');
      return json({ error: 'Service temporarily unavailable' }, { status: 503 });
    }

    const boost: BoostRecord = {
      id: boostId,
      naddr,
      recipeTitle,
      recipeImage: recipeImage || '',
      authorPubkey,
      buyerPubkey,
      tier: 'featured',
      durationKey: durationKey as BoostDurationKey,
      amountSats,
      receiveRequestId,
      paymentHash,
      status: 'pending',
      createdAt: Date.now(),
      activatedAt: null,
      expiresAt: null,
    };

    await storeBoost(kv, boost);

    console.log('[Boost] Invoice created:', {
      boostId,
      receiveRequestId,
      amountSats,
      durationKey,
    });

    return json({
      boostId,
      invoice,
      paymentHash,
      receiveRequestId,
      expiresAt,
      amountSats,
    });
  } catch (error: any) {
    console.error('[Boost] Error creating invoice:', error);

    let errorMessage = 'Failed to create Lightning invoice';
    if (error.message?.includes('STRIKE_API_KEY')) {
      errorMessage = 'Lightning payment service is not configured.';
    } else if (error.message?.includes('Strike API error')) {
      errorMessage = 'Lightning payment service error. Please try again.';
    } else if (error.message) {
      errorMessage = error.message;
    }

    return json({ error: errorMessage }, { status: 500 });
  }
};
