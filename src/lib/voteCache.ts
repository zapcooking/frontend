/**
 * Batched Vote Cache for Polls
 *
 * Efficiently fetches and caches kind:1018 vote events for multiple polls.
 *
 * Strategy (balances speed + accuracy):
 *   1. Microtask batching — multiple PollDisplay mounts in the same tick
 *      are combined into a single request.
 *   2. Primal cache fast path — batch-fetches votes from the caching server
 *      for a quick initial tally.
 *   3. Relay fetch — a single closeOnEose subscription fills any gaps the
 *      cache may have missed.
 *   4. Live subscription — one persistent subscription across all active
 *      polls catches new votes in real time.
 *
 * Each poll gets a reactive Svelte store that PollDisplay subscribes to.
 * Reference counting + delayed cleanup prevents thrashing on navigation.
 */

import { writable, type Readable } from 'svelte/store';
import { get } from 'svelte/store';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import type { NDKSubscription } from '@nostr-dev-kit/ndk';
import { ndk } from '$lib/nostr';
import { countVotes, type PollResults, type PollType } from '$lib/polls';
import { fetchVoteEventsFromPrimal } from '$lib/primalCache';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface VoteHandle {
  /** Reactive store of deduplicated vote results */
  results: Readable<PollResults>;
  /** Inject a locally-created vote for instant feedback */
  addLocalVote: (event: NDKEvent) => void;
  /** Release this handle (call in onDestroy) */
  cleanup: () => void;
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL STATE
// ═══════════════════════════════════════════════════════════════

/** Vote events per poll, deduped by event ID */
const voteEventsByPoll = new Map<string, Map<string, NDKEvent>>();

/** Svelte writable stores for reactive results per poll */
const resultStores = new Map<string, ReturnType<typeof writable<PollResults>>>();

/** Poll type needed for vote counting */
const pollTypeMap = new Map<string, PollType>();

/** Component reference counts for cleanup */
const refCounts = new Map<string, number>();

/** Polls that have completed their initial fetch */
const fetchedPolls = new Set<string>();

/** Microtask batch queue */
let pendingBatch: Set<string> | null = null;

/** Single live subscription for real-time vote updates */
let liveSub: NDKSubscription | null = null;
let liveSubPollIds = new Set<string>();

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const CLEANUP_DELAY_MS = 60_000;
const RELAY_TIMEOUT_MS = 8_000;

function emptyResults(): PollResults {
  return {
    counts: new Map(),
    totalVoters: 0,
    voters: new Set(),
    votesByPubkey: new Map()
  };
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Subscribe to vote results for a poll.
 * Multiple calls within the same microtask are batched into one fetch.
 */
export function getVoteResults(pollId: string, pollType: PollType): VoteHandle {
  if (!resultStores.has(pollId)) {
    resultStores.set(pollId, writable(emptyResults()));
    voteEventsByPoll.set(pollId, new Map());
  }
  pollTypeMap.set(pollId, pollType);
  refCounts.set(pollId, (refCounts.get(pollId) || 0) + 1);

  // Schedule fetch if we haven't loaded votes for this poll yet
  if (!fetchedPolls.has(pollId)) {
    scheduleBatchFetch(pollId);
  }

  const store = resultStores.get(pollId)!;

  return {
    results: { subscribe: store.subscribe },

    addLocalVote(event: NDKEvent) {
      addVoteEvent(pollId, event);
    },

    cleanup() {
      const count = (refCounts.get(pollId) || 0) - 1;
      if (count <= 0) {
        refCounts.delete(pollId);
        // Delayed cleanup — avoids thrashing on quick route changes
        setTimeout(() => {
          if (!refCounts.has(pollId)) {
            voteEventsByPoll.delete(pollId);
            resultStores.delete(pollId);
            pollTypeMap.delete(pollId);
            fetchedPolls.delete(pollId);
            refreshLiveSubscription();
          }
        }, CLEANUP_DELAY_MS);
      } else {
        refCounts.set(pollId, count);
      }
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL — event processing
// ═══════════════════════════════════════════════════════════════

function addVoteEvent(pollId: string, event: NDKEvent) {
  const cache = voteEventsByPoll.get(pollId);
  if (!cache || cache.has(event.id)) return;
  cache.set(event.id, event);
  recount(pollId);
}

function recount(pollId: string) {
  const cache = voteEventsByPoll.get(pollId);
  const pollType = pollTypeMap.get(pollId);
  const store = resultStores.get(pollId);
  if (!cache || !pollType || !store) return;
  store.set(countVotes([...cache.values()], pollType));
}

/** Route an incoming vote event to the correct poll cache */
function routeVoteEvent(event: NDKEvent) {
  const targetPoll = event.tags.find((t) => t[0] === 'e')?.[1];
  if (targetPoll && voteEventsByPoll.has(targetPoll)) {
    addVoteEvent(targetPoll, event);
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL — batch fetching
// ═══════════════════════════════════════════════════════════════

function scheduleBatchFetch(pollId: string) {
  if (!pendingBatch) {
    pendingBatch = new Set();
    queueMicrotask(() => {
      const batch = pendingBatch!;
      pendingBatch = null;
      executeBatch(batch);
    });
  }
  pendingBatch.add(pollId);
}

async function executeBatch(pollIds: Set<string>) {
  const ndkInstance = get(ndk);
  if (!ndkInstance || pollIds.size === 0) return;

  const idsToFetch = [...pollIds].filter((id) => !fetchedPolls.has(id));
  if (idsToFetch.length === 0) return;

  // Ensure empty maps exist before events arrive
  for (const id of idsToFetch) {
    if (!voteEventsByPoll.has(id)) {
      voteEventsByPoll.set(id, new Map());
    }
  }

  // Phase 1: Primal cache (fast — typically <1s)
  try {
    const events = await fetchVoteEventsFromPrimal(ndkInstance, idsToFetch);
    for (const event of events) {
      routeVoteEvent(event);
    }
  } catch (err) {
    console.debug('[VoteCache] Primal cache fetch skipped:', err);
  }

  // Phase 2: Relay fetch for completeness (single subscription for all polls)
  try {
    await new Promise<void>((resolve) => {
      const sub = ndkInstance.subscribe(
        { kinds: [1018 as number], '#e': idsToFetch },
        { closeOnEose: true }
      );

      sub.on('event', (e: NDKEvent) => routeVoteEvent(e));
      sub.on('eose', () => resolve());

      // Safety timeout
      setTimeout(() => {
        try { sub.stop(); } catch {}
        resolve();
      }, RELAY_TIMEOUT_MS);
    });
  } catch (err) {
    console.debug('[VoteCache] Relay fetch failed:', err);
  }

  // Mark as fetched so re-mounts don't re-fetch
  for (const id of idsToFetch) {
    fetchedPolls.add(id);
  }

  // Phase 3: Start/update the single live subscription
  refreshLiveSubscription();
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL — live subscription
// ═══════════════════════════════════════════════════════════════

function refreshLiveSubscription() {
  const ndkInstance = get(ndk);
  if (!ndkInstance) return;

  const activePollIds = [...refCounts.keys()];

  if (activePollIds.length === 0) {
    if (liveSub) {
      try { liveSub.stop(); } catch {}
      liveSub = null;
    }
    liveSubPollIds.clear();
    return;
  }

  // Only restart if the set of active polls changed
  const newIds = new Set(activePollIds);
  if (liveSub && setsEqual(newIds, liveSubPollIds)) return;

  if (liveSub) {
    try { liveSub.stop(); } catch {}
  }
  liveSubPollIds = newIds;

  liveSub = ndkInstance.subscribe(
    {
      kinds: [1018 as number],
      '#e': activePollIds,
      since: Math.floor(Date.now() / 1000)
    },
    { closeOnEose: false }
  );

  liveSub.on('event', (e: NDKEvent) => routeVoteEvent(e));
}

// ═══════════════════════════════════════════════════════════════
// UTIL
// ═══════════════════════════════════════════════════════════════

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}
