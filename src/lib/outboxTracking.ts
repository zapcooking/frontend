import type NDK from '@nostr-dev-kit/ndk';
import { NDKUser } from '@nostr-dev-kit/ndk';

/**
 * Keep NDK's outbox tracker to the active user.
 *
 * With the outbox model on, `ndk.subscribe()` hands every author of every
 * subscription to the outbox tracker — explicit relay set or not — and the
 * tracker fetches `kinds [3, 10002]` for each author it hasn't seen (NDK
 * 2.10 `OutboxTracker.trackUsers` → `getRelayListForUsers`). The kind-3
 * contact lists are the cost: tens of KB each for prolific accounts. A
 * signed-in /feed with no interaction pulled 527 of them (30.8 MB) from
 * purplepag.es in 25 s once the login-time prewarm handed it ~500 follows,
 * and a signed-out /feed still pulled 1.3 MB for the 25 authors on screen.
 *
 * The app doesn't use that data to read: the Following feed plans its own
 * relay sets from `relayListCache` (kind 10002 only, on demand), and every
 * other feed reads from the pool. What the tracker is still needed for is
 * publishing: `calculateRelaySetFromEvent` takes the active user's write
 * relays from it. So automatic tracking is kept for the active user and
 * dropped for everyone else; author REQs then route to the pool, which is
 * what the explicit pool relay sets (#708/#716) already asked for.
 *
 * Returns a function that restores the original (tests).
 */
export function limitOutboxTracking(ndk: Pick<NDK, 'outboxTracker' | 'activeUser'>): () => void {
  const tracker = ndk.outboxTracker;
  if (!tracker) return () => {};
  const original = tracker.trackUsers;
  tracker.trackUsers = async (items: NDKUser[] | string[], skipCache?: boolean) => {
    const me = ndk.activeUser?.pubkey;
    const mine = (items as (NDKUser | string)[]).filter(
      (item) => me !== undefined && keyOf(item) === me
    );
    if (mine.length === 0) return [];
    return original.call(tracker, mine as NDKUser[] | string[], skipCache);
  };
  return () => {
    tracker.trackUsers = original;
  };
}

function keyOf(item: NDKUser | string): string {
  return item instanceof NDKUser ? item.pubkey : String(item);
}
