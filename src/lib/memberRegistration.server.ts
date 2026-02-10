/**
 * Shared member registration logic.
 *
 * Used by:
 *  - Stripe webhook (checkout.session.completed)
 *  - Stripe complete-payment (client-side redirect)
 *  - Strike webhook (invoice.paid)
 *
 * Handles relay API registration + NIP-05 auto-claim with idempotency.
 */

import { lookupMember } from './membershipApi.server';

export interface RegisterMemberParams {
  pubkey: string;
  tier: 'cook' | 'pro';
  period: 'annual' | '2year';
  paymentMethod: 'stripe' | 'lightning_strike';
  apiSecret: string;
}

export interface RegisterMemberResult {
  success: boolean;
  alreadyExists: boolean;
  subscriptionEnd: string;
  nip05: string | null;
  nip05Username: string | null;
}

/**
 * Register a member on the relay API and auto-claim a NIP-05 identifier.
 *
 * Idempotent: checks if member already exists and has an active subscription
 * before creating a new record. Handles 409 conflict responses gracefully.
 */
export async function registerMember(params: RegisterMemberParams): Promise<RegisterMemberResult> {
  const { pubkey, tier, period, paymentMethod, apiSecret } = params;

  // Idempotency guard — check if member already exists with active subscription
  try {
    const existing = await lookupMember(pubkey, apiSecret);
    if (existing.found && existing.isActive) {
      console.log('[registerMember] Member already exists and active, skipping registration:', pubkey.substring(0, 16) + '...');
      return {
        success: true,
        alreadyExists: true,
        subscriptionEnd: existing.member.subscription_end,
        nip05: null,
        nip05Username: null,
      };
    }
  } catch (lookupErr) {
    // If lookup fails, proceed with registration anyway
    console.warn('[registerMember] Lookup failed, proceeding with registration:', lookupErr);
  }

  // Calculate subscription end date
  const now = new Date();
  const subscriptionMonths = period === 'annual' ? 12 : 24;
  const subscriptionEnd = new Date(now);
  subscriptionEnd.setMonth(now.getMonth() + subscriptionMonths);

  // Generate payment_id
  const paymentId = `${tier}_${paymentMethod === 'stripe' ? 'stripe' : 'strike'}_${Date.now()}`;

  console.log('[registerMember] Adding member to relay API...', {
    pubkey: pubkey.substring(0, 16) + '...',
    tier,
    period,
    subscriptionEnd: subscriptionEnd.toISOString(),
  });

  // Add member to relay API
  const addMemberRes = await fetch('https://pantry.zap.cooking/api/members', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pubkey,
      subscription_months: subscriptionMonths,
      payment_id: paymentId,
      tier: 'standard',
      subscription_end: subscriptionEnd.toISOString(),
      payment_method: paymentMethod,
    }),
  });

  if (!addMemberRes.ok) {
    const responseText = await addMemberRes.text();
    let errorData: any;
    try {
      errorData = JSON.parse(responseText);
    } catch {
      errorData = { error: responseText };
    }

    // Handle 409 conflict (member already exists) gracefully
    if (addMemberRes.status === 409) {
      console.log('[registerMember] Member already exists (409 conflict):', pubkey.substring(0, 16) + '...');
      return {
        success: true,
        alreadyExists: true,
        subscriptionEnd: subscriptionEnd.toISOString(),
        nip05: null,
        nip05Username: null,
      };
    }

    console.error('[registerMember] Add member API error:', {
      status: addMemberRes.status,
      error: errorData,
    });
    throw new Error(errorData.error || `Failed to add member: ${addMemberRes.status}`);
  }

  const { nip05, nip05Username } = await autoClaimNip05({ pubkey, tier, apiSecret });

  return {
    success: true,
    alreadyExists: false,
    subscriptionEnd: subscriptionEnd.toISOString(),
    nip05,
    nip05Username,
  };
}

/**
 * Auto-claim a NIP-05 identifier for a member.
 *
 * Tries pubkey prefix first, then a fallback with timestamp suffix.
 * Never throws — returns nulls on failure so callers don't need to handle errors.
 */
export async function autoClaimNip05(params: {
  pubkey: string;
  tier: 'cook' | 'pro';
  apiSecret: string;
}): Promise<{ nip05: string | null; nip05Username: string | null }> {
  const { pubkey, tier, apiSecret } = params;

  try {
    const suggestedUsername = pubkey.substring(0, 8).toLowerCase();

    const nip05Res = await fetch('https://pantry.zap.cooking/api/nip05/claim', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: suggestedUsername,
        pubkey,
        tier,
      }),
    });

    if (nip05Res.ok) {
      return {
        nip05: `${suggestedUsername}@zap.cooking`,
        nip05Username: suggestedUsername,
      };
    }

    // If default username fails, try with timestamp suffix
    const fallbackUsername = `${pubkey.substring(0, 6)}${Date.now().toString(36).slice(-2)}`.toLowerCase();

    const fallbackRes = await fetch('https://pantry.zap.cooking/api/nip05/claim', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: fallbackUsername,
        pubkey,
        tier,
      }),
    });

    if (fallbackRes.ok) {
      return {
        nip05: `${fallbackUsername}@zap.cooking`,
        nip05Username: fallbackUsername,
      };
    }

    console.warn('[autoClaimNip05] Could not auto-claim NIP-05');
  } catch (err) {
    console.warn('[autoClaimNip05] NIP-05 auto-claim error:', err);
  }

  return { nip05: null, nip05Username: null };
}
