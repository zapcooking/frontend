import type { NDKEvent } from '@nostr-dev-kit/ndk';

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

/**
 * Creates a subscription filter for fetching comments based on the event kind.
 *
 * For addressable events with a `d` tag (NIP-01, e.g. kind 30023 long-form):
 * - Uses NIP-22 compliant `#A` filter with the address tag
 * - Subscribes to kind 1111 comments
 *
 * For regular notes (kind 1) and malformed addressable events (no `d` tag):
 * - Uses NIP-10 compliant `#e` filter with the event ID
 * - Subscribes to kind 1 replies
 *
 * @param event - The event to fetch comments for
 * @returns Subscription filter object compatible with NDK.subscribe()
 */
export function createCommentFilter(event: NDKEvent): {
  kinds: number[];
  '#A'?: string[];
  '#e'?: string[];
} {
  if (isAddressableRoot(event)) {
    const dTag = event.tags.find((t) => t[0] === 'd')![1];
    // Handle different ways pubkey may be accessed on NDKEvent objects:
    // event.author.pubkey, event.author.hexpubkey, or event.pubkey depending
    // on how the event was created.
    const pubkey = event.author?.pubkey || event.author?.hexpubkey || event.pubkey;
    const addressTag = `${event.kind}:${pubkey}:${dTag}`;
    return {
      kinds: [1111],
      '#A': [addressTag] // NIP-22: filter by root address
    };
  }

  // Special case for kind 30023 without a `d` tag: still look for legacy
  // kind-1 replies alongside kind 1111 for backwards compatibility with
  // older events that may not have properly structured longform metadata.
  if (event.kind === 30023) {
    return {
      kinds: [1, 1111],
      '#e': [event.id]
    };
  }

  // NIP-10 for kind 1 notes (and anything else non-addressable)
  return {
    kinds: [1],
    '#e': [event.id]
  };
}
