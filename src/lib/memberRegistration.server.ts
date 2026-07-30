/**
 * Shared member registration logic.
 *
 * Used by:
 *  - Stripe webhook (checkout.session.completed, invoice.paid)
 *  - Stripe complete-payment (client-side redirect)
 *  - Strike webhook (receive-request.receive-completed)
 *
 * Handles relay API registration + NIP-05 auto-claim with idempotency.
 */

import { lookupMember } from './membershipApi.server';

export interface RegisterMemberParams {
  pubkey: string;
  tier: 'cook' | 'pro';
  period: 'annual' | 'monthly';
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

export interface RenewMemberParams {
  pubkey: string;
  subscriptionMonths: number;
  paymentId: string;
  apiSecret: string;
}

export interface RenewMemberResult {
  renewed: boolean;
  /**
   * The relay already holds this paymentId and declined to extend again — a
   * repeat webhook delivery. Reported by the relay, not decided here.
   */
  alreadyApplied: boolean;
  /** No membership record to extend. Nothing was written. */
  notFound: boolean;
  subscriptionEnd: string | null;
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
  const subscriptionMonths = period === 'annual' ? 12 : 1;
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
 * Is this 404 body the relay saying the member does not exist?
 *
 * Deliberately an exact match on the relay's own string rather than a substring
 * or a "has an error field" test: an HTML error page from a proxy, an empty body,
 * or any other service's JSON must all read as false so the caller retries.
 */
function isMemberNotFoundBody(responseText: string): boolean {
  try {
    return JSON.parse(responseText)?.error === 'Member not found';
  } catch {
    return false;
  }
}

/**
 * Extend an existing membership by `subscriptionMonths`.
 *
 * Deliberately NOT registerMember. That helper returns early when the member is
 * already active — which is precisely the case a renewal is for — so a renewal
 * routed through it is swallowed exactly when it matters. This one always reaches
 * the relay's `/renew` endpoint, which extends from max(subscription_end, NOW())
 * and resets status to 'active'.
 *
 * Idempotent on `paymentId`, but NOT here — the check belongs to the relay and
 * this function only reports it. Stripe redelivers a webhook on any non-2xx
 * response and on timeout, and a redelivery that lands twice adds a term the
 * member never paid for. We stamp the Stripe invoice id into `payment_id`; the
 * relay's `/renew` refuses to re-apply one it already holds and answers
 * `action: 'already_applied'`.
 *
 * Two reasons the check is not done here. It cannot be: the relay's
 * `GET /api/members/:pubkey` does not SELECT `payment_id` (nor `payment_method`),
 * so `lookupMember(...).member.payment_id` is always undefined — the field is on
 * the TypeScript type and never on the wire. And it should not be: a
 * read-then-write across a network is not atomic, so two concurrent redeliveries
 * would both read "not yet applied" and both renew.
 *
 * **Deployment order matters.** Against a relay that predates that guard, every
 * redelivery renews again. Ship the relay first.
 *
 * Throws on any relay error the caller should retry.
 */
export async function renewMember(params: RenewMemberParams): Promise<RenewMemberResult> {
  const { pubkey, subscriptionMonths, paymentId, apiSecret } = params;

  const renewRes = await fetch(`https://pantry.zap.cooking/api/members/${pubkey}/renew`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subscription_months: subscriptionMonths,
      payment_id: paymentId,
    }),
  });

  if (!renewRes.ok) {
    const responseText = await renewRes.text();

    // A 404 is terminal only when it is the relay's OWN "no such member" answer
    // (`api/index.ts` returns exactly `{"error":"Member not found"}` from
    // /renew). Status alone is not enough: anything in front of the API can
    // answer 404 while the API container itself is down — which is precisely
    // what deploying the relay's `api` service creates a window for. Treating
    // that as terminal returns 200 to Stripe and drops the renewal permanently,
    // so anything we cannot positively identify is rethrown for redelivery.
    if (renewRes.status === 404 && isMemberNotFoundBody(responseText)) {
      return { renewed: false, alreadyApplied: false, notFound: true, subscriptionEnd: null };
    }

    throw new Error(`Failed to renew member: ${renewRes.status} ${responseText}`);
  }

  const data = await renewRes.json();
  const alreadyApplied = data?.action === 'already_applied';

  return {
    renewed: !alreadyApplied,
    alreadyApplied,
    notFound: false,
    subscriptionEnd: data?.member?.subscription_end ?? null,
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
