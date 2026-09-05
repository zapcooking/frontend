/**
 * Zap receipt fetching for recipe pages
 *
 * Both TotalZaps and TopZappers need the kind:9735 receipts for a
 * recipe event. They used to open five dedicated raw WebSockets per
 * page mount (one per aggregator relay) — duplicated fan-out, sockets
 * not shared with anything else in the app. Fetching through the NDK
 * pool with an explicit relay set gets the same coverage while reusing
 * already-connected pool relays (nos.lol, relay.primal.net, nostr.wine
 * are in the default pool) and deduping the rest.
 */

import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { extractZapAmountSats } from '$lib/zapAmount';

// Aggregator relays known to have good zap data (tested for response
// time and zap coverage).
export const ZAP_AGGREGATOR_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://offchain.pub',
  'wss://relay.snort.social'
];

export interface ZapTally {
  totalSats: number;
  zapCount: number;
  /** Sender pubkey -> summed sats (senders with 0-sats receipts omitted). */
  satsByZapper: Map<string, number>;
}

/**
 * Fetch and tally zap receipts for an event from the aggregator relays.
 * Never throws — returns whatever arrived before the timeout.
 */
export async function fetchZapTally(
  eventId: string,
  limit = 500,
  timeoutMs = 6000
): Promise<ZapTally> {
  const tally: ZapTally = { totalSats: 0, zapCount: 0, satsByZapper: new Map() };
  const $ndk = get(ndk);
  if (!$ndk) return tally;

  try {
    const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
    const relaySet = NDKRelaySet.fromRelayUrls(ZAP_AGGREGATOR_RELAYS, $ndk, true);
    const events = await Promise.race([
      $ndk.fetchEvents({ kinds: [9735], '#e': [eventId], limit }, { closeOnEose: true }, relaySet),
      new Promise<Set<NDKEvent>>((resolve) => setTimeout(() => resolve(new Set()), timeoutMs))
    ]);

    for (const zapEvent of events) {
      if (!zapEvent.id) continue;

      const { sats } = extractZapAmountSats(zapEvent);
      if (sats <= 0) continue;

      tally.totalSats += sats;
      tally.zapCount++;

      // Sender pubkey lives in the zap request (description tag), not on
      // the receipt itself.
      const descTag = zapEvent.tags.find((t) => t[0] === 'description');
      if (descTag?.[1]) {
        try {
          const zapRequest = JSON.parse(descTag[1]);
          if (zapRequest.pubkey) {
            tally.satsByZapper.set(
              zapRequest.pubkey,
              (tally.satsByZapper.get(zapRequest.pubkey) || 0) + sats
            );
          }
        } catch {
          // Ignore malformed description tags
        }
      }
    }
  } catch (error) {
    console.debug('[RecipeZaps] Fetch failed, keeping partial tally:', error);
  }

  return tally;
}
