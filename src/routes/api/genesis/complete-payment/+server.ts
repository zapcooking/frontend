/**
 * Complete Genesis Founder Payment
 *
 * Verifies Stripe payment and adds member to relay API.
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
import { autoClaimNip05 } from '$lib/memberRegistration.server';

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { sessionId, pubkey } = body;

    if (!sessionId || !pubkey) {
      return json(
        { error: 'sessionId and pubkey are required' },
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

    // Get API secret
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (!API_SECRET) {
      console.error('[Genesis Payment] RELAY_API_SECRET not configured');
      return json({ error: 'Payment service unavailable' }, { status: 500 });
    }

    // Verify Stripe session
    const stripeKey = platform?.env?.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      console.error('[Genesis Payment] STRIPE_SECRET_KEY not configured');
      return json({ error: 'Payment service unavailable' }, { status: 500 });
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-12-18.acacia',
      typescript: true,
    });

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return json({ error: 'Payment not completed' }, { status: 400 });
    }

    // Verify pubkey matches session metadata (prevents claiming another user's payment)
    if (session.metadata?.pubkey && session.metadata.pubkey !== pubkey) {
      return json({ error: 'Pubkey does not match payment session' }, { status: 403 });
    }

    // Ensure this Checkout Session is for the Genesis Founder tier
    const EXPECTED_TIER = platform?.env?.GENESIS_TIER || env.GENESIS_TIER || 'genesis-founder';
    if (!session.metadata || session.metadata.tier !== EXPECTED_TIER) {
      return json(
        { error: 'Payment session is not for the Genesis Founder tier' },
        { status: 400 }
      );
    }
    // Get current founders to determine founder number
    const membersRes = await fetch('https://pantry.zap.cooking/api/members', {
      headers: {
        'Authorization': `Bearer ${API_SECRET}`
      }
    });

    if (!membersRes.ok) {
      console.error('[Genesis Payment] Failed to fetch members:', membersRes.status);
      throw new Error('Failed to fetch members');
    }

    const membersData = await membersRes.json();

    // Normalize members array to handle unexpected API responses
    const members = Array.isArray(membersData.members) ? membersData.members : [];

    // Check if this pubkey is already a founder (idempotency)
    const existingFounder = members.find((m: any) => {
      const pid = m.payment_id?.toLowerCase() || '';
      return m.pubkey === pubkey && (pid.startsWith('genesis_') || pid.startsWith('founder'));
    });

    if (existingFounder) {
      const match = existingFounder.payment_id?.match(/(\d+)$/);
      const existingNumber = match ? parseInt(match[1], 10) : null;
      return json({
        success: true,
        founderNumber: existingNumber,
        message: 'Genesis Founder membership already active',
        nip05: null,
        nip05Username: null
      });
    }

    // Count all Genesis Founders to assign next number
    const founders = members.filter((m: any) => {
      const pid = m.payment_id?.toLowerCase() || '';
      return pid.startsWith('genesis_') || pid.startsWith('founder');
    });

    const founderNumber = founders.length + 1;

    if (founderNumber > 21) {
      return json({ error: 'All Genesis Founder spots are taken' }, { status: 400 });
    }

    // Add member to relay API
    const addMemberRes = await fetch('https://pantry.zap.cooking/api/members', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pubkey,
        subscription_months: 0,
        payment_id: `genesis_${founderNumber}`,
        tier: 'standard',
        subscription_end: '2099-12-31T23:59:59Z',
        payment_method: 'stripe'
      })
    });

    if (!addMemberRes.ok) {
      const responseText = await addMemberRes.text().catch(() => '');
      let errorData: any = {};
      try {
        errorData = JSON.parse(responseText);
      } catch {}
      if (addMemberRes.status === 409 || errorData.error?.includes('already exists')) {
        // Member already exists — continue
      } else {
        console.error('[Genesis Payment] Add member failed:', addMemberRes.status);
        throw new Error('Failed to register member');
      }
    }

    // Auto-claim NIP-05 using shared logic
    const { nip05, nip05Username } = await autoClaimNip05({
      pubkey,
      tier: 'pro',
      apiSecret: API_SECRET,
    });

    return json({
      success: true,
      founderNumber,
      message: 'Genesis Founder membership activated',
      nip05,
      nip05Username
    });

  } catch (error: any) {
    console.error('[Genesis Payment] Error:', error.message);

    return json(
      { error: 'Failed to complete payment' },
      { status: 500 }
    );
  }
};
