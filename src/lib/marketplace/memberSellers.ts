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

/**
 * Did one subscription get a real answer? Only an EOSE is one: a timeout, a
 * dropped socket or a CLOSED (auth-required, rate limit) is not, so it
 * neither counts as "this relay has nothing" nor starts the listings' grace.
 */
export function pageAnswered(r: {
  done: Record<string, boolean>;
  closed: Record<string, string>;
}): boolean {
  return r.done.p === true && !('p' in r.closed);
}

export interface PageEvent {
  id: string;
  pubkey: string;
  created_at: number;
}

export interface Page {
  events: PageEvent[];
  /** The relay answered in full (EOSE). A timeout, a dropped socket or a CLOSED is not an answer. */
  answered: boolean;
}

export interface Authors {
  authors: Set<string>;
  /** At least one page was answered: an empty result is real, not a failure. */
  answered: boolean;
  /** Some pages were answered and a later one wasn't (the connection dropped part-way): usable, not complete. */
  partial: boolean;
}

/**
 * The authors in a relay's history of some kind, newest first, paged with
 * an inclusive `until`. The cursor stays on the oldest second seen while
 * pages keep bringing new events (a page can end part-way through a second;
 * repeats are skipped by id), and steps back a second once a page brings
 * nothing new. Stops at an empty page, a page newer than asked for (the
 * relay ignored `until`), or after `maxPages`.
 *
 * Known limit: when a single second holds more events than a relay returns
 * per page, the rest of that second can't be reached (nostr has no offset).
 */
export async function collectAuthors(
  fetchPage: (until: number | undefined) => Promise<Page>,
  maxPages: number
): Promise<Authors> {
  const authors = new Set<string>();
  const seen = new Set<string>();
  let answered = false;
  let partial = false;
  let until: number | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(until);
    if (page.answered) answered = true;
    else if (answered) partial = true;
    if (page.events.length === 0) break;
    const oldest = Math.min(...page.events.map((e) => e.created_at));
    if (until !== undefined && oldest > until) break;
    let fresh = 0;
    for (const e of page.events) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      authors.add(e.pubkey);
      fresh++;
    }
    until = fresh > 0 ? oldest : oldest - 1;
  }
  return { authors, answered, partial };
}

export interface ListingEvent {
  id: string;
  pubkey: string;
  kind: number;
}

/**
 * The relay events the market may show: a listing kind, by a member, with
 * a valid id and signature. The relays are untrusted: they could send a
 * kind or an author that wasn't asked for, or an event with a member's
 * pubkey that the member never signed. A bad event is dropped on its own.
 */
export function memberListingEvents<E extends ListingEvent>(
  events: E[],
  o: { members: ReadonlySet<string>; kinds: readonly number[]; verify: (e: E) => boolean }
): E[] {
  return events.filter((e) => {
    if (!o.kinds.includes(e.kind) || !o.members.has(e.pubkey)) return false;
    try {
      return o.verify(e);
    } catch {
      return false;
    }
  });
}
