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
 * minus relays that already confirmed the event (best-effort knowledge:
 * receipt sets aren't queryable after the fact, so a caller may pass the
 * confirmed set; when unknown, everything is simply attempted).
 *
 * Publishing uses NDK directly (not publishQueue): the queue exists to
 * make AUTHORING resilient (signing, offline persistence, retries). A
 * rebroadcast is a best-effort fan-out of an existing immutable event:
 * partial delivery is success, and queueing a retry would defeat the
 * "expand coverage where it is thin" intent by re-aiming at the same
 * relays later.
 */

import { get } from 'svelte/store';
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
 * Rebroadcast an already-signed event to expanded relays.
 *
 * @param event any signed NDKEvent (kind 1 short note, 30023 long form, …).
 * @param previouslyConfirmedUrls relay URLs known to already hold the event;
 *        they are skipped. Pass nothing to attempt every pool ∪ standard relay.
 */
export async function rebroadcastEvent(
  event: any,
  previouslyConfirmedUrls: string[] = []
): Promise<RebroadcastResult> {
  if (!browser) throw new Error('Rebroadcast is browser-only');
  if (!event?.sig) throw new Error('Event is not signed');

  const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
  const ndkInstance = get(ndk);
  const urls = rebroadcastRelayUrls(ndkInstance, previouslyConfirmedUrls);

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
    const published = await event.publish(relaySet, REBROADCAST_TIMEOUT_MS);
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
