/**
 * Zap Poll Cache (kind 6969)
 *
 * Fetches kind:9735 zap receipts for zap polls and parses the embedded
 * kind:9734 zap request to extract the poll_option tag (choice ID).
 * Aggregates sats per option.
 *
 * Follows the Primal convention:
 *   - poll_option tag value = choice ID string (not index)
 *   - Zap polls use kind 6969
 */

import { writable, get, type Readable } from 'svelte/store';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
import { ndk } from '$lib/nostr';
import { extractZapAmountSats } from '$lib/zapAmount';
import { countZapVotes, type ZapPollResults, type ParsedZapVote } from '$lib/polls';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ZapPollHandle {
  results: Readable<ZapPollResults>;
  addLocalZap: (optionId: string, amountSats: number, pubkey: string) => void;
  cleanup: () => void;
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL STATE
// ═══════════════════════════════════════════════════════════════

const votesByPoll = new Map<string, ParsedZapVote[]>();
const resultStores = new Map<string, ReturnType<typeof writable<ZapPollResults>>>();
const refCounts = new Map<string, number>();
const fetchedPolls = new Set<string>();

let pendingBatch: Set<string> | null = null;
let liveSub: NDKSubscription | null = null;
let liveSubPollIds = new Set<string>();

const CLEANUP_DELAY_MS = 60_000;
const RELAY_TIMEOUT_MS = 10_000;
const BATCH_CHUNK_SIZE = 30;

function emptyResults(): ZapPollResults {
  return {
    satsByOption: new Map(),
    totalSats: 0,
    totalVoters: 0,
    voters: new Set(),
    votesByPubkey: new Map()
  };
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export function getZapPollResults(pollId: string): ZapPollHandle {
  if (!resultStores.has(pollId)) {
    resultStores.set(pollId, writable(emptyResults()));
    votesByPoll.set(pollId, []);
  }
  refCounts.set(pollId, (refCounts.get(pollId) || 0) + 1);

  if (!fetchedPolls.has(pollId)) {
    scheduleBatchFetch(pollId);
  }

  const store = resultStores.get(pollId)!;

  return {
    results: { subscribe: store.subscribe },

    addLocalZap(optionId: string, amountSats: number, pubkey: string) {
      const votes = votesByPoll.get(pollId);
      if (!votes) return;
      const localId = `local-${Date.now()}-${Math.random()}`;
      votes.push({ zapperPubkey: pubkey, optionId, amountSats, receiptId: localId });
      recount(pollId);
    },

    cleanup() {
      const count = (refCounts.get(pollId) || 0) - 1;
      if (count <= 0) {
        refCounts.delete(pollId);
        setTimeout(() => {
          if (!refCounts.has(pollId)) {
            votesByPoll.delete(pollId);
            resultStores.delete(pollId);
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

function parseZapReceipt(event: NDKEvent): ParsedZapVote | null {
  const { sats: amountSats } = extractZapAmountSats(event);
  if (amountSats <= 0) return null;

  const descTag = event.tags.find(t => t[0] === 'description')?.[1];
  if (!descTag) return null;

  let zapRequest: { pubkey?: string; tags?: string[][] };
  try {
    zapRequest = JSON.parse(descTag);
  } catch {
    return null;
  }

  // Extract poll_option — this is the choice ID string (Primal convention)
  const pollOptionTag = zapRequest.tags?.find(t => t[0] === 'poll_option');
  if (!pollOptionTag?.[1]) return null;

  const zapperPubkey = zapRequest.pubkey || event.pubkey;

  return {
    zapperPubkey,
    optionId: pollOptionTag[1],
    amountSats,
    receiptId: event.id
  };
}

function addZapReceipt(pollId: string, event: NDKEvent) {
  const votes = votesByPoll.get(pollId);
  if (!votes) return;
  if (votes.some(v => v.receiptId === event.id)) return;

  const parsed = parseZapReceipt(event);
  if (parsed) {
    votes.push(parsed);
    recount(pollId);
  }
}

function recount(pollId: string) {
  const votes = votesByPoll.get(pollId);
  const store = resultStores.get(pollId);
  if (!votes || !store) return;
  store.set(countZapVotes(votes));
}

function routeZapReceipt(event: NDKEvent) {
  for (const tag of event.tags) {
    if (tag[0] === 'e' && tag[1] && votesByPoll.has(tag[1])) {
      addZapReceipt(tag[1], event);
      return;
    }
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

  const idsToFetch = [...pollIds].filter(id => !fetchedPolls.has(id));
  if (idsToFetch.length === 0) return;

  for (const id of idsToFetch) {
    if (!votesByPoll.has(id)) votesByPoll.set(id, []);
  }

  const chunks: string[][] = [];
  for (let i = 0; i < idsToFetch.length; i += BATCH_CHUNK_SIZE) {
    chunks.push(idsToFetch.slice(i, i + BATCH_CHUNK_SIZE));
  }

  for (const chunk of chunks) {
    let success = false;
    try {
      await new Promise<void>((resolve) => {
        const sub = ndkInstance.subscribe(
          { kinds: [9735 as number], '#e': chunk },
          { closeOnEose: true }
        );

        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const finish = () => {
          if (settled) return;
          settled = true;
          if (timeoutId !== null) clearTimeout(timeoutId);
          success = true;
          resolve();
        };

        sub.on('event', (e: NDKEvent) => routeZapReceipt(e));
        sub.on('eose', finish);

        timeoutId = setTimeout(() => {
          try { sub.stop(); } catch {}
          if (!settled) { settled = true; resolve(); }
        }, RELAY_TIMEOUT_MS);
      });
    } catch (err) {
      console.debug('[ZapPollCache] Relay fetch failed:', err);
    }

    if (success) {
      for (const id of chunk) fetchedPolls.add(id);
    }
  }

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
    if (liveSub) { try { liveSub.stop(); } catch {} liveSub = null; }
    liveSubPollIds.clear();
    return;
  }

  const newIds = new Set(activePollIds);
  if (liveSub && setsEqual(newIds, liveSubPollIds)) return;

  if (liveSub) { try { liveSub.stop(); } catch {} }
  liveSubPollIds = newIds;

  liveSub = ndkInstance.subscribe(
    { kinds: [9735 as number], '#e': activePollIds, since: Math.floor(Date.now() / 1000) },
    { closeOnEose: false }
  );
  liveSub.on('event', (e: NDKEvent) => routeZapReceipt(e));
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) { if (!b.has(item)) return false; }
  return true;
}
