import { json, type RequestHandler } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { checkMembership } from '$lib/membershipApi.server';
import { UNRESOLVED_HEADER, LOOKUP_CONCURRENCY, REQUEST_BUDGET_MS } from '$lib/membership/contract';

/**
 * One resolved entry. Contract (shared with feed-relay's trust refresh and the
 * client store, see docs/pantry-contract.md):
 *   - the body is a flat map keyed by lowercase hex pubkey;
 *   - `active` is always a real boolean when the entry is present;
 *   - a pubkey the server could NOT resolve is OMITTED from the map and listed
 *     in the `X-Membership-Unresolved` response header — never present with
 *     active:false, which readers would take as "not a member";
 *   - `state` and `status` are additive; `active`/`tier`/`expiresAt` are unchanged;
 *   - the top-level `error` key is used only when the whole call cannot run (503),
 *     never alongside partial results.
 */
type ApiMembershipStatus = {
  active: boolean;
  state: 'active' | 'inactive';
  tier: string;
  expiresAt?: string;
  /** Raw pantry status (active | grace | expired | cancelled) when the record exists. */
  status?: string;
};

// SvelteKit forbids non-handler exports from a +server.ts; the contract's
// constants live in $lib/membership/contract.

function normalizeTier(tier: string | null | undefined, paymentId?: string | null): string {
  // Founders are stored as tier:'standard' with payment_id like 'genesis_1'
  const pid = String(paymentId || '').trim().toLowerCase();
  if (pid.startsWith('genesis_') || pid.startsWith('founder')) return 'founders';

  const value = String(tier || '').trim().toLowerCase();
  if (value === 'cook_plus' || value === 'cook-plus' || value === 'cook plus') return 'cook_plus';
  if (value === 'pro_kitchen' || value === 'pro-kitchen' || value === 'pro kitchen') return 'pro_kitchen';
  if (value === 'founders' || value === 'founder' || value === 'genesis_founder' || value === 'genesis-founder' || value === 'genesis founder') return 'founders';
  return 'member';
}

function parsePubkeys(url: URL): string[] {
  const raw = url.searchParams.get('pubkeys') || '';
  if (!raw) return [];

  return [...new Set(raw.split(',').map((pk) => pk.trim().toLowerCase()))].filter((pk) =>
    /^[a-f0-9]{64}$/.test(pk)
  );
}

function mockMembership(pubkey: string): ApiMembershipStatus {
  // Deterministic mock for local dev without the membership backend
  // configured. Only reachable when `dev` is true — production and
  // preview builds fail loudly instead (see below).
  const bucket = parseInt(pubkey.slice(-2), 16) % 5;
  if (bucket === 0) return { active: true, state: 'active', tier: 'cook_plus' };
  if (bucket === 1) return { active: true, state: 'active', tier: 'pro_kitchen' };
  if (bucket === 2) return { active: true, state: 'active', tier: 'founders' };
  return { active: false, state: 'inactive', tier: 'member' };
}

export const GET: RequestHandler = async ({ url, platform }) => {
  const pubkeys = parsePubkeys(url);
  if (pubkeys.length === 0) {
    return json({});
  }

  const limitedPubkeys = pubkeys.slice(0, 300);
  const results: Record<string, ApiMembershipStatus> = {};

  const membershipEnabled = String(
    platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED || ''
  ).toLowerCase();
  const apiSecret = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;

  if (membershipEnabled !== 'true' || !apiSecret) {
    // Local dev keeps the deterministic mock; everywhere else fails
    // loudly — this fallback once served mock data unconditionally,
    // masking misconfiguration in production.
    if (dev) {
      for (const pubkey of limitedPubkeys) {
        results[pubkey] = mockMembership(pubkey);
      }
      return json(results);
    }
    console.error(
      '[api/membership] MEMBERSHIP_ENABLED/RELAY_API_SECRET not configured — refusing to serve membership data'
    );
    return json({ error: 'membership lookup unavailable' }, { status: 503 });
  }

  const unresolved: string[] = [];
  const deadline = Date.now() + REQUEST_BUDGET_MS;

  const resolveOne = async (pubkey: string): Promise<void> => {
    if (Date.now() > deadline) {
      unresolved.push(pubkey);
      return;
    }
    const check = await checkMembership(pubkey, apiSecret!);
    if (check.state === 'unknown') {
      console.warn('[api/membership] Unresolved lookup for pubkey:', pubkey, check.reason);
      unresolved.push(pubkey);
      return;
    }
    if (!check.found) {
      results[pubkey] = { active: false, state: 'inactive', tier: 'member' };
      return;
    }

    const tier = normalizeTier(check.member.tier, check.member.payment_id);

    // Founders get lifetime access — ensure expiry is at least 10 years out
    let expiresAt = check.member.subscription_end || undefined;
    // Founders also need their `active` flag forced to true. The pantry
    // record sometimes has a stale `subscription_end` in the past
    // (lifetime members weren't always inserted with a far-future
    // expiry), and the lookup reads that as inactive. Without this
    // override, founders would silently fall into the paywall path on
    // any feature gated on `active && tier === 'founders'`.
    let active = check.state === 'active';
    if (tier === 'founders') {
      const tenYearsFromNow = new Date();
      tenYearsFromNow.setFullYear(tenYearsFromNow.getFullYear() + 10);
      const currentExpiry = expiresAt ? new Date(expiresAt) : new Date(0);
      if (currentExpiry < tenYearsFromNow) {
        expiresAt = tenYearsFromNow.toISOString();
      }
      active = true;
    }

    results[pubkey] = {
      active,
      state: active ? 'active' : 'inactive',
      tier,
      expiresAt,
      status: check.member.status
    };
  };

  // Bounded fan-out: up to LOOKUP_CONCURRENCY pantry requests in flight.
  // (Promise.all over 300 pubkeys used to open 300 at once.)
  const queue = [...limitedPubkeys];
  const workers = Array.from({ length: Math.min(LOOKUP_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const pubkey = queue.shift()!;
      await resolveOne(pubkey);
    }
  });
  await Promise.all(workers);

  const headers: Record<string, string> = {};
  if (unresolved.length > 0) {
    headers[UNRESOLVED_HEADER] = unresolved.join(',');
    // A partial answer must not be cached as if it were complete.
    headers['Cache-Control'] = 'no-store';
  } else {
    headers['Cache-Control'] = 'private, max-age=60';
  }
  return json(results, { headers });
};
