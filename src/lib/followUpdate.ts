import type NDK from '@nostr-dev-kit/ndk';
import {
  PURPLEPAGES,
  READ_TIMEOUT_MS,
  decideFollowEdit,
  getSeen,
  newestList,
  notePublished,
  noteSeen,
  refusalMessage,
  type ContactList,
  type Refusal,
  type RelayAnswer
} from '$lib/followSafety';

/**
 * The one way the app changes the reader's follow list ($lib/followSafety
 * explains the rules). Used by every follow and unfollow button.
 */

export class FollowSafetyError extends Error {
  constructor(readonly reason: Refusal) {
    super(refusalMessage(reason));
    this.name = 'FollowSafetyError';
  }
}

/** What to tell the reader when a follow change failed. */
export function followErrorMessage(err: unknown): string {
  return err instanceof FollowSafetyError
    ? err.message
    : "Couldn't update your follows. Please try again.";
}

/** One relay, one REQ for the reader's kind 3, to EOSE or the timeout. */
export type QueryRelay = (url: string, pubkey: string, timeoutMs: number) => Promise<RelayAnswer>;

export const queryRelayKind3: QueryRelay = async (url, pubkey, timeoutMs) => {
  const { Relay } = await import('nostr-tools/relay');
  return new Promise<RelayAnswer>((resolve) => {
    let relay: { close(): void } | null = null;
    let list: ContactList | null = null;
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
        r.subscribe([{ kinds: [3], authors: [pubkey], limit: 1 }], {
          eoseTimeout: timeoutMs + 1000,
          onevent: (e: ContactList) => {
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

/** Where the reader's follow list is read from: own write relays, purplepag.es, the app's relays. */
export async function followReadRelays(
  pubkey: string
): Promise<{ urls: string[]; ownWrite: string[] }> {
  const { getOwnWriteRelays } = await import('$lib/nip65Routing');
  const { getCurrentRelays } = await import('$lib/nostr');
  const ownWrite = await getOwnWriteRelays(pubkey).catch(() => [] as string[]);
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const u of [...ownWrite, PURPLEPAGES, ...getCurrentRelays()]) {
    const k = u.trim().toLowerCase().replace(/\/+$/, '');
    if (!/^wss?:\/\//.test(k) || seen.has(k)) continue;
    seen.add(k);
    urls.push(u.trim());
  }
  return { urls, ownWrite };
}

/** Read the reader's follow list from every relay, waiting for each (bounded). */
export async function readFollowLists(
  pubkey: string,
  query: QueryRelay = queryRelayKind3
): Promise<{ answers: RelayAnswer[]; ownWrite: string[] }> {
  const { urls, ownWrite } = await followReadRelays(pubkey);
  const answers = await Promise.all(urls.map((u) => query(u, pubkey, READ_TIMEOUT_MS)));
  noteSeen(pubkey, newestList(answers));
  return { answers, ownWrite };
}

/** Each account's follow edits run one at a time (see updateFollows). */
const queues = new Map<string, Promise<unknown>>();

/** The list this app last published per account, until relays catch up. */
const publishedBy = new Map<string, ContactList>();

/**
 * Follow (`add`) and/or unfollow (`remove`) safely. Throws FollowSafetyError
 * (nothing published) when the edit isn't safe; returns the new follow set.
 *
 * Edits for one account are queued: two quick follows from different buttons
 * would otherwise both start from the same list, and whichever kind 3 a relay
 * keeps would drop the other follow.
 */
export function updateFollows(
  ndk: NDK,
  pubkey: string,
  change: { add?: string[]; remove?: string[] },
  query: QueryRelay = queryRelayKind3
): Promise<Set<string>> {
  if (!pubkey) return Promise.reject(new Error('Not signed in'));
  const prev = queues.get(pubkey) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => applyFollowEdit(ndk, pubkey, change, query));
  const tail = run.catch(() => {});
  queues.set(pubkey, tail);
  tail.then(() => {
    if (queues.get(pubkey) === tail) queues.delete(pubkey);
  });
  return run;
}

async function applyFollowEdit(
  ndk: NDK,
  pubkey: string,
  change: { add?: string[]; remove?: string[] },
  query: QueryRelay
): Promise<Set<string>> {
  const seenBefore = getSeen(pubkey);
  const { answers: read, ownWrite } = await readFollowLists(pubkey, query);
  // Our own last publish counts as a list found, so the next edit builds on
  // it even when a relay hasn't stored it yet.
  const mine = publishedBy.get(pubkey);
  const answers = mine ? [...read, { url: 'local:published', ok: true, list: mine }] : read;
  const decision = decideFollowEdit({ answers, ownWrite, seen: seenBefore, ...change });
  if (!decision.ok) throw new FollowSafetyError(decision.reason);
  const follows = new Set(decision.tags.filter((t) => t[0] === 'p').map((t) => t[1]));
  if (!decision.changed) return follows;

  const { NDKEvent } = await import('@nostr-dev-kit/ndk');
  const { outboxRelaySet } = await import('$lib/outboxPublish');
  const ev = new NDKEvent(ndk);
  ev.kind = 3;
  ev.content = decision.content;
  ev.tags = decision.tags;
  // A replaceable event must be newer than the one it replaces, or relays
  // keep the old one (a device clock running behind would lose the edit).
  const prev = newestList(answers);
  ev.created_at = Math.max(Math.floor(Date.now() / 1000), (prev?.created_at ?? 0) + 1);
  await ev.sign();
  // The signer can change during the relay wait (logout, account switch):
  // never publish this account's list under another account's key.
  if (ev.pubkey !== pubkey) throw new Error('Signed in account changed; follow not saved');
  await ev.publish(await outboxRelaySet(ev, 'list'));
  const created_at = ev.created_at ?? Math.floor(Date.now() / 1000);
  notePublished(pubkey, { created_at, tags: ev.tags });
  publishedBy.set(pubkey, { id: ev.id ?? '', created_at, tags: ev.tags, content: ev.content });
  return follows;
}

/** Tests only. */
export function resetPublishedForTests() {
  publishedBy.clear();
  queues.clear();
}
