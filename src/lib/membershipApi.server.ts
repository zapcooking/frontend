/**
 * Server-side membership API utilities.
 *
 * Uses the direct single-member lookup endpoint on pantry.zap.cooking
 * for O(1) lookups instead of fetching the full member list.
 */

export interface MemberRecord {
  pubkey: string;
  tier: string;
  status: string;
  subscription_end: string;
  subscription_start: string;
  payment_id: string;
  payment_method: string;
  created_at: string;
  updated_at: string;
}

export interface MemberLookupResult {
  found: true;
  isActive: boolean;
  isExpired: boolean;
  member: MemberRecord;
}

export interface MemberNotFoundResult {
  found: false;
}

export type MemberCheckResult = MemberLookupResult | MemberNotFoundResult;

/**
 * Look up a single member by pubkey via the pantry API.
 * Returns the member record with active/expired status, or { found: false }.
 */
export async function lookupMember(pubkey: string, apiSecret: string): Promise<MemberCheckResult> {
  const res = await fetch(`https://pantry.zap.cooking/api/members/${pubkey}`, {
    headers: {
      'Authorization': `Bearer ${apiSecret}`
    }
  });

  if (!res.ok) {
    if (res.status === 404) {
      return { found: false };
    }
    throw new Error(`Failed to fetch member: ${res.status}`);
  }

  const member = await res.json();

  const now = new Date();
  let isActive = member.status === 'active';
  let isExpired = false;

  if (member.subscription_end) {
    const endDate = new Date(member.subscription_end);
    if (endDate < now) {
      isExpired = true;
      isActive = false;
    }
  }

  return {
    found: true,
    isActive,
    isExpired,
    member: {
      pubkey: member.pubkey,
      tier: member.tier,
      status: member.status,
      subscription_end: member.subscription_end,
      subscription_start: member.subscription_start,
      payment_id: member.payment_id,
      payment_method: member.payment_method,
      created_at: member.created_at,
      updated_at: member.updated_at
    }
  };
}

/**
 * Check if a pubkey has an active (non-expired) membership.
 * Returns true if the member exists and their subscription hasn't expired.
 */
export async function hasActiveMembership(pubkey: string, apiSecret: string): Promise<boolean> {
  try {
    const result = await lookupMember(pubkey, apiSecret);
    return result.found && result.isActive;
  } catch {
    return false;
  }
}
