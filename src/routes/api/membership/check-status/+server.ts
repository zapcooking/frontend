/**
 * Check Membership Status
 *
 * Checks if a user's pubkey is in the members API.
 * Uses direct single-member lookup for O(1) performance.
 *
 * POST /api/membership/check-status
 *
 * Body:
 * {
 *   pubkey: string
 * }
 *
 * Two disclosure tiers:
 *
 * PUBLIC (no auth) — badge surface only. `found` is always true; a
 * pubkey that was never a member is indistinguishable from a lapsed
 * one (both report isActive: false, tier 'member'):
 *   { found: true, isActive: boolean, member: { tier: string } }
 *
 * OWNER (NIP-98 `Authorization` header signed by the queried pubkey
 * itself — pair with signNip98AuthHeader in $lib/nip98) — the full
 * record:
 *   { found: true, isActive, isExpired, owner: true,
 *     member: { pubkey, tier, status, subscription_end,
 *               subscription_start, payment_method } }
 * An absent, invalid, or mismatched signature degrades to the public
 * shape rather than erroring.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { lookupMember } from '$lib/membershipApi.server';
import { verifyNip98 } from '$lib/nip98.server';

/**
 * Normalize relay tier values to the canonical app tiers.
 * Founders are stored as tier:'standard' with payment_id like 'genesis_1'.
 */
function normalizeRelayTier(tier: string | null | undefined, paymentId?: string | null): string {
  const pid = String(paymentId || '').trim().toLowerCase();
  if (pid.startsWith('genesis_') || pid.startsWith('founder')) return 'founders';

  const value = String(tier || '').trim().toLowerCase();
  if (value === 'cook_plus' || value === 'cook-plus' || value === 'cook plus' || value === 'cook') return 'cook_plus';
  if (value === 'pro_kitchen' || value === 'pro-kitchen' || value === 'pro kitchen' || value === 'pro') return 'pro_kitchen';
  if (value === 'founders' || value === 'founder' || value === 'genesis_founder' || value === 'genesis-founder') return 'founders';
  return 'open';
}

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  // Read the body bytes ONCE — NIP-98 payload verification and JSON
  // parsing must see the same bytes (see verifyNip98's doc comment on
  // body-consumption semantics on Cloudflare Workers).
  let pubkey: unknown;
  let bodyBytes: Uint8Array;
  try {
    bodyBytes = new Uint8Array(await request.arrayBuffer());
    ({ pubkey } = JSON.parse(new TextDecoder().decode(bodyBytes)));
  } catch {
    return json({ error: 'pubkey is required' }, { status: 400 });
  }

  if (!pubkey || typeof pubkey !== 'string') {
    return json({ error: 'pubkey is required' }, { status: 400 });
  }

  // Validate pubkey format
  if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
    return json({ error: 'Invalid pubkey format' }, { status: 400 });
  }

  // Owner check: a NIP-98 header signed by the queried pubkey itself
  // unlocks the full record. Any failure degrades to the public shape
  // — callers that only need badge data never send a header.
  let isOwner = false;
  if (request.headers.get('Authorization')) {
    const verification = await verifyNip98(request, {
      expectedPubkey: pubkey.toLowerCase(),
      bodyBytes
    });
    if (verification.ok) {
      isOwner = true;
    } else {
      console.warn('[check-status] NIP-98 rejected:', verification.reason);
    }
  }

  const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
  if (!API_SECRET) {
    console.error('[Membership Status] RELAY_API_SECRET not configured');
    return json({ error: 'membership lookup unavailable' }, { status: 503 });
  }

  try {
    const result = await lookupMember(pubkey, API_SECRET);

    if (!result.found) {
      return isOwner
        ? json({ found: false, owner: true })
        : json({ found: true, isActive: false, member: { tier: 'member' } });
    }

    const tier = normalizeRelayTier(result.member.tier, result.member.payment_id);

    if (!isOwner) {
      // Public shape: tier is disclosed only while the membership is
      // active, so lapsed and never-a-member are indistinguishable.
      return json({
        found: true,
        isActive: result.isActive,
        member: { tier: result.isActive ? tier : 'member' }
      });
    }

    // Founders get lifetime access — ensure expiry is at least 10 years out
    let subscriptionEnd = result.member.subscription_end;
    if (tier === 'founders' && subscriptionEnd) {
      const tenYearsFromNow = new Date();
      tenYearsFromNow.setFullYear(tenYearsFromNow.getFullYear() + 10);
      if (new Date(subscriptionEnd) < tenYearsFromNow) {
        subscriptionEnd = tenYearsFromNow.toISOString();
      }
    }

    return json({
      found: true,
      isActive: result.isActive,
      isExpired: result.isExpired,
      owner: true,
      member: {
        pubkey: result.member.pubkey,
        tier,
        status: result.member.status,
        subscription_end: subscriptionEnd,
        subscription_start: result.member.subscription_start,
        payment_method: result.member.payment_method
      }
    });
  } catch (error) {
    console.error('[Membership Status] Error checking status:', error);
    return json({ error: 'membership lookup unavailable' }, { status: 503 });
  }
};
