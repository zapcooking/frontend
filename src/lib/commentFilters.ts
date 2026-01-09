import type { NDKEvent } from '@nostr-dev-kit/ndk';

/**
 * Creates a subscription filter for fetching comments based on the event kind.
 * 
 * For longform content (kind 30023):
 * - Uses NIP-22 compliant #A filter with the address tag
 * - Subscribes to kind 1111 comments
 * 
 * For regular notes (kind 1):
 * - Uses NIP-10 compliant #e filter with the event ID
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
  // For longform (kind 30023), use NIP-22 #A filter
  if (event.kind === 30023) {
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
    if (dTag) {
      // Handle different ways pubkey may be accessed on NDKEvent objects
      // event.author.pubkey, event.author.hexpubkey, or event.pubkey depending on how the event was created
      const pubkey = event.author?.pubkey || event.author?.hexpubkey || event.pubkey;
      const addressTag = `${event.kind}:${pubkey}:${dTag}`;
      return {
        kinds: [1111],
        '#A': [addressTag]  // NIP-22: filter by root address
      };
    } else {
      // Fallback if no d tag - filter by event ID
      // Uses both kind 1 and 1111 for backwards compatibility with older events
      // that may not have properly structured longform metadata
      return {
        kinds: [1, 1111],
        '#e': [event.id]
      };
    }
  }
  
  // NIP-10 for kind 1 notes
  return {
    kinds: [1],
    '#e': [event.id]
  };
}
