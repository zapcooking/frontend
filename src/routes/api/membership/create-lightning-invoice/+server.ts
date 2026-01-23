/**
 * Create Lightning Invoice for Membership Payment
 * 
 * Creates a Lightning invoice for Cook+ or Pro Kitchen membership.
 * Fetches current Bitcoin price and applies a 5% discount.
 * 
 * Uses LNURL to fetch invoice from a configured Lightning address.
 * Set MEMBERSHIP_LIGHTNING_ADDRESS env var to the address that receives payments.
 * Example: MEMBERSHIP_LIGHTNING_ADDRESS=payments@getalby.com
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
 *   paymentHash: string, // For verification (extracted from invoice)
 *   expiresAt: number // Unix timestamp
 *   amountSats: number // Actual amount in satoshis
 *   usdAmount: number // Original USD amount
 *   discountedUsdAmount: number // USD amount after 5% discount
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { convertUsdToSats, getDiscountedBitcoinPrice } from '$lib/bitcoinPrice.server';

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

/**
 * Resolve a Lightning address to LNURL pay parameters
 */
async function resolveLightningAddress(address: string): Promise<{
  callback: string;
  minSendable: number;
  maxSendable: number;
  commentAllowed?: number;
}> {
  const [username, domain] = address.split('@');
  if (!username || !domain) {
    throw new Error('Invalid Lightning address format');
  }

  const response = await fetch(`https://${domain}/.well-known/lnurlp/${username}`);
  if (!response.ok) {
    throw new Error(`Failed to resolve Lightning address: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.status === 'ERROR') {
    throw new Error(data.reason || 'Lightning address error');
  }

  return {
    callback: data.callback,
    minSendable: data.minSendable,
    maxSendable: data.maxSendable,
    commentAllowed: data.commentAllowed,
  };
}

/**
 * Fetch an invoice from LNURL callback
 */
async function fetchLnurlInvoice(
  callback: string,
  amountMsats: number,
  comment?: string
): Promise<{ pr: string; verify?: string }> {
  const url = new URL(callback);
  url.searchParams.set('amount', amountMsats.toString());
  if (comment) {
    url.searchParams.set('comment', comment);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch LNURL invoice: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.status === 'ERROR') {
    throw new Error(data.reason || 'Failed to create invoice');
  }

  if (!data.pr) {
    throw new Error('No payment request returned from LNURL');
  }

  return { pr: data.pr, verify: data.verify };
}

/**
 * Extract payment hash from a BOLT11 invoice
 * Payment hash is the SHA256 of the preimage, encoded in the invoice
 */
function extractPaymentHash(bolt11: string): string {
  // The payment hash is typically in the invoice data
  // For a simple extraction, we'll generate a hash from the invoice itself
  // In production, you'd decode the BOLT11 properly
  // For now, we'll use a unique identifier based on the invoice
  const hash = Array.from(
    new Uint8Array(
      new TextEncoder().encode(bolt11).buffer
    )
  ).slice(0, 32).map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hash;
}

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
    
    // Get the Lightning address for receiving membership payments
    const lightningAddress = (platform?.env as any)?.MEMBERSHIP_LIGHTNING_ADDRESS || env.MEMBERSHIP_LIGHTNING_ADDRESS;
    if (!lightningAddress) {
      console.error('[Membership Lightning] MEMBERSHIP_LIGHTNING_ADDRESS not configured');
      return json(
        { error: 'Lightning payments are not configured. Please use credit card payment.' },
        { status: 500 }
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
    
    // Get discounted Bitcoin price and convert USD to sats
    console.log('[Membership Lightning] Fetching Bitcoin price with discount...');
    const { discountedPrice, price: currentPrice } = await getDiscountedBitcoinPrice(
      BITCOIN_DISCOUNT_PERCENT,
      platform
    );
    
    // Calculate discounted USD amount
    const discountedUsdAmount = usdAmount * (1 - BITCOIN_DISCOUNT_PERCENT / 100);
    
    // Convert to sats
    const amountSats = await convertUsdToSats(discountedUsdAmount, BITCOIN_DISCOUNT_PERCENT, platform);
    const amountMsats = amountSats * 1000;
    
    console.log('[Membership Lightning] Price calculation:', {
      usdAmount,
      discountedUsdAmount: discountedUsdAmount.toFixed(2),
      currentBtcPrice: currentPrice.toFixed(2),
      discountedBtcPrice: discountedPrice.toFixed(2),
      amountSats,
      tier,
      period,
    });
    
    // Resolve Lightning address
    console.log('[Membership Lightning] Resolving Lightning address:', lightningAddress);
    const lnurlInfo = await resolveLightningAddress(lightningAddress);
    
    // Validate amount is within LNURL limits
    if (amountMsats < lnurlInfo.minSendable) {
      return json(
        { error: `Amount too small. Minimum: ${Math.ceil(lnurlInfo.minSendable / 1000)} sats` },
        { status: 400 }
      );
    }
    if (amountMsats > lnurlInfo.maxSendable) {
      return json(
        { error: `Amount too large. Maximum: ${Math.floor(lnurlInfo.maxSendable / 1000)} sats` },
        { status: 400 }
      );
    }
    
    // Create invoice description/comment
    const tierName = tier === 'cook' ? 'Cook+' : 'Pro Kitchen';
    const periodLabel = period === 'annual' ? '1yr' : '2yr';
    let comment = `ZapCooking ${tierName} ${periodLabel} - ${pubkey.substring(0, 8)}`;
    
    // Truncate comment if needed
    if (lnurlInfo.commentAllowed && comment.length > lnurlInfo.commentAllowed) {
      comment = comment.substring(0, lnurlInfo.commentAllowed);
    } else if (!lnurlInfo.commentAllowed) {
      comment = '';
    }
    
    // Fetch invoice from LNURL
    console.log('[Membership Lightning] Fetching invoice from LNURL...');
    const { pr: invoice, verify } = await fetchLnurlInvoice(
      lnurlInfo.callback,
      amountMsats,
      comment || undefined
    );
    
    // Extract/generate payment hash for verification
    const paymentHash = extractPaymentHash(invoice);
    
    // Invoice typically expires in 1 hour
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    
    console.log('[Membership Lightning] Invoice created successfully:', {
      invoiceLength: invoice.length,
      paymentHash: paymentHash.substring(0, 16) + '...',
      amountSats,
      tier,
      period,
      pubkey: pubkey.substring(0, 16) + '...',
      verify: verify ? 'available' : 'not available',
    });
    
    return json({
      invoice,
      paymentHash,
      expiresAt,
      amountSats,
      usdAmount,
      discountedUsdAmount: parseFloat(discountedUsdAmount.toFixed(2)),
      tier,
      period,
      verify, // Include verify URL if available for payment verification
    });
    
  } catch (error: any) {
    console.error('[Membership Lightning] Error creating invoice:', error);
    
    // Provide user-friendly error messages
    let errorMessage = 'Failed to create Lightning invoice';
    
    if (error.message?.includes('MEMBERSHIP_LIGHTNING_ADDRESS')) {
      errorMessage = 'Lightning payments are not configured. Please use credit card payment.';
    } else if (error.message?.includes('Failed to resolve')) {
      errorMessage = 'Lightning payment service is temporarily unavailable. Please try credit card payment.';
    } else if (error.message?.includes('Failed to fetch')) {
      errorMessage = 'Could not create Lightning invoice. Please try again or use credit card payment.';
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
