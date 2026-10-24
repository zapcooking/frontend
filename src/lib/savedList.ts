import type { Filter } from 'nostr-tools';
import { NDKEvent, NDKNip07Signer, NDKPrivateKeySigner, type NDKSigner } from '@nostr-dev-kit/ndk';
import {
  MIN_EMPTY_ANSWERS,
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

/** The socket layer queryRelayNewest reads through (nostr-tools' Relay). */
export type RelayModule = Pick<typeof import('nostr-tools/relay'), 'Relay'>;

/**
 * queryRelayNewest over a given socket layer. Tests pass a fake one so the
 * real timeout logic runs without a network (mocking the dynamically
 * imported module is unreliable: concurrent imports can resolve to the real
 * one).
 */
export function createRelayQuery(
  load: () => Promise<RelayModule> = () => import('nostr-tools/relay')
): QueryList {
  return async (url, filter, timeoutMs) => {
    const { Relay } = await load();
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
}

export const queryRelayNewest: QueryList = createRelayQuery();

/**
 * The member's own write relays, or 'unknown'. Unknown is not "none": the
 * cache answers null both for "no relay list" and for "couldn't fetch it",
 * and an edit that guessed "none" could miss the relays the list lives on.
 * A cached list (fresh or stale) is known; otherwise the relays that hold
 * relay lists (purplepag.es and the app's relays) are asked directly — a
 * list found is known, at least MIN_EMPTY_ANSWERS empty answers is a known
 * "none", anything less is unknown.
 */
export type OwnWriteDiscovery = { status: 'known'; write: string[] } | { status: 'unknown' };

export async function discoverOwnWriteRelays(
  pubkey: string,
  query: QueryList = queryRelayNewest
): Promise<OwnWriteDiscovery> {
  const { relayListCache } = await import('$lib/relayListCache');
  const cached = await Promise.race([
    relayListCache.get(pubkey).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SAVED_LIST_READ_TIMEOUT_MS))
  ]);
  if (cached) return { status: 'known', write: cached.write };

  const { getCurrentRelays } = await import('$lib/nostr');
  const { PURPLEPAGES } = await import('$lib/followSafety');
  const seen = new Set<string>();
  const urls = [PURPLEPAGES, ...getCurrentRelays()].filter((u) => {
    const k = u.trim().toLowerCase().replace(/\/+$/, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const filter: Filter = { kinds: [10002], authors: [pubkey], limit: 1 };
  const answers = await Promise.all(urls.map((u) => query(u, filter, SAVED_LIST_READ_TIMEOUT_MS)));
  const found = newestList(
    ...answers.map((a) =>
      (a.list as { pubkey?: string } | null)?.pubkey === pubkey ? a.list : null
    )
  );
  if (found) {
    const write = found.tags
      .filter((t) => t[0] === 'r' && t[1] && (!t[2] || t[2] === 'write'))
      .map((t) => t[1]);
    return { status: 'known', write };
  }
  return answers.filter((a) => a.ok).length >= MIN_EMPTY_ANSWERS
    ? { status: 'known', write: [] }
    : { status: 'unknown' };
}

/**
 * Read one of the member's lists from every relay lists are written to,
 * waiting for each relay (bounded by SAVED_LIST_READ_TIMEOUT_MS, all in
 * parallel). Returns the exact relay set it read, which the edit then
 * publishes to — resolving the set again at publish time could add a relay
 * (late discovery, a background cache refresh) whose copy was never read.
 * `discovery: 'unknown'` when the member's own write relays couldn't be
 * established: nothing may be published then.
 */
export async function readListFromRelays(
  pubkey: string,
  dTag: string,
  query: QueryList = queryRelayNewest
): Promise<{
  answers: ListRelayAnswer[];
  ownWrite: string[];
  urls: string[];
  discovery: 'known' | 'unknown';
}> {
  const own = await discoverOwnWriteRelays(pubkey, query);
  if (own.status === 'unknown')
    return { answers: [], ownWrite: [], urls: [], discovery: 'unknown' };
  const { listRelayUrlsFrom } = await import('$lib/nip65Routing');
  const urls = await listRelayUrlsFrom(own.write);
  const filter: Filter = { kinds: [30001], authors: [pubkey], '#d': [dTag], limit: 1 };
  const answers = await Promise.all(urls.map((u) => query(u, filter, SAVED_LIST_READ_TIMEOUT_MS)));
  // A relay can only answer for this author and d tag; drop anything else.
  for (const a of answers) {
    if (a.list && (a.list as ListEvent & { pubkey?: string }).pubkey !== pubkey) a.list = null;
  }
  return { answers, ownWrite: own.write, urls, discovery: 'known' };
}

// ── Signing ─────────────────────────────────────────────────────

/** How long an extension (NIP-07) may take to sign a list edit. */
export const NIP07_SIGN_TIMEOUT_MS = 30_000;
/** How long a remote bunker (NIP-46) may take: the member may approve on another device. */
export const NIP46_SIGN_TIMEOUT_MS = 60_000;

/**
 * The bound for this signer, or null for a local key (nsec, unlocked
 * passkey), which signs in-process and can't stall. NDK puts no timeout on
 * either remote kind: an extension that silently drops the request, or a
 * bunker that never replies, would hold the edit — and every edit queued
 * behind it — forever. Anything else (a bunker, or a signer we don't
 * recognise) gets the bunker bound.
 */
export function signerTimeoutMs(signer: NDKSigner | undefined): number | null {
  if (signer instanceof NDKPrivateKeySigner) return null;
  if (signer instanceof NDKNip07Signer) return NIP07_SIGN_TIMEOUT_MS;
  return NIP46_SIGN_TIMEOUT_MS;
}

/**
 * Sign `event` within its signer's bound. The signer signs a copy, so a
 * signature that arrives after the timeout lands on an event nothing holds
 * and is never published; only a signature in time is copied over.
 */
export async function signWithin(
  event: NDKEvent,
  signer: NDKSigner | undefined
): Promise<'signed' | 'timeout' | 'failed'> {
  const copy = new NDKEvent(event.ndk, event.rawEvent());
  const sign = copy.sign(signer).then(
    () => 'signed' as const,
    (error) => {
      console.warn('[savedList] the signer did not sign the list edit:', error);
      return 'failed' as const;
    }
  );
  const ms = signerTimeoutMs(signer);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome =
    ms === null
      ? await sign
      : await Promise.race([
          sign,
          new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), ms)))
        ]);
  clearTimeout(timer);
  if (outcome !== 'signed') return outcome;
  if (copy.pubkey) event.pubkey = copy.pubkey;
  if (copy.id) event.id = copy.id;
  if (copy.sig) event.sig = copy.sig;
  return 'signed';
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
