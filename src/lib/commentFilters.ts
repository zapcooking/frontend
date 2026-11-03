import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';

// NDKFilter's kind list defaults to the NDKKind enum, which predates kind
// 1111; instantiating the generic keeps comment kinds assignable.
type ThreadFilter = NDKFilter<number>;
import { getThreadRootId } from './thread/replyParent';

/**
 * Determine whether an event is an addressable (parameterized-replaceable)
 * root suitable for NIP-22 comment structure.
 *
 * Per NIP-01, addressable events have a kind in the range 30000–39999 and
 * carry a `d` tag identifying the parameter. An event in the addressable
 * kind range that lacks a `d` tag is malformed — this predicate returns
 * false for that case, so callers route the event through the NIP-10
 * fallback path instead of the non-canonical no-d-tag branch.
 *
 * Used by both `createCommentFilter` (to pick the right subscription
 * filter shape) and `postComment`'s kind derivation (to choose between
 * kind 1 and kind 1111 on publish). Keeping the predicate in one place
 * prevents the two code paths from drifting — a mismatch would cause
 * published comments to not be fetched by the subscription.
 */
export function isAddressableRoot(event: NDKEvent): boolean {
  const kind = event.kind ?? 1;
  if (kind < 30000 || kind >= 40000) return false;
  return event.tags.some((tag) => tag[0] === 'd');
}

/** Cap per filter, matching the iOS thread subscription. */
const THREAD_FILTER_LIMIT = 500;

/**
 * Creates the subscription filters for fetching a note's whole thread.
 *
 * For addressable events with a `d` tag (NIP-01, e.g. kind 30023 long-form):
 * - Uses NIP-22 compliant `#A` filter with the address tag
 * - Subscribes to kind 1111 comments
 *
 * For everything else, returns TWO SIBLING filters that NDK sends as one
 * REQ (relay-side OR). Within a single filter object conditions are ANDed,
 * so merging `#e` and `#E` would match nothing beyond top-level comments:
 *
 * - `#e` targets: NIP-10 tree — kind-1 descendants carry the root in a
 *   lowercase `e` — plus kind-5 deletions of thread events.
 * - `#E` targets: NIP-22 tree — a nested comment carries only its
 *   immediate parent in lowercase `e` and the ROOT in uppercase `E`, so
 *   the comment-to-comment branches below the first reply are invisible
 *   to `#e` alone.
 *
 * Targets are the conversation root (for a comment focus, its uppercase
 * `E` — see `getThreadRootId`) AND the focal id. The focal id keeps
 * comment subtrees that anchor on a mid-thread kind-1 note reachable
 * without climbing NIP-10 above the anchor, which would drop the branch.
 *
 * @param event - The focused event to fetch the thread for
 * @returns Subscription filters (pass the array to NDK.subscribe as-is)
 */
export function createCommentFilter(event: NDKEvent): ThreadFilter[] {
  if (isAddressableRoot(event)) {
    const dTag = event.tags.find((t) => t[0] === 'd')![1];
    // Handle different ways pubkey may be accessed on NDKEvent objects:
    // event.author.pubkey, event.author.hexpubkey, or event.pubkey depending
    // on how the event was created.
    const pubkey = event.author?.pubkey || event.author?.hexpubkey || event.pubkey;
    const addressTag = `${event.kind}:${pubkey}:${dTag}`;
    return [
      {
        kinds: [1111],
        '#A': [addressTag] // NIP-22: filter by root address
      }
    ];
  }

  const rootId = getThreadRootId(event) ?? event.id;
  const targets = rootId !== event.id ? [rootId, event.id] : [event.id];
  return [
    { kinds: [1, 5, 1111], '#e': targets, limit: THREAD_FILTER_LIMIT },
    { kinds: [1111], '#E': targets, limit: THREAD_FILTER_LIMIT }
  ];
}
