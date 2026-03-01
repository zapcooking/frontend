import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { lookupMember } from '$lib/membershipApi.server';

type ApiMembershipStatus = {
  active: boolean;
  tier: string;
  expiresAt?: string;
};

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
  // Deterministic mock for local/dev environments without membership backend configured.
  const bucket = parseInt(pubkey.slice(-2), 16) % 5;
  if (bucket === 0) return { active: true, tier: 'cook_plus' };
  if (bucket === 1) return { active: true, tier: 'pro_kitchen' };
  if (bucket === 2) return { active: true, tier: 'founders' };
  return { active: false, tier: 'member' };
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

  // TODO: wire this endpoint to the canonical membership source for all environments.
  const shouldUseLiveLookup = membershipEnabled === 'true' && Boolean(apiSecret);

  if (!shouldUseLiveLookup) {
    for (const pubkey of limitedPubkeys) {
      results[pubkey] = mockMembership(pubkey);
    }
    return json(results);
  }

  await Promise.all(
    limitedPubkeys.map(async (pubkey) => {
      try {
        const lookup = await lookupMember(pubkey, apiSecret!);
        if (!lookup.found) {
          results[pubkey] = { active: false, tier: 'member' };
          return;
        }

        const tier = normalizeTier(lookup.member?.tier, lookup.member?.payment_id);

        // Founders get lifetime access — ensure expiry is at least 10 years out
        let expiresAt = lookup.member?.subscription_end || undefined;
        if (tier === 'founders') {
          const tenYearsFromNow = new Date();
          tenYearsFromNow.setFullYear(tenYearsFromNow.getFullYear() + 10);
          const currentExpiry = expiresAt ? new Date(expiresAt) : new Date(0);
          if (currentExpiry < tenYearsFromNow) {
            expiresAt = tenYearsFromNow.toISOString();
          }
        }

        results[pubkey] = {
          active: lookup.isActive,
          tier,
          expiresAt
        };
      } catch (error) {
        console.warn('[api/membership] Failed lookup for pubkey:', pubkey, error);
        results[pubkey] = { active: false, tier: 'member' };
      }
    })
  );

  return json(results);
};
