/**
 * Create Lightning Invoice for Genesis Founder Payment
 * 
 * Creates a Lightning invoice for Genesis Founder lifetime membership.
 * This is a simulation endpoint - in production, this would connect to a Lightning payment provider.
 * 
 * POST /api/genesis/create-lightning-invoice
 * 
 * Body:
 * {
 *   pubkey: string,
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

// Genesis Founder price: $210 = 210,000 sats (approximately, using $1 = 1000 sats)
const GENESIS_PRICE_SATS = 210000;

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { pubkey, amountSats } = body;
    
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
    
    // Use provided amount or default to Genesis price
    const amount = amountSats || GENESIS_PRICE_SATS;
    
    // TODO: In production, this would create a real Lightning invoice via:
    // - LNbits
    // - BTCPay Server
    // - Strike
    // - Other Lightning payment provider
    
    // For simulation, generate a mock bolt11 invoice
    // Format: lnbc + amount + unit + random data
    // This is NOT a real invoice - it's for simulation only
    const mockInvoiceId = Math.random().toString(36).substring(2, 15);
    const mockPaymentHash = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Generate mock bolt11 invoice (simulation only - not a real invoice)
    // Real format: lnbc[amount][unit]1[timestamp][expiry][payment_hash][description_hash][min_final_cltv_expiry][signature]
    // For simulation, we'll create a simple mock format
    const amountStr = amount.toString();
    const unit = 'u'; // micro-bitcoin (0.001 BTC = 100,000 sats)
    const timestamp = Math.floor(Date.now() / 1000);
    const expiresIn = 3600; // 1 hour expiry
    
    // Mock invoice format (this won't actually work with real Lightning wallets)
    // In production, replace this with actual invoice generation
    const mockInvoice = `lnbc${amountStr}${unit}1p${mockInvoiceId}lq${mockPaymentHash.substring(0, 20)}...simulated`;
    
    console.log('[Genesis Lightning] Created mock invoice:', {
      invoice: mockInvoice.substring(0, 50) + '...',
      amount,
      pubkey: pubkey.substring(0, 16) + '...',
      timestamp
    });
    
    // Store invoice metadata (in production, this would be in a database)
    // For simulation, we'll just return it - in production, store for verification
    
    return json({
      invoice: mockInvoice,
      paymentHash: mockPaymentHash,
      expiresAt: timestamp + expiresIn,
      amount: amount,
      // Note: This is a simulation - real invoices would come from a Lightning node
      simulated: true
    });
    
  } catch (error: any) {
    console.error('[Genesis Lightning] Error creating invoice:', error);
    
    return json(
      { 
        error: error.message || 'Failed to create Lightning invoice',
      },
      { status: 500 }
    );
  }
};
