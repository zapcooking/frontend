import type { Filter } from 'nostr-tools';
import {
  SAVED_LIST_READ_TIMEOUT_MS,
  newestList,
  type ListEvent,
  type ListRelayAnswer
} from '$lib/savedListSafety';

/**
 * Relay reads and session memory for safe "Saved" list edits — the I/O side
 * of $lib/savedListSafety (which holds the rules).
 */

/** One relay, one REQ, newest matching event, to EOSE or the timeout. */
export type QueryList = (
  url: string,
  filter: Filter,
  timeoutMs: number
) => Promise<ListRelayAnswer>;

export const queryRelayNewest: QueryList = async (url, filter, timeoutMs) => {
  const { Relay } = await import('nostr-tools/relay');
  return new Promise<ListRelayAnswer>((resolve) => {
    let relay: { close(): void } | null = null;
    let list: ListEvent | null = null;
    let done = false;
    // One exit for EOSE, close, error and the timeout; a relay that connects
    // after the timeout is closed as soon as it arrives.
    const finish = (answered: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ url, ok: answered, list: answered ? list : null });
      try {
        relay?.close();
      } catch {
        /* ignore */
      }
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    Relay.connect(url).then(
      (r) => {
        relay = r;
        if (done) {
          try {
            r.close();
          } catch {
            /* ignore */
          }
          return;
        }
        r.subscribe([filter], {
          eoseTimeout: timeoutMs + 1000,
          onevent: (e: ListEvent) => {
            if (!list || e.created_at > list.created_at) list = e;
          },
          // Settles before closing the relay, so the onclose that closing
          // fires can't record this answer as "no answer".
          oneose: () => finish(true),
          onclose: () => finish(false)
        });
      },
      () => finish(false)
    );
  });
};

/**
 * Read one of the member's lists from every relay lists are written to
 * (listRelayUrls — the same set My Kitchen reads from), waiting for each
 * relay (bounded by SAVED_LIST_READ_TIMEOUT_MS, all in parallel).
 */
export async function readListFromRelays(
  pubkey: string,
  dTag: string,
  query: QueryList = queryRelayNewest
): Promise<{ answers: ListRelayAnswer[]; ownWrite: string[] }> {
  const { getOwnWriteRelays, listRelayUrls } = await import('$lib/nip65Routing');
  const [ownWrite, urls] = await Promise.all([
    getOwnWriteRelays(pubkey).catch(() => [] as string[]),
    listRelayUrls(pubkey)
  ]);
  const filter: Filter = { kinds: [30001], authors: [pubkey], '#d': [dTag], limit: 1 };
  const answers = await Promise.all(urls.map((u) => query(u, filter, SAVED_LIST_READ_TIMEOUT_MS)));
  // A relay can only answer for this author and d tag; drop anything else.
  for (const a of answers) {
    if (a.list && (a.list as ListEvent & { pubkey?: string }).pubkey !== pubkey) a.list = null;
  }
  return { answers, ownWrite };
}

// ── Session memory ──────────────────────────────────────────────

/**
 * Pubkeys whose key this browser generated this session (signup). Such an
 * account has no lists anywhere, so its first save needs no network read.
 * Memory only: a reload ends "this session".
 */
const freshAccounts = new Set<string>();

export function markFreshAccount(pubkey: string): void {
  if (pubkey) freshAccounts.add(pubkey);
}

export function isFreshAccount(pubkey: string): boolean {
  return freshAccounts.has(pubkey);
}

/** The newest version of each list seen or published this session, per account. */
const seenLists = new Map<string, ListEvent>();
const seenKey = (pubkey: string, dTag: string) => `${pubkey}:${dTag}`;

export function noteListSeen(pubkey: string, dTag: string, list: ListEvent | null): void {
  if (!list) return;
  const k = seenKey(pubkey, dTag);
  const newest = newestList(seenLists.get(k), list);
  if (newest) seenLists.set(k, newest);
}

export function getListSeen(pubkey: string, dTag: string): ListEvent | null {
  return seenLists.get(seenKey(pubkey, dTag)) ?? null;
}

/** Test seam. */
export function __resetSavedListSessionForTests(): void {
  freshAccounts.clear();
  seenLists.clear();
}
