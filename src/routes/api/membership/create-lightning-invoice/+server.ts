/**
 * Create Lightning Invoice for Membership Payment
 * 
 * Creates a Lightning invoice for Cook+ or Pro Kitchen membership using Strike API.
 * Fetches current Bitcoin price and applies a 5% discount.
 * 
 * POST /api/membership/create-lightning-invoice
 * 
 * Body:
 * {
 *   pubkey: string,
 *   tier: 'cook' | 'pro',
 *   period: 'annual' | '2year',
 * }
 * 
 * Returns:
 * {
 *   invoice: string, // bolt11 invoice
 *   paymentHash: string, // Payment hash from Strike
 *   receiveRequestId: string, // Strike invoice ID for webhook matching
 *   expiresAt: number // Unix timestamp
 *   amountSats: number // Actual amount in satoshis
 *   usdAmount: number // Original USD amount
 *   discountedUsdAmount: number // USD amount after 5% discount
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { convertUsdToSats, convertUsdToBtc, getDiscountedBitcoinPrice } from '$lib/bitcoinPrice.server';
import { createInvoice as createStrikeInvoice } from '$lib/strikeService.server';

// Pricing in USD
const PRICING_USD = {
  cook: {
    annual: 49, // $49/year
    '2year': 83.30, // $83.30/2years
  },
  pro: {
    annual: 89, // $89/year
    '2year': 152.40, // $152.40/2years
  },
};

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
    const { pubkey, tier, period } = body;
    
    if (!pubkey) {
      return json(
        { error: 'pubkey is required' },
        { status: 400 }
      );
    }
    
    if (!tier || !['cook', 'pro'].includes(tier)) {
      return json(
        { error: 'Invalid tier. Must be "cook" or "pro"' },
        { status: 400 }
      );
    }
    
    if (!period || !['annual', '2year'].includes(period)) {
      return json(
        { error: 'Invalid period. Must be "annual" or "2year"' },
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
    
    // Get USD price for the tier/period
    const tierPricing = PRICING_USD[tier as keyof typeof PRICING_USD];
    if (!tierPricing) {
      return json(
        { error: 'Invalid tier pricing configuration' },
        { status: 500 }
      );
    }
    const usdAmount = tierPricing[period as keyof typeof tierPricing];
    if (typeof usdAmount !== 'number') {
      return json(
        { error: 'Invalid period pricing configuration' },
        { status: 500 }
      );
    }
    
    // Get discounted Bitcoin price and convert USD to BTC
    console.log('[Membership Lightning] Fetching Bitcoin price with discount...');
    const { discountedPrice, price: currentPrice } = await getDiscountedBitcoinPrice(
      BITCOIN_DISCOUNT_PERCENT,
      platform
    );
    
    // Calculate discounted USD amount
    const discountedUsdAmount = usdAmount * (1 - BITCOIN_DISCOUNT_PERCENT / 100);
    
    // Convert to BTC for Strike API
    const btcAmount = await convertUsdToBtc(discountedUsdAmount, BITCOIN_DISCOUNT_PERCENT, platform);
    
    // Convert to sats for response
    const amountSats = await convertUsdToSats(discountedUsdAmount, BITCOIN_DISCOUNT_PERCENT, platform);
    
    console.log('[Membership Lightning] Price calculation:', {
      usdAmount,
      discountedUsdAmount: discountedUsdAmount.toFixed(2),
      currentBtcPrice: currentPrice.toFixed(2),
      discountedBtcPrice: discountedPrice.toFixed(2),
      btcAmount,
      amountSats,
      tier,
      period,
    });
    
    // Create invoice description with full pubkey for webhook processing
    // Format: "ZapCooking {Tier} {Period} Membership - {pubkey}"
    const tierName = tier === 'cook' ? 'Cook+' : 'Pro Kitchen';
    const periodLabel = period === 'annual' ? '1yr' : '2yr';
    const description = `ZapCooking ${tierName} ${periodLabel} Membership - ${pubkey}`;
    
    // Create invoice via Strike API
    console.log('[Membership Lightning] Creating invoice via Strike API...');
    const strikeResponse = await createStrikeInvoice(
      btcAmount,
      'BTC',
      description,
      platform
    );
    
    if (!strikeResponse.invoice) {
      throw new Error('Strike API did not return a BOLT11 invoice');
    }
    
    // Extract payment hash and expiration
    const paymentHash = strikeResponse.paymentHash || '';
    const receiveRequestId = strikeResponse.receiveRequestId;
    
    // Parse expiration from Strike response (if available) or default to 1 hour
    let expiresAt: number;
    if (strikeResponse.expires) {
      expiresAt = Math.floor(new Date(strikeResponse.expires).getTime() / 1000);
    } else {
      expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour default
    }
    
    console.log('[Membership Lightning] Invoice created successfully:', {
      receiveRequestId,
      invoiceLength: strikeResponse.invoice.length,
      paymentHash: paymentHash.substring(0, 16) + '...',
      amountSats,
      tier,
      period,
      pubkey: pubkey.substring(0, 16) + '...',
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    });
    
    // TODO: Store invoice metadata (receiveRequestId -> pubkey, tier, period) for webhook processing
    // This could be stored in a database, cache, or passed via webhook URL metadata
    
    return json({
      invoice: strikeResponse.invoice,
      paymentHash,
      receiveRequestId, // Include for client reference and webhook matching
      expiresAt,
      amountSats,
      usdAmount,
      discountedUsdAmount: parseFloat(discountedUsdAmount.toFixed(2)),
      tier,
      period,
    });
    
  } catch (error: any) {
    console.error('[Membership Lightning] Error creating invoice:', error);
    
    // Provide user-friendly error messages
    let errorMessage = 'Failed to create Lightning invoice';
    
    if (error.message?.includes('STRIKE_API_KEY')) {
      errorMessage = 'Lightning payment service is not configured. Please use credit card payment.';
    } else if (error.message?.includes('Strike API error')) {
      errorMessage = 'Lightning payment service error. Please try again or use credit card payment.';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return json(
      { 
        error: errorMessage,
      },
      { status: 500 }
    );
  }
};
