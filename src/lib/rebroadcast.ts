/**
 * Rebroadcast service
 *
 * Re-publishes an ALREADY-SIGNED note (short, long form, or any other
 * addressable event) to relays beyond the ones that confirmed the original
 * publish, so the note survives on more of the relay graph. This is not a
 * repost (kind 6 / 16 create a NEW event referencing the original); a
 * rebroadcast sends the identical signed payload, byte for byte, to more
 * relays. Nothing is re-signed and the event id never changes.
 *
 * Relay selection: the union of
 *   1. the relays currently in the NDK pool, and
 *   2. the app's standardRelays (consts.ts),
 * minus relays known to hold the event (best-effort: the event's own
 * relay / onRelays, the relay a signed copy was recovered from, and any
 * set the caller passes; relays not known to hold it are attempted).
 *
 * Publishing uses NDK directly (not publishQueue): the queue exists to
 * make AUTHORING resilient (signing, offline persistence, retries). A
 * rebroadcast is a best-effort fan-out of an existing immutable event:
 * partial delivery is success, and queueing a retry would defeat the
 * "expand coverage where it is thin" intent by re-aiming at the same
 * relays later.
 */

import { get } from 'svelte/store';
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools';
import { browser } from '$app/environment';
import { ndk } from '$lib/nostr';
import { standardRelays } from '$lib/consts';
import { normalizeRelayUrl } from '$lib/relayListCache';

/** Hard cap so one tap can't open dozens of sockets on a phone. */
export const MAX_REBROADCAST_RELAYS = 12;

/** Per-relay publish timeout (ms). Fan-out is parallel; the slowest relay
 *  bounds the whole wait. */
export const REBROADCAST_TIMEOUT_MS = 8000;

export interface RebroadcastResult {
  /** Relays that confirmed the event, by URL. */
  confirmed: string[];
  /** Relays that were attempted but did not confirm (or failed to connect). */
  failed: string[];
}

/**
 * Compute the rebroadcast relay list: pool ∪ standardRelays, deduped via
 * normalizeRelayUrl, minus already-confirmed URLs when provided, capped at
 * MAX_REBROADCAST_RELAYS (stable order: pool first, then standard list).
 */
export function rebroadcastRelayUrls(
  ndkInstance: any,
  confirmedUrls: string[] = []
): string[] {
  const confirmed = new Set(confirmedUrls.map(normalizeRelayUrl));

  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    const key = normalizeRelayUrl(url);
    if (key && !seen.has(key) && !confirmed.has(key)) {
      seen.add(key);
      ordered.push(url);
    }
  };

  if (ndkInstance?.pool?.relays) {
    for (const [url] of ndkInstance.pool.relays) push(url);
  }
  for (const url of standardRelays) push(url);

  return ordered.slice(0, MAX_REBROADCAST_RELAYS);
}

/**
 * One-shot raw fetch of an event by id straight from a relay socket.
 * Bypasses every NDK query/cache layer: some cached instances come back
 * without signature bytes even though the relay holds the signed payload.
 */
function fetchSignedRawViaWs(url: string, id: string, timeoutMs = 4000): Promise<any | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    let done = false;
    const finish = (v: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch {
      finish(null);
      return;
    }
    ws.onopen = () => {
      ws.send(JSON.stringify(['REQ', 'rb-' + Math.random().toString(36).slice(2), { ids: [id] }]));
    };
    ws.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data);
        if (d[0] === 'EVENT' && d[2]?.id === id) finish(d[2]);
        else if (d[0] === 'EOSE') finish(null);
      } catch { /* ignore malformed frames */ }
    };
    ws.onerror = () => finish(null);
  });
}

/**
 * Returns the event's NIP-01 fields when its id and signature check out
 * against `id`, else null. Relay- and cache-supplied payloads are untrusted:
 * a tampered copy would stop recovery and then be rejected by every honest
 * relay, so a bad one must fall through to the next source instead.
 */
function verifiedPayload(raw: any, id: string): NostrEvent | null {
  if (!raw || raw.id !== id || typeof raw.sig !== 'string' || !raw.sig) return null;
  const payload: NostrEvent = {
    id: raw.id,
    pubkey: raw.pubkey,
    created_at: raw.created_at,
    kind: raw.kind,
    tags: raw.tags,
    content: raw.content,
    sig: raw.sig
  };
  try {
    return verifyEvent(payload) ? payload : null;
  } catch {
    return null;
  }
}

/** Relay URLs an event is known to have come from or been published to. */
function knownHolderUrls(event: any): string[] {
  const urls: string[] = [];
  try {
    for (const r of event?.onRelays ?? []) if (r?.url) urls.push(r.url);
  } catch {
    /* plain objects have no onRelays */
  }
  if (event?.relay?.url) urls.push(event.relay.url);
  return urls;
}

/**
 * Ensure we hold a SIGNED NDKEvent before publishing.
 *
 * Events surfaced from NDK's local cache (Dexie) can come back as
 * reconstructed instances without a `sig` on the object, even though the
 * signed bytes exist on the relays, and feed caches hand over plain objects
 * that carry a sig but no `publish()`. Rebroadcasting an old, thinly-relayed
 * note is the core use case and those are almost always cache-served, so a
 * missing sig here is normal, not an error: use the in-hand copy, then a
 * direct one-shot wire fetch from pool relays, then NDK's own relay fetch
 * (cache bypassed), verifying every candidate, and only fail if no valid
 * signed copy exists anywhere.
 *
 * `sourceUrls` names relays the signed copy was recovered from, so the
 * caller can skip them as known holders.
 */
export async function ensureSignedEvent(event: any): Promise<{ signed: any; sourceUrls: string[] }> {
  if (!event?.id) throw new Error('Event has no id; cannot rebroadcast.');
  const ndkInstance = get(ndk);
  const { NDKEvent, NDKSubscriptionCacheUsage } = await import('@nostr-dev-kit/ndk');

  // A live NDKEvent with its signature is publishable as-is.
  if (event instanceof NDKEvent && event.sig) return { signed: event, sourceUrls: [] };

  // A signed plain object (e.g. a feed's instant cache): verify it and
  // rebuild an NDKEvent around it so it has publish().
  const inHand = verifiedPayload(event, event.id);
  if (inHand) return { signed: new NDKEvent(ndkInstance, inHand), sourceUrls: [] };

  // Direct wire fetch from up to 3 pool relays.
  const urls = rebroadcastRelayUrls(ndkInstance, []);
  for (const url of urls.slice(0, 3)) {
    const raw = verifiedPayload(await fetchSignedRawViaWs(url, event.id), event.id);
    if (raw) return { signed: new NDKEvent(ndkInstance, raw), sourceUrls: [url] };
  }

  // Relay-only: the default cache policy could hand back the same
  // signatureless cached copy that sent us here.
  const live: any = await Promise.race([
    ndkInstance.fetchEvent(
      { ids: [event.id] },
      { closeOnEose: true, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY }
    ),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), REBROADCAST_TIMEOUT_MS))
  ]);
  const fetched = verifiedPayload(live?.rawEvent ? live.rawEvent() : live, event.id);
  if (fetched) {
    return { signed: new NDKEvent(ndkInstance, fetched), sourceUrls: knownHolderUrls(live) };
  }

  throw new Error("Couldn't find a signed copy of this note to rebroadcast.");
}

/**
 * Rebroadcast an already-signed event to expanded relays.
 *
 * @param event any signed NDKEvent (kind 1 short note, 30023 long form, …).
 * @param previouslyConfirmedUrls extra relay URLs known to already hold the
 *        event; they are skipped along with the event's own relay/onRelays.
 */
export async function rebroadcastEvent(
  event: any,
  previouslyConfirmedUrls: string[] = []
): Promise<RebroadcastResult> {
  if (!browser) throw new Error('Rebroadcast is browser-only');

  const { signed, sourceUrls } = await ensureSignedEvent(event);

  const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
  const ndkInstance = get(ndk);
  // Known holders are excluded BEFORE the cap, so they can't use up the
  // 12 slots, and their duplicate OKs can't count as new coverage.
  const urls = rebroadcastRelayUrls(ndkInstance, [
    ...previouslyConfirmedUrls,
    ...knownHolderUrls(event),
    ...sourceUrls
  ]);

  if (urls.length === 0) {
    throw new Error('No relays available for rebroadcast.');
  }

  // Materialize + best-effort connect, mirroring publishQueue's approach.
  const relays: any[] = [];
  for (const url of urls) {
    const relay = ndkInstance.pool.getRelay(url, true, true);
    if (relay) relays.push(relay);
  }
  await Promise.all(relays.map((r) => r.connect().catch(() => {})));
  await new Promise((resolve) => setTimeout(resolve, 100));

  const relaySet = new NDKRelaySet(new Set(relays), ndkInstance);

  const result: RebroadcastResult = { confirmed: [], failed: [] };
  try {
    const published = await signed.publish(relaySet, REBROADCAST_TIMEOUT_MS);
    const confirmedKeys = new Set<string>();
    if (published && published.size > 0) {
      for (const relay of published) {
        const url = relay?.url || 'unknown';
        confirmedKeys.add(normalizeRelayUrl(url));
        result.confirmed.push(url);
      }
    }
    for (const relay of relays) {
      const key = normalizeRelayUrl(relay.url);
      if (!confirmedKeys.has(key)) result.failed.push(relay.url);
    }
  } catch (err: any) {
    // A total failure still reports which relays to retry, but for the
    // menu UX we surface a plain error and treat everything as unconfirmed.
    for (const relay of relays) result.failed.push(relay.url);
    throw Object.assign(
      new Error(err?.message || 'Rebroadcast failed on every relay.'),
      { result }
    );
  }
  return result;
}
