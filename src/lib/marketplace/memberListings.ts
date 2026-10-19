import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { collect, type Filter, type NostrEvent } from '$lib/relayCollect';
import { getMembership } from '$lib/stores/membershipStatus';
import { MARKETPLACE_RELAYS, productsFromEvents } from './products';
import { STALL_KIND, PRODUCT_KIND, PRODUCT_KIND_LEGACY, type Product } from './types';
import { activeMemberSellers, collectAuthors, membershipUnavailable } from './memberSellers';

/**
 * The market's listings: members' only ($lib/marketplace/memberSellers).
 *
 * Membership is checked per pubkey, so the sellers come first: every shop
 * owner (kind 30017, the shop a seller makes on Zap Cooking — a short
 * history, ~250 shops in all) plus the sellers of the newest listings;
 * then their membership; then those members' listings, by author. Members'
 * listings are found at any position in the relays' history, not only
 * when they happen to be among the newest hundred (which a flood buries).
 *
 * Raw anonymous reads ($lib/relayCollect), each with a short timeout: one of
 * the two marketplace relays often never answers, and must not hold the
 * page (it used to cost the full NDK timeout, 15 s).
 */

const PAGE = 100;
/** Shop history pages per relay (~250 shops existed in Oct 2026). */
const STALL_PAGES = 10;
const PAGE_TIMEOUT_MS = 3000;
/** Members' listings: settle this long after the first relay finishes... */
const LISTINGS_GRACE_MS = 800;
/** ...and never later than this. */
const LISTINGS_TIMEOUT_MS = 5000;
/** The sellers found are reused for a few minutes (the shop list barely changes). */
const SELLERS_TTL_MS = 5 * 60 * 1000;

let sellers: { at: number; pubkeys: Promise<Set<string>> } | null = null;

function page(url: string, kinds: number[]) {
  return async (until: number | undefined) => {
    const filter: Filter = { kinds, limit: PAGE };
    if (until !== undefined) filter.until = until;
    const r = await collect(url, { p: filter }, { timeoutMs: PAGE_TIMEOUT_MS });
    return r.events.p ?? [];
  };
}

/** Every shop owner, plus the sellers of the newest listings, on the marketplace relays. */
export function candidateSellers(): Promise<Set<string>> {
  if (sellers && Date.now() - sellers.at < SELLERS_TTL_MS) return sellers.pubkeys;
  const pubkeys = Promise.all(
    MARKETPLACE_RELAYS.flatMap((url) => [
      collectAuthors(page(url, [STALL_KIND]), STALL_PAGES),
      collectAuthors(page(url, [PRODUCT_KIND, PRODUCT_KIND_LEGACY]), 1)
    ])
  ).then((sets) => new Set(sets.flatMap((s) => [...s])));
  sellers = { at: Date.now(), pubkeys };
  pubkeys.catch(() => (sellers = null));
  return pubkeys;
}

/**
 * One filter on every relay, merged by id; settles LISTINGS_GRACE_MS after
 * the first relay finishes, or at the timeout, whichever comes first.
 */
async function graceUnion(urls: string[], filter: Filter): Promise<NostrEvent[]> {
  const controller = new AbortController();
  let grace: ReturnType<typeof setTimeout> | undefined;
  const runs = urls.map((url) =>
    collect(url, { p: filter }, { timeoutMs: LISTINGS_TIMEOUT_MS, signal: controller.signal }).then(
      (r) => {
        if (r.done.p && grace === undefined)
          grace = setTimeout(() => controller.abort(), LISTINGS_GRACE_MS);
        return r.events.p ?? [];
      }
    )
  );
  const lists = await Promise.all(runs);
  clearTimeout(grace);
  const byId = new Map<string, NostrEvent>();
  for (const e of lists.flat()) byId.set(e.id, e);
  return [...byId.values()];
}

export interface MemberListings {
  products: Product[];
  staleCount: number;
  /** The member sellers whose listings these are. */
  members: Set<string>;
  /** The membership service couldn't answer for anyone: show an error, not an empty market. */
  unavailable: boolean;
}

/** Members' active, fresh listings with a photo, newest first. */
export async function fetchMemberProducts(ndk: NDK): Promise<MemberListings> {
  const candidates = await candidateSellers();
  const statuses = await getMembership([...candidates]);
  const members = activeMemberSellers(statuses);
  if (members.size === 0) {
    return { products: [], staleCount: 0, members, unavailable: membershipUnavailable(statuses) };
  }
  const raw = await graceUnion(MARKETPLACE_RELAYS, {
    kinds: [PRODUCT_KIND, PRODUCT_KIND_LEGACY],
    authors: [...members],
    limit: 500
  });
  const { fresh, staleCount } = productsFromEvents(
    raw.map((e) => new NDKEvent(ndk, e as ConstructorParameters<typeof NDKEvent>[1]))
  );
  return { products: fresh, staleCount, members, unavailable: false };
}
