/**
 * Get Bitcoin Price Quote for Membership
 * 
 * Returns current Bitcoin price with 5% discount applied for a specific membership tier.
 * Used to display the discounted Bitcoin price in the UI before payment.
 * 
 * GET /api/membership/bitcoin-price-quote?tier=pro&period=annual
 * 
 * Returns:
 * {
 *   usdAmount: number,           // Original USD price
 *   discountedUsdAmount: number, // USD price after 5% discount
 *   discountPercent: number,     // Discount percentage (5)
 *   amountSats: number,          // Amount in satoshis
 *   btcPrice: number,            // Current BTC price in USD
 *   discountedBtcPrice: number,  // BTC price with discount applied
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getDiscountedBitcoinPrice, convertUsdToSats } from '$lib/bitcoinPrice.server';

// Pricing in USD
const PRICING_USD = {
  cook: {
    annual: 49,
    '2year': 83.30,
  },
  pro: {
    annual: 89,
    '2year': 152.40,
  },
  founders: {
    lifetime: 210,
  },
};

// Discount percentage for Bitcoin payments
const BITCOIN_DISCOUNT_PERCENT = 5;

export const GET: RequestHandler = async ({ url, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const tier = url.searchParams.get('tier') || 'pro';
    const period = url.searchParams.get('period') || 'annual';
    
    // Validate tier and period
    if (!['cook', 'pro', 'founders'].includes(tier)) {
      return json({ error: 'Invalid tier' }, { status: 400 });
    }
    if (!['annual', '2year', 'lifetime'].includes(period)) {
      return json({ error: 'Invalid period' }, { status: 400 });
    }
    
    // Get USD price
    let usdAmount: number;
    if (tier === 'founders') {
      usdAmount = PRICING_USD.founders.lifetime;
    } else {
      const tierPricing = PRICING_USD[tier as 'cook' | 'pro'];
      usdAmount = tierPricing[period as 'annual' | '2year'];
    }
    
    // Get current Bitcoin price
    const { price: btcPrice } = await getDiscountedBitcoinPrice(0, platform);
    
    // Calculate discounted USD amount
    const discountedUsdAmount = usdAmount * (1 - BITCOIN_DISCOUNT_PERCENT / 100);
    
    // Convert to sats at current spot price
    const amountSats = await convertUsdToSats(discountedUsdAmount, undefined, platform);
    
    return json({
      usdAmount,
      discountedUsdAmount: parseFloat(discountedUsdAmount.toFixed(2)),
      discountPercent: BITCOIN_DISCOUNT_PERCENT,
      amountSats,
      btcPrice: parseFloat(btcPrice.toFixed(2)),
      tier,
      period,
    });
    
  } catch (error: any) {
    console.error('[Bitcoin Price Quote] Error:', error);
    
    return json(
      { 
        error: error.message || 'Failed to get Bitcoin price quote',
      },
      { status: 500 }
    );
  }
};
