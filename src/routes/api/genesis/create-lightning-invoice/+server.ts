/**
 * Create Lightning Invoice for Founders Club Payment
 * 
 * Creates a Lightning invoice for Founders Club lifetime membership using Strike API.
 * Applies 5% Bitcoin discount and uses current BTC spot price.
 * 
 * POST /api/genesis/create-lightning-invoice
 * 
 * Body:
 * {
 *   pubkey: string,
 * }
 * 
 * Returns:
 * {
 *   invoice: string, // bolt11 invoice
 *   paymentHash: string,
 *   receiveRequestId: string,
 *   expiresAt: number,
 *   amountSats: number,
 *   usdAmount: number,
 *   discountedUsdAmount: number,
 *   btcPrice: number,
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { convertUsdToSats, convertUsdToBtc, getDiscountedBitcoinPrice } from '$lib/bitcoinPrice.server';
import { createInvoice as createStrikeInvoice } from '$lib/strikeService.server';

// Founders Club pricing in USD (lifetime membership)
const FOUNDERS_CLUB_PRICE_USD = 210;

// Discount percentage for Bitcoin payments
const BITCOIN_DISCOUNT_PERCENT = 5;

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { pubkey } = body;
    
    if (!pubkey) {
      return json(
        { error: 'pubkey is required' },
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
    
    const usdAmount = FOUNDERS_CLUB_PRICE_USD;
    
    // Get current Bitcoin spot price
    console.log('[Founders Club Lightning] Fetching current Bitcoin price...');
    const { price: currentPrice } = await getDiscountedBitcoinPrice(0, platform);
    
    // Calculate discounted USD amount (5% off for Bitcoin payments)
    const discountedUsdAmount = usdAmount * (1 - BITCOIN_DISCOUNT_PERCENT / 100);
    
    // Convert discounted USD to BTC at current spot price
    const btcAmount = await convertUsdToBtc(discountedUsdAmount, undefined, platform);
    
    // Convert discounted USD to sats at current spot price
    const amountSats = await convertUsdToSats(discountedUsdAmount, undefined, platform);
    
    console.log('[Founders Club Lightning] Price calculation:', {
      originalUsdPrice: usdAmount,
      discountPercent: BITCOIN_DISCOUNT_PERCENT,
      discountedUsdAmount: discountedUsdAmount.toFixed(2),
      btcSpotPrice: currentPrice.toFixed(2),
      btcAmount,
      amountSats,
    });
    
    // Create invoice description with USD price for display
    const usdDisplay = discountedUsdAmount.toFixed(2);
    const description = `zap.cooking Founders Club (Lifetime) - $${usdDisplay} USD`;
    
    // Create invoice via Strike API
    console.log('[Founders Club Lightning] Creating invoice via Strike API...');
    const strikeResponse = await createStrikeInvoice(
      btcAmount,
      'BTC',
      description,
      platform
    );
    
    // Strike returns invoice nested under bolt11 object
    const bolt11Data = (strikeResponse as any).bolt11;
    const invoice = bolt11Data?.invoice || strikeResponse.invoice;
    
    if (!invoice) {
      console.error('[Founders Club Lightning] Unexpected Strike response structure:', strikeResponse);
      throw new Error('Strike API did not return a BOLT11 invoice');
    }
    
    // Extract payment hash and expiration from bolt11 object or top level
    const paymentHash = bolt11Data?.paymentHash || strikeResponse.paymentHash || '';
    const receiveRequestId = strikeResponse.receiveRequestId;
    
    // Parse expiration from Strike response (if available) or default to 1 hour
    let expiresAt: number;
    const expiresString = bolt11Data?.expires || strikeResponse.expires;
    if (expiresString) {
      expiresAt = Math.floor(new Date(expiresString).getTime() / 1000);
    } else {
      expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour default
    }
    
    console.log('[Founders Club Lightning] Invoice created successfully:', {
      receiveRequestId,
      invoiceLength: invoice.length,
      paymentHash: paymentHash.substring(0, 16) + '...',
      amountSats,
      pubkey: pubkey.substring(0, 16) + '...',
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    });
    
    return json({
      invoice,
      paymentHash,
      receiveRequestId,
      expiresAt,
      amountSats,
      usdAmount,
      discountedUsdAmount: parseFloat(discountedUsdAmount.toFixed(2)),
      btcPrice: parseFloat(currentPrice.toFixed(2)),
      discountPercent: BITCOIN_DISCOUNT_PERCENT,
    });
    
  } catch (error: any) {
    console.error('[Founders Club Lightning] Error creating invoice:', error);
    
    // Provide user-friendly error messages
    let errorMessage = 'Failed to create Lightning invoice';
    let debugDetails: string | undefined;
    
    if (error.message?.includes('STRIKE_API_KEY')) {
      errorMessage = 'Lightning payment service is not configured. Please use credit card payment.';
    } else if (error.message?.includes('Strike API error')) {
      errorMessage = 'Lightning payment service error. Please try again or use credit card payment.';
      debugDetails = error.message;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    const isDev = env.NODE_ENV !== 'production';
    
    return json(
      { 
        error: errorMessage,
        ...(isDev && debugDetails && { debug: debugDetails }),
        ...(isDev && { rawError: error.message }),
      },
      { status: 500 }
    );
  }
};
