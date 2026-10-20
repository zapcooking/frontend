import type NDK from '@nostr-dev-kit/ndk';
import {
  NDKEvent,
  NDKRelaySet,
  NDKRelayStatus,
  NDKSubscriptionCacheUsage,
  type NDKRelay
} from '@nostr-dev-kit/ndk';
import { getOutboxRelays } from './relayListCache';
import { ingestProfileEvent } from './profileResolver';

/**
 * Read-modify-write for the signed-in user's own kind:0.
 *
 * kind:0 is replaceable: whatever we publish REPLACES the whole profile.
 * Every writer must therefore start from the user's latest kind:0 as raw
 * JSON — all fields, including ones this app doesn't know (website, bot,
 * lud06, noffer, a client's custom keys) — change only its own field(s),
 * and pass the rest through untouched. Starting from a parsed profile
 * (NDK's, or our ProfileData) or from `{}` wipes the fields it dropped.
 *
 * So the load either returns the newest kind:0 or REFUSES:
 *   found  — the newest event across the pool, the profile mirrors, the
 *            user's write relays and purplepag.es (newest created_at
 *            wins), and an authoritative answer backs it: purplepag.es
 *            (which keeps every profile) or every connected relay sent
 *            EOSE. A timeout could otherwise hide a newer version.
 *   none   — a brand-new account: purplepag.es AND every other connected
 *            relay answered EOSE with nothing (#853's confirmed-miss
 *            idea). The only case that may start from `{}`.
 * Anything else — a timeout, no relays, content that isn't a JSON object
 * — throws Kind0LoadError, and the caller publishes nothing.
 */

const PURPLEPAG_URL = 'wss://purplepag.es';
/** Same mirrors the profile resolver asks, on top of the pool. */
const PROFILE_RELAY_URLS = ['wss://relay.primal.net', 'wss://nostr.wine'];
export const KIND0_CONNECT_TIMEOUT_MS = 3000;
export const KIND0_LOAD_TIMEOUT_MS = 8000;
const OUTBOX_LOOKUP_TIMEOUT_MS = 2000;

export type Kind0LoadErrorCode = 'timeout' | 'malformed' | 'no-relays';

/** What the user sees when a load is refused. Retrying is safe. */
export const KIND0_LOAD_ERROR_MESSAGE =
  "Couldn't load your current profile from relays, so nothing was changed " +
  '(saving without it could erase fields from your profile). Please try again.';

/** A refused load: nothing was published. `message` is user-facing. */
export class Kind0LoadError extends Error {
  constructor(
    public code: Kind0LoadErrorCode,
    public detail: string
  ) {
    super(KIND0_LOAD_ERROR_MESSAGE);
    this.name = 'Kind0LoadError';
  }
}

export type LoadedKind0 =
  | { status: 'found'; content: Record<string, unknown>; event: NDKEvent }
  | { status: 'none' };

function relayKey(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim().replace(/\/+$/, '');
  }
}

function waitForConnected(relay: any, timeoutMs: number): Promise<boolean> {
  if (relay.status >= NDKRelayStatus.CONNECTED) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onReady = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      relay.off?.('ready', onReady);
      resolve(relay.status >= NDKRelayStatus.CONNECTED);
    }, timeoutMs);
    relay.once('ready', onReady);
  });
}

async function outboxRelays(pubkey: string): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getOutboxRelays(pubkey),
      new Promise<string[]>((resolve) => {
        timer = setTimeout(() => resolve([]), OUTBOX_LOOKUP_TIMEOUT_MS);
      })
    ]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask one relay for the author's kind:0. Resolves true on EOSE, false on
 * CLOSED, NOTICE, an error, or the deadline. Events land in `onEvent`.
 */
function askRelay(
  ndk: NDK,
  relay: NDKRelay,
  pubkey: string,
  deadline: number,
  onEvent: (event: NDKEvent) => void
): Promise<boolean> {
  return new Promise((resolve) => {
    let sub: ReturnType<NDK['subscribe']> | undefined;
    let done = false;
    let noticed = false;
    const onNotice = () => {
      noticed = true;
    };
    const finish = (answered: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      (relay as any).off?.('notice', onNotice);
      sub?.stop();
      resolve(answered && !noticed);
    };
    const timer = setTimeout(() => finish(false), Math.max(0, deadline - Date.now()));
    (relay as any).on?.('notice', onNotice);
    try {
      // One relay per subscription so each EOSE is that relay's own;
      // ONLY_RELAY keeps NDK's cache from answering for it.
      sub = ndk.subscribe(
        { kinds: [0], authors: [pubkey] },
        {
          closeOnEose: false,
          groupable: false,
          cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY
        },
        new NDKRelaySet(new Set([relay]), ndk),
        false
      );
      sub.on('event', (event: NDKEvent) => {
        if (event?.pubkey === pubkey && event.kind === 0) onEvent(event);
      });
      sub.on('eose', () => finish(true));
      sub.on('closed', () => finish(false));
      Promise.resolve(sub.start()).catch(() => finish(false));
    } catch {
      finish(false);
    }
  });
}

/** The user's latest kind:0 as raw JSON, or a confirmed "none" — or it throws. */
export async function loadLatestKind0(ndk: NDK, pubkey: string): Promise<LoadedKind0> {
  const deadline = Date.now() + KIND0_LOAD_TIMEOUT_MS;

  const urls = new Map<string, string>();
  const add = (url: string) => {
    const key = relayKey(url);
    if (!urls.has(key)) urls.set(key, url);
  };
  add(PURPLEPAG_URL);
  if (ndk.pool?.relays) for (const [url] of ndk.pool.relays) add(url);
  for (const url of PROFILE_RELAY_URLS) add(url);
  for (const url of await outboxRelays(pubkey)) add(url);

  let newest: NDKEvent | null = null;
  const keepNewest = (event: NDKEvent) => {
    if (!newest || (event.created_at ?? 0) > (newest.created_at ?? 0)) newest = event;
  };

  const purplepagKey = relayKey(PURPLEPAG_URL);
  const results = await Promise.all(
    [...urls].map(async ([key, url]) => {
      const relay = ndk.pool?.getRelay(url, true, true);
      if (!relay) return { key, connected: false, answered: false };
      const connectBudget = Math.min(KIND0_CONNECT_TIMEOUT_MS, Math.max(0, deadline - Date.now()));
      if (!(await waitForConnected(relay, connectBudget))) {
        return { key, connected: false, answered: false };
      }
      const answered = await askRelay(ndk, relay, pubkey, deadline, keepNewest);
      return { key, connected: true, answered };
    })
  );

  const connected = results.filter((r) => r.connected);
  if (connected.length === 0) {
    throw new Kind0LoadError('no-relays', 'no relay connected');
  }
  const purplepagAnswered = results.some((r) => r.key === purplepagKey && r.answered);
  const allConnectedAnswered = connected.every((r) => r.answered);

  const latest = newest as NDKEvent | null;
  if (latest) {
    if (!purplepagAnswered && !allConnectedAnswered) {
      throw new Kind0LoadError('timeout', 'no authoritative answer before the deadline');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(latest.content);
    } catch {
      throw new Kind0LoadError('malformed', 'latest kind:0 content is not a JSON object');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Kind0LoadError('malformed', 'latest kind:0 content is not a JSON object');
    }
    return { status: 'found', content: parsed as Record<string, unknown>, event: latest };
  }

  // Nothing anywhere. Only a full set of answers, purplepag's included,
  // proves there is no profile to lose.
  if (purplepagAnswered && allConnectedAnswered) return { status: 'none' };
  throw new Kind0LoadError('timeout', 'no authoritative answer before the deadline');
}

/**
 * Set (string) or remove (undefined / '') fields on a copy of `content`.
 * Every key not named in `changes` passes through untouched.
 */
export function applyKind0Changes(
  content: Record<string, unknown>,
  changes: Record<string, string | undefined>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...content };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
  }
  return next;
}

export interface Kind0PublishResult {
  event: NDKEvent;
  relayCount: number;
}

/**
 * Load the user's latest kind:0, apply `changes`, sign and publish it.
 * Throws Kind0LoadError (nothing published) when the load is refused, and
 * an Error when no relay accepts the event. On success the event goes
 * into the profile resolver's cache, so mounted names update at once.
 */
export async function updateOwnKind0(
  ndk: NDK,
  pubkey: string,
  changes: Record<string, string | undefined>
): Promise<Kind0PublishResult> {
  return publishKind0Changes(ndk, pubkey, await loadLatestKind0(ndk, pubkey), changes);
}

/** The publish half of updateOwnKind0, for callers that inspect the load first. */
export async function publishKind0Changes(
  ndk: NDK,
  pubkey: string,
  loaded: LoadedKind0,
  changes: Record<string, string | undefined>
): Promise<Kind0PublishResult> {
  const base = loaded.status === 'found' ? loaded.content : {};

  const event = new NDKEvent(ndk);
  event.kind = 0;
  event.content = JSON.stringify(applyKind0Changes(base, changes));
  // Tags (NIP-39 identities, custom emoji…) are part of the profile too.
  event.tags = loaded.status === 'found' ? loaded.event.tags.map((t) => [...t]) : [];
  // A replaceable event only replaces an older one: never sign a
  // created_at at or before the version we just read (clock skew).
  const now = Math.floor(Date.now() / 1000);
  const previous = loaded.status === 'found' ? (loaded.event.created_at ?? 0) : 0;
  event.created_at = Math.max(now, previous + 1);

  await event.sign();
  const relays = await event.publish();
  if (relays.size === 0) {
    throw new Error('No relay accepted the profile update. Please try again.');
  }
  ingestProfileEvent(pubkey, event);
  return { event, relayCount: relays.size };
}

/**
 * The fields a profile form actually changed (trimmed): the edit applies
 * only these, so a field the form showed from a stale copy of the
 * profile can't revert a newer value someone saved elsewhere.
 */
export function changedFormFields<T extends Record<string, string>>(
  initial: T,
  current: T
): Record<string, string | undefined> {
  const changes: Record<string, string | undefined> = {};
  for (const key of Object.keys(current)) {
    const next = (current[key] ?? '').trim();
    if (next !== (initial[key] ?? '').trim()) changes[key] = next;
  }
  return changes;
}

/** A new profile picture: changes `picture` only. */
export function updateOwnPicture(
  ndk: NDK,
  pubkey: string,
  pictureUrl: string
): Promise<Kind0PublishResult> {
  return updateOwnKind0(ndk, pubkey, { picture: pictureUrl });
}
