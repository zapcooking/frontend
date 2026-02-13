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
 *   period: 'annual' | 'monthly',
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
import { getBitcoinPrice } from '$lib/bitcoinPrice.server';
import { createInvoice as createStrikeInvoice } from '$lib/strikeService.server';
import { storeInvoiceMetadata } from '$lib/invoiceMetadataStore.server';

// Pricing in USD
const PRICING_USD = {
  cook: {
    annual: 49, // $49/year
    monthly: 4.99, // $4.99/month
  },
  pro: {
    annual: 89, // $89/year
    monthly: 8.99, // $8.99/month
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
    
    if (!period || !['annual', 'monthly'].includes(period)) {
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
    
    // Fetch BTC price once and derive all amounts from it (avoids race condition)
    const currentPrice = await getBitcoinPrice(platform);

    // Calculate discounted USD amount (5% off for Bitcoin payments)
    const discountedUsdAmount = usdAmount * (1 - BITCOIN_DISCOUNT_PERCENT / 100);

    // Convert using the single fetched price
    const btcAmountNum = discountedUsdAmount / currentPrice;
    const btcAmount = btcAmountNum.toFixed(8);
    const amountSats = Math.round(btcAmountNum * 100_000_000);
    
    // Create invoice description with USD price for display
    // Note: Full pubkey is passed separately for payment verification
    const tierName = tier === 'cook' ? 'Cook+' : 'Pro Kitchen';
    const periodLabel = period === 'annual' ? '1 Year' : '1 Month';
    const usdDisplay = discountedUsdAmount.toFixed(2);
    const description = `zap.cooking ${tierName} (${periodLabel}) - $${usdDisplay} USD`;
    
    // Create invoice via Strike API
    console.log('[Membership Lightning] Creating invoice via Strike API...');
    const strikeResponse = await createStrikeInvoice(
      btcAmount,
      'BTC',
      description,
      platform
    );
    
    // Strike returns invoice nested under bolt11 object
    // Handle both possible response structures for compatibility
    const bolt11Data = (strikeResponse as any).bolt11;
    const invoice = bolt11Data?.invoice || strikeResponse.invoice;
    
    if (!invoice) {
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
    
    console.log('[Membership Lightning] Invoice created:', {
      receiveRequestId,
      amountSats,
      tier,
      period,
      pubkey: pubkey.substring(0, 16) + '...',
    });

    // Store invoice metadata so webhook and verify endpoints can match payment to user
    storeInvoiceMetadata(
      receiveRequestId,
      { pubkey, tier: tier as 'cook' | 'pro', period: period as 'annual' | 'monthly' },
      paymentHash
    );
    
    return json({
      invoice,
      paymentHash,
      receiveRequestId, // Include for client reference and webhook matching
      expiresAt,
      amountSats,
      usdAmount,
      discountedUsdAmount: parseFloat(discountedUsdAmount.toFixed(2)),
      btcPrice: parseFloat(currentPrice.toFixed(2)), // Current BTC/USD spot price
      discountPercent: BITCOIN_DISCOUNT_PERCENT,
      tier,
      period,
    });
    
  } catch (error: any) {
    console.error('[Membership Lightning] Error creating invoice:', error);
    
    // Provide user-friendly error messages
    let errorMessage = 'Failed to create Lightning invoice';
    let debugDetails: string | undefined;
    
    if (error.message?.includes('STRIKE_API_KEY')) {
      errorMessage = 'Lightning payment service is not configured. Please use credit card payment.';
    } else if (error.message?.includes('Strike API error')) {
      errorMessage = 'Lightning payment service error. Please try again or use credit card payment.';
      debugDetails = error.message; // Include full error for debugging
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    // In development, include full error details for debugging
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
