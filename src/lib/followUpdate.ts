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
  let relay: { close(): void; subscribe: (...a: any[]) => { close(): void } } | null = null;
  let list: ContactList | null = null;
  try {
    const answered = await Promise.race([
      (async () => {
        relay = await Relay.connect(url);
        return await new Promise<boolean>((resolve) => {
          const sub = relay!.subscribe([{ kinds: [3], authors: [pubkey], limit: 1 }], {
            eoseTimeout: timeoutMs + 1000,
            onevent: (e: ContactList) => {
              if (!list || e.created_at > list.created_at) list = e;
            },
            oneose: () => {
              // Settle first: closing the subscription calls onclose at once,
              // which would otherwise record this answer as "no answer".
              resolve(true);
              sub.close();
            },
            onclose: () => resolve(false)
          });
        });
      })(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs))
    ]);
    return { url, ok: answered, list: answered ? list : null };
  } catch {
    return { url, ok: false, list: null };
  } finally {
    try {
      (relay as { close(): void } | null)?.close();
    } catch {
      /* ignore */
    }
  }
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

/**
 * Follow (`add`) and/or unfollow (`remove`) safely. Throws FollowSafetyError
 * (nothing published) when the edit isn't safe; returns the new follow set.
 */
export async function updateFollows(
  ndk: NDK,
  pubkey: string,
  change: { add?: string[]; remove?: string[] },
  query: QueryRelay = queryRelayKind3
): Promise<Set<string>> {
  if (!pubkey) throw new Error('Not signed in');
  const seenBefore = getSeen(pubkey);
  const { answers, ownWrite } = await readFollowLists(pubkey, query);
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
  await ev.publish(await outboxRelaySet(ev, 'list'));
  notePublished(pubkey, {
    created_at: ev.created_at ?? Math.floor(Date.now() / 1000),
    tags: ev.tags
  });
  return follows;
}
