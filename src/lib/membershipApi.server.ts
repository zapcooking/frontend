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

const HEX64 = /^[0-9a-f]{64}$/;

/** Thrown when a caller passes something that is not a hex pubkey. */
export class InvalidPubkeyError extends Error {
  constructor() {
    super('Invalid pubkey: expected 64 lowercase hex characters');
    this.name = 'InvalidPubkeyError';
  }
}

/**
 * Canonical form of a pubkey for the pantry API: trimmed, lowercase, 64 hex.
 * Returns null for anything else (npub, uppercase-with-garbage, paths, empty).
 *
 * Uppercase hex is accepted and lowercased: the pantry SQL match is
 * case-sensitive, so an uppercase pubkey used to read as "not found".
 */
export function normalizeMemberPubkey(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  return HEX64.test(v) ? v : null;
}

/**
 * Look up a single member by pubkey via the pantry API.
 * Returns the member record with active/expired status, or { found: false }.
 *
 * The pubkey is validated before it is interpolated into the URL: the
 * request carries the server's bearer, so an unvalidated value (e.g. a
 * body-supplied "../stats") would let a caller reach other authenticated
 * pantry endpoints through this server. Throws InvalidPubkeyError.
 */
export async function lookupMember(pubkey: string, apiSecret: string): Promise<MemberCheckResult> {
  const pk = normalizeMemberPubkey(pubkey);
  if (!pk) throw new InvalidPubkeyError();
  const res = await fetch(`https://pantry.zap.cooking/api/members/${encodeURIComponent(pk)}`, {
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
