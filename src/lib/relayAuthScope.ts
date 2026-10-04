/**
 * Which relays the app logs in to (NIP-42) on its own.
 *
 * The app answers AUTH challenges automatically only for relays the reader
 * chose: pantry.zap.cooking (Groups), the relays in the app's relay list
 * (getCurrentRelays: the saved list, or the defaults the app connects with),
 * and the relays the reader published as their own: NIP-65 (kind 10002) and
 * NIP-17 DM inboxes (kind 10050), so gift-wrapped messages on an AUTH-only
 * inbox keep arriving. Any other relay that turns up in NDK's pool (another
 * author's outbox, a hint) gets no login: that would sign the reader's key
 * over to relays they never picked, and with browser or remote signers it
 * prompts them for it.
 *
 * Pure apart from `ownRelayLists`, so the rule is testable.
 */

export const PANTRY_AUTH_RELAY = 'wss://pantry.zap.cooking';

/**
 * Relays NDK never connects to. NDK's own defaults are repeated because
 * passing `blacklistRelayUrls` replaces them. filter.nostr.wine is a paid
 * relay that challenges every connection and serves nothing to
 * non-subscribers; it reached the pool through other authors' outbox lists
 * and prompted readers to log in.
 */
export const NDK_BLOCKED_RELAYS = [
  'wss://brb.io/',
  'wss://nostr.mutinywallet.com/',
  'wss://filter.nostr.wine/'
];

/** Comparable form of a relay URL: lower case, no trailing slash. */
export function relayKey(url: string): string {
  return (url || '').trim().toLowerCase().replace(/\/+$/, '');
}

/** Should the app log in to `url` on its own? */
export function isAuthAllowed(url: string, allowed: Iterable<string>): boolean {
  const key = relayKey(url);
  if (!key) return false;
  if (NDK_BLOCKED_RELAYS.some((b) => relayKey(b) === key)) return false;
  if (key === relayKey(PANTRY_AUTH_RELAY)) return true;
  for (const a of allowed) if (relayKey(a) === key) return true;
  return false;
}

/** The relays in the reader's own relay list (10002 `r`) and DM inbox list (10050 `relay`). */
export function ownRelayUrls(events: { kind?: number; tags: string[][] }[]): string[] {
  const urls: string[] = [];
  for (const e of events) {
    if (e.kind === 10002) {
      for (const t of e.tags) if (t[0] === 'r' && t[1]) urls.push(t[1]);
    } else if (e.kind === 10050) {
      for (const t of e.tags) if (t[0] === 'relay' && t[1]) urls.push(t[1]);
    }
  }
  return urls;
}

type ListFetcher = (filter: {
  kinds: number[];
  authors: string[];
}) => Promise<Set<{ kind?: number; tags: string[][]; created_at?: number }>>;

let ownCache: { pubkey: string; urls: Promise<string[]> } | null = null;

/**
 * The reader's own published relay lists, fetched once per account (the
 * newest event of each kind). An empty list on failure: nothing extra is
 * allowed, which is the safe side.
 */
export function ownRelayLists(fetchEvents: ListFetcher, pubkey: string): Promise<string[]> {
  if (!pubkey) return Promise.resolve([]);
  if (ownCache?.pubkey === pubkey) return ownCache.urls;
  const urls = fetchEvents({ kinds: [10002, 10050], authors: [pubkey] })
    .then((set) => {
      const newest = new Map<number, { kind?: number; tags: string[][]; created_at?: number }>();
      for (const e of set) {
        const k = e.kind ?? 0;
        const cur = newest.get(k);
        if (!cur || (e.created_at ?? 0) > (cur.created_at ?? 0)) newest.set(k, e);
      }
      return ownRelayUrls([...newest.values()]);
    })
    .catch(() => {
      ownCache = null;
      return [];
    });
  ownCache = { pubkey, urls };
  return urls;
}

/** Forget the cached lists (tests; account switch is handled by the pubkey key). */
export function resetOwnRelayLists(): void {
  ownCache = null;
}

/**
 * The auth policy's question: pantry or the app's relay list answer at once;
 * only for any other relay are the reader's own published lists consulted.
 */
export async function shouldAutoAuth(
  url: string,
  configured: string[],
  own: () => Promise<string[]>
): Promise<boolean> {
  const key = relayKey(url);
  if (NDK_BLOCKED_RELAYS.some((b) => relayKey(b) === key)) return false;
  if (isAuthAllowed(url, configured)) return true;
  return isAuthAllowed(url, await own());
}
