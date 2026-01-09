/**
 * Create Lightning Invoice for Membership Payment
 * 
 * Creates a Lightning invoice for Cook+ or Pro Kitchen membership.
 * This is a simulation endpoint - in production, this would connect to a Lightning payment provider.
 * 
 * POST /api/membership/create-lightning-invoice
 * 
 * Body:
 * {
 *   pubkey: string,
 *   tier: 'cook' | 'pro',
 *   period: 'annual' | '2year',
 *   amountSats: number
 * }
 * 
 * Returns:
 * {
 *   invoice: string, // bolt11 invoice
 *   paymentHash: string, // For verification
 *   expiresAt: number // Unix timestamp
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Pricing in sats (approximate: $1 = 1000 sats)
const PRICING = {
  cook: {
    annual: 49000, // $49/year
    '2year': 83300, // $83.30/2years
  },
  pro: {
    annual: 89000, // $89/year
    '2year': 152400, // $152.40/2years
  },
};

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { pubkey, tier, period, amountSats } = body;
    
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
    
    // Use provided amount or default to tier pricing
    const amount = amountSats || PRICING[tier][period];
    
    // Generate mock bolt11 invoice (simulation only)
    const mockInvoiceId = Math.random().toString(36).substring(2, 15);
    const mockPaymentHash = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    const timestamp = Math.floor(Date.now() / 1000);
    const expiresIn = 3600; // 1 hour expiry
    
    // Mock invoice format (this won't actually work with real Lightning wallets)
    const mockInvoice = `lnbc${amount}${'u'}1p${mockInvoiceId}lq${mockPaymentHash.substring(0, 20)}...simulated`;
    
    console.log('[Membership Lightning] Created mock invoice:', {
      invoice: mockInvoice.substring(0, 50) + '...',
      amount,
      tier,
      period,
      pubkey: pubkey.substring(0, 16) + '...',
      timestamp
    });
    
    return json({
      invoice: mockInvoice,
      paymentHash: mockPaymentHash,
      expiresAt: timestamp + expiresIn,
      amount: amount,
      tier,
      period,
      simulated: true
    });
    
  } catch (error: any) {
    console.error('[Membership Lightning] Error creating invoice:', error);
    
    return json(
      { 
        error: error.message || 'Failed to create Lightning invoice',
      },
      { status: 500 }
    );
  }
};
