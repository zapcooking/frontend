/**
 * Verify Lightning Payment for Genesis Founder
 * 
 * Verifies that a Lightning payment was completed and processes the membership.
 * This is a simulation endpoint - in production, this would verify with a Lightning node.
 * 
 * POST /api/genesis/verify-lightning-payment
 * 
 * Body:
 * {
 *   paymentHash: string,
 *   invoice: string,
 *   pubkey: string,
 *   preimage?: string // Payment preimage for verification
 * }
 * 
 * Returns:
 * {
 *   verified: boolean,
 *   founderNumber?: number
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { paymentHash, invoice, pubkey, preimage } = body;
    
    if (!paymentHash || !invoice || !pubkey) {
      return json(
        { error: 'paymentHash, invoice, and pubkey are required' },
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
    
    // TODO: In production, verify payment with Lightning node
    // For simulation, we'll accept any payment with valid format
    // Real verification would:
    // 1. Check payment hash against Lightning node
    // 2. Verify preimage
    // 3. Confirm invoice was paid
    
    console.log('[Genesis Lightning] Verifying payment (simulation):', {
      paymentHash: paymentHash.substring(0, 16) + '...',
      invoice: invoice.substring(0, 50) + '...',
      pubkey: pubkey.substring(0, 16) + '...',
      hasPreimage: !!preimage
    });
    
    // For simulation, assume payment is verified if we have the required fields
    // In production, this would actually check the Lightning node
    const isSimulated = invoice.includes('simulated');
    
    if (isSimulated) {
      console.log('[Genesis Lightning] Simulated payment - accepting for testing');
    } else {
      // In production, verify with Lightning node here
      // For now, we'll require a preimage for non-simulated invoices
      if (!preimage) {
        return json(
          { error: 'Payment verification required - please provide preimage' },
          { status: 400 }
        );
      }
    }
    
    // Get API secret for members API
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (!API_SECRET) {
      return json(
        { error: 'RELAY_API_SECRET not configured' },
        { status: 500 }
      );
    }
    
    // Get current founders count
    const membersRes = await fetch('https://pantry.zap.cooking/api/members', {
      headers: {
        'Authorization': `Bearer ${API_SECRET}`
      }
    });
    
    if (!membersRes.ok) {
      throw new Error(`Failed to fetch members: ${membersRes.status}`);
    }
    
    const membersData = await membersRes.json();
    const founders = membersData.members.filter((m: any) => {
      const paymentId = m.payment_id?.toLowerCase() || '';
      return (paymentId.startsWith('genesis_') || paymentId.startsWith('founder')) && m.status === 'active';
    });
    
    let maxFounderNumber = 0;
    founders.forEach((m: any) => {
      const paymentId = m.payment_id?.toLowerCase() || '';
      const match = paymentId.match(/(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxFounderNumber) maxFounderNumber = num;
      } else if (paymentId === 'founder') {
        maxFounderNumber = Math.max(maxFounderNumber, 1);
      }
    });
    
    const founderNumber = maxFounderNumber + 1;
    
    if (founderNumber > 21) {
      return json(
        { error: 'All Genesis Founder spots are taken' },
        { status: 400 }
      );
    }
    
    // Add member to relay API
      const addMemberRes = await fetch('https://pantry.zap.cooking/api/members', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pubkey: pubkey,
        subscription_months: 0,
        payment_id: `genesis_${founderNumber}`,
        tier: 'standard',
        subscription_end: '2099-12-31T23:59:59Z',
        payment_method: 'lightning' // Mark as Lightning payment
      })
    });
    
    if (!addMemberRes.ok) {
      const responseText = await addMemberRes.text();
      let errorData;
      try {
        errorData = JSON.parse(responseText);
      } catch (e) {
        errorData = { error: responseText };
      }
      throw new Error(errorData.error || `Failed to add member: ${addMemberRes.status}`);
    }
    
    // Auto-claim NIP-05 for the Genesis Founder
    let nip05: string | null = null;
    let nip05Username: string | null = null;
    
    try {
      // Generate username from pubkey (first 8 chars)
      const suggestedUsername = pubkey.substring(0, 8).toLowerCase();
      
      console.log('[Genesis Lightning] Auto-claiming NIP-05:', suggestedUsername);
      
      const nip05Res = await fetch('https://pantry.zap.cooking/api/nip05/claim', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_SECRET}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: suggestedUsername,
          pubkey,
          tier: 'pro'
        })
      });
      
      if (nip05Res.ok) {
        nip05Username = suggestedUsername;
        nip05 = `${suggestedUsername}@zap.cooking`;
        console.log('[Genesis Lightning] NIP-05 claimed:', nip05);
      } else {
        // If default username fails, try with timestamp suffix
        const fallbackUsername = `${pubkey.substring(0, 6)}${Date.now().toString(36).slice(-2)}`.toLowerCase();
        
        const fallbackRes = await fetch('https://pantry.zap.cooking/api/nip05/claim', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_SECRET}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username: fallbackUsername,
            pubkey,
            tier: 'pro'
          })
        });
        
        if (fallbackRes.ok) {
          nip05Username = fallbackUsername;
          nip05 = `${fallbackUsername}@zap.cooking`;
          console.log('[Genesis Lightning] NIP-05 claimed (fallback):', nip05);
        } else {
          console.warn('[Genesis Lightning] Could not auto-claim NIP-05');
        }
      }
    } catch (nip05Error) {
      // NIP-05 claim is optional - don't fail the payment verification
      console.warn('[Genesis Lightning] NIP-05 auto-claim error:', nip05Error);
    }
    
    return json({
      verified: true,
      founderNumber,
      message: 'Genesis Founder membership activated via Lightning',
      nip05,
      nip05Username
    });
    
  } catch (error: any) {
    console.error('[Genesis Lightning] Error verifying payment:', error);
    
    return json(
      { 
        error: error.message || 'Failed to verify payment',
        verified: false
      },
      { status: 500 }
    );
  }
};
