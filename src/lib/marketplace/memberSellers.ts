/**
 * Who the market shows: listings from sellers who are Zap Cooking members.
 *
 * The marketplace relays are open: anyone can publish a NIP-99 listing
 * there, and in October 2026 the newest thousands were almost all one
 * seller's injectable drugs. The market no longer lists them; it lists
 * members' listings only ($lib/marketplace/memberListings).
 *
 * Pure (no relays, no `$app`), so the rules are testable.
 */

/**
 * Sellers whose membership is active, of any tier. Not the shop-badge tier
 * list (KITCHEN_MEMBER_TIERS): the pantry passes tiers through as it names
 * them (`standard` for most members), and the app gates on "active member",
 * not on a tier. An unresolved lookup is not a member here: a seller the
 * app couldn't check is left out until it can.
 */
export function activeMemberSellers(
  statuses: Record<string, { active?: boolean; unresolved?: boolean } | undefined>
): Set<string> {
  const out = new Set<string>();
  for (const [pubkey, s] of Object.entries(statuses)) {
    if (s?.active === true && !s.unresolved) out.add(pubkey);
  }
  return out;
}

/** True when no seller could be checked at all (the membership service is down): an error, not an empty market. */
export function membershipUnavailable(
  statuses: Record<string, { unresolved?: boolean } | undefined>
): boolean {
  const all = Object.values(statuses);
  return all.length > 0 && all.every((s) => s?.unresolved === true);
}

export interface PageEvent {
  pubkey: string;
  created_at: number;
}

/**
 * The authors in a relay's history of some kind, newest first, paged with
 * `until` (inclusive on most relays, so each next page starts one second
 * before the oldest seen). Stops at an empty page, a page that doesn't get
 * older, or after `maxPages`.
 */
export async function collectAuthors(
  fetchPage: (until: number | undefined) => Promise<PageEvent[]>,
  maxPages: number
): Promise<Set<string>> {
  const authors = new Set<string>();
  let until: number | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(until);
    if (page.length === 0) break;
    for (const e of page) authors.add(e.pubkey);
    const oldest = Math.min(...page.map((e) => e.created_at));
    if (until !== undefined && oldest >= until) break;
    until = oldest - 1;
  }
  return authors;
}
