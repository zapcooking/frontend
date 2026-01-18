/**
 * Complete Genesis Founder Payment
 * 
 * Verifies Stripe payment and adds member to relay API
 * 
 * POST /api/genesis/complete-payment
 * 
 * Body:
 * {
 *   sessionId: string,
 *   pubkey: string
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, platform }) => {
  console.log('[Genesis Payment] Starting complete-payment handler');
  
  // Membership feature flag guard - return 403 when disabled
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  console.log('[Genesis Payment] MEMBERSHIP_ENABLED:', MEMBERSHIP_ENABLED);
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    console.log('[Genesis Payment] Parsing request body');
    const body = await request.json();
    const { sessionId, pubkey } = body;
    console.log('[Genesis Payment] sessionId:', sessionId?.substring(0, 20) + '...');
    console.log('[Genesis Payment] pubkey:', pubkey?.substring(0, 16) + '...');
    
    if (!sessionId || !pubkey) {
      return json(
        { error: 'sessionId and pubkey are required' },
        { status: 400 }
      );
    }
    
    // Get API secret
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    console.log('[Genesis Payment] API_SECRET configured:', !!API_SECRET);
    if (!API_SECRET) {
      return json(
        { error: 'RELAY_API_SECRET not configured' },
        { status: 500 }
      );
    }
    
    // Verify Stripe session
    const stripeKey = env.STRIPE_SECRET_KEY;
    console.log('[Genesis Payment] STRIPE_SECRET_KEY configured:', !!stripeKey);
    if (!stripeKey) {
      return json(
        { error: 'STRIPE_SECRET_KEY not configured' },
        { status: 500 }
      );
    }
    
    // Dynamic import to avoid Cloudflare Workers build issues
    console.log('[Genesis Payment] Importing Stripe module...');
    const Stripe = (await import('stripe')).default;
    console.log('[Genesis Payment] Stripe module imported, creating client...');
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-12-18.acacia',
      typescript: true,
    });
    console.log('[Genesis Payment] Stripe client created');
    
    console.log('[Genesis Payment] Retrieving checkout session...');
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log('[Genesis Payment] Session retrieved, payment_status:', session.payment_status);
    
    if (session.payment_status !== 'paid') {
      return json(
        { error: 'Payment not completed' },
        { status: 400 }
      );
    }
    
    // Get current founders count to determine founder number
    console.log('[Genesis Payment] Fetching members list...');
    const membersRes = await fetch('https://pantry.zap.cooking/api/members', {
      headers: {
        'Authorization': `Bearer ${API_SECRET}`
      }
    });
    console.log('[Genesis Payment] Members API response status:', membersRes.status);
    
    if (!membersRes.ok) {
      const errorText = await membersRes.text().catch(() => 'Could not read error response');
      console.error('[Genesis Payment] Members API error:', errorText);
      throw new Error(`Failed to fetch members: ${membersRes.status} - ${errorText}`);
    }
    
    const membersData = await membersRes.json();
    console.log('[Genesis Payment] Members count:', membersData.members?.length || 0);
    
    // Count all Genesis Founders (both 'genesis_' and 'founder' prefixes)
    const founders = membersData.members.filter((m: any) => {
      const pid = m.payment_id?.toLowerCase() || '';
      return pid.startsWith('genesis_') || pid.startsWith('founder');
    });
    console.log('[Genesis Payment] Existing founders count:', founders.length);
    
    const founderNumber = founders.length + 1;
    console.log('[Genesis Payment] Assigning founder number:', founderNumber);
    
    if (founderNumber > 21) {
      return json(
        { error: 'All Genesis Founder spots are taken' },
        { status: 400 }
      );
    }
    
    // Add member to relay API
    console.log('[Genesis Payment] Adding member to relay API...');
    console.log('[Genesis Payment] Request payload:', JSON.stringify({
      pubkey: pubkey.substring(0, 16) + '...',
      subscription_months: 0,
      payment_id: `genesis_${founderNumber}`,
      tier: 'standard',
      subscription_end: '2099-12-31T23:59:59Z',
      payment_method: 'stripe'
    }));
    
    let addMemberRes: Response;
    try {
      addMemberRes = await fetch('https://pantry.zap.cooking/api/members', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_SECRET}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          pubkey: pubkey,
          subscription_months: 0, // Lifetime - will set subscription_end to 2099
          payment_id: `genesis_${founderNumber}`, // Track as genesis founder via payment_id
          tier: 'standard', // API only accepts 'standard' - we track genesis via payment_id
          subscription_end: '2099-12-31T23:59:59Z', // Far future date for lifetime
          payment_method: 'stripe'
        })
      });
    } catch (fetchError: any) {
      console.error('[Genesis Payment] Fetch to members API failed:', fetchError.message);
      throw new Error(`Network error calling members API: ${fetchError.message}`);
    }
    
    console.log('[Genesis Payment] Add member response status:', addMemberRes.status);
    const addMemberResponseText = await addMemberRes.text().catch(() => '');
    console.log('[Genesis Payment] Add member response body:', addMemberResponseText);
    
    if (!addMemberRes.ok) {
      console.error('[Genesis Payment] Add member error - status:', addMemberRes.status);
      let errorData: any = {};
      try {
        errorData = JSON.parse(addMemberResponseText);
      } catch {}
      // If member already exists, that's OK - continue with success
      if (addMemberRes.status === 409 || errorData.error?.includes('already exists')) {
        console.log('[Genesis Payment] Member already exists, continuing...');
      } else {
        throw new Error(errorData.error || `Failed to add member: ${addMemberRes.status} - ${addMemberResponseText}`);
      }
    } else {
      console.log('[Genesis Payment] Member added successfully');
    }
    
    // Auto-claim NIP-05 for the Genesis Founder
    let nip05: string | null = null;
    let nip05Username: string | null = null;
    
    try {
      // Generate username from pubkey (first 8 chars)
      const suggestedUsername = pubkey.substring(0, 8).toLowerCase();
      
      console.log('[Genesis Payment] Auto-claiming NIP-05:', suggestedUsername);
      
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
        console.log('[Genesis Payment] NIP-05 claimed:', nip05);
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
          console.log('[Genesis Payment] NIP-05 claimed (fallback):', nip05);
        } else {
          console.warn('[Genesis Payment] Could not auto-claim NIP-05');
        }
      }
    } catch (nip05Error) {
      // NIP-05 claim is optional - don't fail the payment completion
      console.warn('[Genesis Payment] NIP-05 auto-claim error:', nip05Error);
    }
    
    return json({
      success: true,
      founderNumber,
      message: 'Genesis Founder membership activated',
      nip05,
      nip05Username
    });
    
  } catch (error: any) {
    console.error('[Genesis Payment] Error completing payment:', error);
    console.error('[Genesis Payment] Error stack:', error.stack);
    console.error('[Genesis Payment] Error details:', {
      message: error.message,
      name: error.name,
      cause: error.cause
    });
    
    // Provide more specific error messages
    let errorMessage = 'Failed to complete payment';
    if (error.message) {
      errorMessage = error.message;
    } else if (error instanceof Error) {
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

