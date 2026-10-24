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
  /** Pantry's own verdict: status active OR grace, with subscription_end in the future. */
  is_member?: boolean;
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

/** Upper bound on one pantry lookup. */
export const PANTRY_TIMEOUT_MS = 5000;

/** Pantry statuses that count as a member (mirrors members-relay `is_member`). */
const ACTIVE_STATUSES = new Set(['active', 'grace']);

export type MembershipState = 'active' | 'inactive' | 'unknown';

/**
 * Tri-state answer. `unknown` means the question could not be answered
 * (pantry down, timed out, rejected the server's credential, returned
 * garbage) and MUST NOT be treated as "not a member": callers either keep
 * their previous answer, retry, or show a neutral state.
 */
export type MembershipCheck =
  | { state: 'active'; found: true; member: MemberRecord; isExpired: false }
  | { state: 'inactive'; found: true; member: MemberRecord; isExpired: boolean }
  | { state: 'inactive'; found: false; reason: 'not-found' | 'invalid-pubkey' }
  | { state: 'unknown'; reason: string };

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
 *
 * Throws on every non-404 failure (network, timeout, 401/403, 429, 5xx,
 * bad JSON); see `checkMembership` for the never-throwing tri-state form.
 */
export async function lookupMember(
  pubkey: string,
  apiSecret: string,
  opts: { timeoutMs?: number } = {}
): Promise<MemberCheckResult> {
  const pk = normalizeMemberPubkey(pubkey);
  if (!pk) throw new InvalidPubkeyError();
  const res = await fetch(`https://pantry.zap.cooking/api/members/${encodeURIComponent(pk)}`, {
    headers: {
      'Authorization': `Bearer ${apiSecret}`
    },
    // A pantry that never answers used to hold the Worker (and the caller)
    // open indefinitely; now it is one more "unknown" answer.
    signal: AbortSignal.timeout(opts.timeoutMs ?? PANTRY_TIMEOUT_MS)
  });

  if (!res.ok) {
    if (res.status === 404) {
      return { found: false };
    }
    throw new Error(`Failed to fetch member: ${res.status}`);
  }

  const member = await res.json();

  const now = new Date();
  let isExpired = false;
  if (member.subscription_end) {
    const endDate = new Date(member.subscription_end);
    if (endDate < now) isExpired = true;
  }

  // "Active" follows the pantry's own verdict (`is_member`: status active OR
  // grace, subscription_end in the future) — the same rule the members relay
  // applies for NIP-42 access. The old `status === 'active'` test read every
  // grace-period member as a non-member. Fall back to the same rule when an
  // older pantry build omits the field.
  const isActive =
    typeof member.is_member === 'boolean'
      ? member.is_member
      : ACTIVE_STATUSES.has(String(member.status)) && !isExpired;

  return {
    found: true,
    isActive,
    isExpired,
    member: {
      pubkey: member.pubkey,
      tier: member.tier,
      status: member.status,
      is_member: typeof member.is_member === 'boolean' ? member.is_member : undefined,
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
 * Tri-state membership check. Never throws.
 *
 * - active:   pantry found the member and says they are a member (active or grace)
 * - inactive: pantry answered and the pubkey is not a member (404, expired,
 *             cancelled), or the input is not a pubkey at all
 * - unknown:  pantry could not be asked or did not answer properly (network
 *             error, timeout, 401/403 credential problem, 429, 5xx, bad JSON)
 */
export async function checkMembership(
  pubkey: string,
  apiSecret: string,
  opts: { timeoutMs?: number } = {}
): Promise<MembershipCheck> {
  try {
    const result = await lookupMember(pubkey, apiSecret, opts);
    if (!result.found) return { state: 'inactive', found: false, reason: 'not-found' };
    if (result.isActive) {
      return { state: 'active', found: true, member: result.member, isExpired: false };
    }
    return { state: 'inactive', found: true, member: result.member, isExpired: result.isExpired };
  } catch (err) {
    if (err instanceof InvalidPubkeyError) {
      return { state: 'inactive', found: false, reason: 'invalid-pubkey' };
    }
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { state: 'unknown', reason };
  }
}

/**
 * Boolean convenience for gates that only need "is this an active member":
 * true only for a confirmed active member. An `unknown` answer reads as
 * false here — gates that want to tell an outage apart from a non-member
 * must call `checkMembership` and branch on `state`.
 */
export async function hasActiveMembership(pubkey: string, apiSecret: string): Promise<boolean> {
  const check = await checkMembership(pubkey, apiSecret);
  return check.state === 'active';
}
