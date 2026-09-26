/**
 * zap.cooking's LazarusRelaySource: the I/O half of the vendored Lazarus
 * core ($lib/lazarus/recovery.ts stays pure and testable; everything that
 * opens a socket lives here).
 *
 * Relay catalog per the spec's scan algorithm: every relay in the user's own
 * kind-10002 list (read and write — history was observed on read-only
 * listings), the app's configured relays, and the archival set that keeps
 * superseded versions.
 */

import { SimplePool } from 'nostr-tools/pool';
import type { Event, Filter } from 'nostr-tools';
import { getCurrentRelays } from '$lib/nostr';
import { normalizeRelayUrl, relayListCache } from '$lib/relayListCache';
import {
  LAZARUS_ARCHIVAL_RELAYS,
  type LazarusRelayListStatus,
  type LazarusRelayOutcome,
  type LazarusRelaySource,
  type LazarusTaggedEvent
} from './recovery';

const SCAN_TIMEOUT_MS = 6000;
const SCAN_LIMIT = 50;
const LATEST_VERSION_TIMEOUT_MS = 4000;

let scanPool: SimplePool | undefined;

function getScanPool(): SimplePool {
  if (!scanPool) scanPool = new SimplePool();
  return scanPool;
}

/** Drop the scan pool's sockets. Call when the recovery UI closes. */
export function closeLazarusScanPool() {
  if (scanPool) {
    try {
      // destroy() closes every connection; close(urls) only closes the URLs
      // it is handed, so close([]) would leave every socket open.
      scanPool.destroy();
    } catch {
      /* already closed */
    }
    scanPool = undefined;
  }
}

/** What a relay sent in answer to a request, and how the request ended. */
interface RelayAnswer {
  events: Event[];
  outcome: LazarusRelayOutcome;
}

/**
 * One relay's answer to a filter. The subscription is closed as soon as the
 * relay finishes, fails or times out, so a slow relay doesn't stay subscribed
 * after the scan moves on. Only EOSE counts as an answer. Events that arrived
 * before a failure or timeout are kept: they're real versions, even though
 * that relay's history is incomplete.
 */
function fetchFromRelay(
  url: string,
  filter: Filter,
  timeoutMs = SCAN_TIMEOUT_MS
): Promise<RelayAnswer> {
  return new Promise((resolve) => {
    const events: Event[] = [];
    let done = false;
    let sub: { close: () => void } | undefined;
    const finish = (outcome: LazarusRelayOutcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub?.close();
      resolve({ events, outcome });
    };
    const timer = setTimeout(() => finish('timed-out'), timeoutMs);
    sub = getScanPool().subscribeMany([url], filter, {
      onevent: (event: Event) => {
        events.push(event);
      },
      oneose: () => finish('answered'),
      onclose: () => finish('failed')
    });
  });
}

/** Ask several relays at once. A request that couldn't even start counts as failed. */
async function fetchFromRelays(
  urls: string[],
  filterFor: (url: string) => Filter,
  timeoutMs?: number
): Promise<RelayAnswer[]> {
  const results = await Promise.allSettled(
    urls.map((url) => fetchFromRelay(url, filterFor(url), timeoutMs))
  );
  return results.map((result) =>
    result.status === 'fulfilled' ? result.value : { events: [], outcome: 'failed' }
  );
}

function uniqueRelayUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.map((url) => normalizeRelayUrl(url)).filter(Boolean)));
}

/** The relays a kind 10002 names. An unmarked relay is both read and write (NIP-65). */
function parseRelayList(event: Event): { read: string[]; write: string[] } {
  const read: string[] = [];
  const write: string[] = [];
  for (const [name, url, marker] of event.tags) {
    if (name !== 'r' || !url) continue;
    if (marker !== 'write') read.push(url);
    if (marker !== 'read') write.push(url);
  }
  return { read: uniqueRelayUrls(read), write: uniqueRelayUrls(write) };
}

/**
 * The user's relay list: the app's cached copy when it has one, otherwise a
 * lookup on the app's relays and the archival set, which tells a missing
 * list (relays answered without one) from one that couldn't be fetched (no
 * relay answered). A missing list, or one naming no write relays, lets the
 * app's relays stand in as write relays. An unknown one leaves none, so
 * current can't be confirmed.
 */
async function getUserRelays(
  pubkey: string
): Promise<{ read: string[]; write: string[]; relayList: LazarusRelayListStatus }> {
  let found: { read: string[]; write: string[] } | undefined;
  try {
    const list = await relayListCache.get(pubkey);
    if (list && (list.read.length > 0 || list.write.length > 0)) {
      found = { read: uniqueRelayUrls(list.read), write: uniqueRelayUrls(list.write) };
    }
  } catch {
    // Look the list up directly below
  }
  if (!found) {
    const answers = await fetchFromRelays(
      uniqueRelayUrls([...getCurrentRelays(), ...LAZARUS_ARCHIVAL_RELAYS]),
      () => ({ kinds: [10002], authors: [pubkey], limit: 1 })
    );
    const newest = answers
      .flatMap((answer) => answer.events)
      .filter((event) => event.pubkey === pubkey && event.kind === 10002)
      .sort((a, b) => b.created_at - a.created_at)[0];
    if (newest) {
      found = parseRelayList(newest);
    } else if (!answers.some((answer) => answer.outcome === 'answered')) {
      return { read: [], write: [], relayList: 'unknown' };
    }
  }
  if (!found || found.write.length === 0) {
    return {
      read: found?.read ?? [],
      write: uniqueRelayUrls(getCurrentRelays()),
      relayList: 'missing'
    };
  }
  return { ...found, relayList: 'found' };
}

/**
 * Relays to scan: every relay in the user's relay list, the app's
 * configured relays, and the archival set. The plan also names the user's
 * write relays, since current is confirmed only once one of them answers.
 */
export async function getLazarusScanPlan(
  pubkey: string
): Promise<{ relays: string[]; write: string[]; relayList: LazarusRelayListStatus }> {
  const user = await getUserRelays(pubkey);
  return {
    relays: uniqueRelayUrls([
      ...user.write,
      ...user.read,
      ...getCurrentRelays(),
      ...LAZARUS_ARCHIVAL_RELAYS
    ]),
    write: user.write,
    relayList: user.relayList
  };
}

/**
 * Relays to publish a recovery to. Success is judged on the user's write
 * relays. The other relays that answered the scan hold older copies of the
 * list, so the restored version goes there too, as a best effort, to replace
 * the clobbered copy they would otherwise keep serving.
 */
export async function getLazarusPublishRelays(
  pubkey: string,
  respondingRelays: string[]
): Promise<{ write: string[]; extra: string[] }> {
  const { write } = await getUserRelays(pubkey);
  const extra = uniqueRelayUrls(respondingRelays).filter((url) => !write.includes(url));
  return { write, extra };
}

/**
 * The newest version on the user's write relays right now, to catch edits
 * made after a scan (from another tab, device or client) before a restore
 * overwrites them.
 *
 * Fails closed: when no write relay answered, the current version cannot be
 * established, and treating that as "no current event" would let a restore
 * overwrite an edit the failed relays may hold. Only a relay that answered
 * (sent EOSE, even with zero events) counts; one that failed or timed out
 * doesn't, whatever it sent first.
 *
 * @throws Error when no write relay answered.
 */
export async function fetchLatestLazarusVersion(
  kind: number,
  pubkey: string
): Promise<Event | undefined> {
  const { write } = await getUserRelays(pubkey);
  const answers = await fetchFromRelays(
    write,
    () => ({ kinds: [kind], authors: [pubkey], limit: 1 }),
    LATEST_VERSION_TIMEOUT_MS
  );
  if (!answers.some((answer) => answer.outcome === 'answered')) {
    throw new Error('No write relay could be reached to confirm the current version');
  }
  let newest: Event | undefined;
  for (const event of answers.flatMap((answer) => answer.events)) {
    const usable = event.pubkey === pubkey && event.kind === kind;
    if (usable && (!newest || event.created_at > newest.created_at)) {
      newest = event;
    }
  }
  return newest;
}

/**
 * Re-ask just the relays that failed or timed out, without repeating the
 * scan (spec 0.6.0 "Relay outcomes" → Retry). Returns what they gave this
 * time, with fresh outcomes; the caller merges it into the scan it already
 * holds. A write relay answering here confirms current for that scan.
 */
export async function retryLazarusRelays(
  kind: number,
  pubkey: string,
  urls: string[]
): Promise<{
  tagged: LazarusTaggedEvent[];
  outcomes: Record<string, LazarusRelayOutcome>;
  currentConfirmed: boolean;
}> {
  const { write } = await getUserRelays(pubkey);
  const answers = await fetchFromRelays(urls, () => ({
    kinds: [kind],
    authors: [pubkey],
    limit: SCAN_LIMIT
  }));
  const tagged: LazarusTaggedEvent[] = [];
  const outcomes: Record<string, LazarusRelayOutcome> = {};
  answers.forEach(({ events, outcome }, index) => {
    const url = urls[index];
    outcomes[url] = outcome;
    for (const event of events) {
      if (event.pubkey === pubkey && event.kind === kind) {
        tagged.push({ event, relayUrl: url });
      }
    }
  });
  return {
    tagged,
    outcomes,
    currentConfirmed: write.some((url) => outcomes[url] === 'answered')
  };
}

/**
 * Per-relay scanning so each candidate keeps an accurate found-on list and
 * the result can report how each relay's request ended. A relay that fails
 * or times out never counts as "nothing found".
 */
export const zapLazarusRelaySource: LazarusRelaySource = {
  async fetchVersions(kind, pubkey, cursors) {
    const plan = cursors ? undefined : await getLazarusScanPlan(pubkey);
    const urls = plan ? plan.relays : Object.keys(cursors ?? {});
    const answers = await fetchFromRelays(urls, (url) => {
      const filter: Filter = { kinds: [kind], authors: [pubkey], limit: SCAN_LIMIT };
      return cursors ? { ...filter, until: cursors[url] } : filter;
    });

    const tagged: LazarusTaggedEvent[] = [];
    const respondingRelays: string[] = [];
    const olderCursors: Record<string, number> = {};
    const outcomes: Record<string, LazarusRelayOutcome> = {};
    answers.forEach(({ events, outcome }, index) => {
      const url = urls[index];
      outcomes[url] = outcome;
      // The pool already drops events that fail their signature or the
      // filter; this check keeps a foreign event from ever becoming a restore
      // candidate whatever the pool does, since restoring it would republish
      // its content as the user's signed event.
      const relayEvents = events.filter((event) => event.pubkey === pubkey && event.kind === kind);
      if (relayEvents.length > 0) respondingRelays.push(url);
      for (const event of relayEvents) {
        tagged.push({ event, relayUrl: url });
      }
      // A full page means the relay may hold older versions. `until` is
      // inclusive, so the next page repeats the oldest event; a cursor that
      // didn't move means the relay has nothing older to give.
      if (relayEvents.length >= SCAN_LIMIT) {
        const oldest = Math.min(...relayEvents.map((event) => event.created_at));
        if (!cursors || oldest < cursors[url]) olderCursors[url] = oldest;
      }
    });

    return {
      tagged,
      queriedRelays: urls,
      respondingRelays,
      olderCursors,
      outcomes,
      ...(plan && {
        currentConfirmed: plan.write.some((url) => outcomes[url] === 'answered'),
        relayList: plan.relayList
      })
    };
  }
};
