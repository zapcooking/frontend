/**
 * Stream zap tally (unverified pass).
 *
 * Streams are addressable events: their zap receipts carry an `a` tag
 * rather than `e`, so the note/recipe tallies (`recipeZaps.ts`) cannot see
 * them. This sums receipts matching the stream address across the receipt
 * relays with the canonical amount extractor — the provider-verified rules
 * in `zapTotals.ts` refine this later.
 *
 * The scan runs on a nostr-tools pool, not the NDK instance: receipt relays
 * are read-heavy and this keeps the tally independent of NDK's connection
 * state (the NDK path returned empty when the pool was still warming up).
 */

import { extractZapAmountSats } from '$lib/zapAmount';
import { ZAP_AGGREGATOR_RELAYS } from '$lib/recipeZaps';
import { createStreamPool } from './relayPage';
import { DISCOVERY_RELAYS, RECEIPT_RELAYS } from './relays';

export interface StreamZapTally {
  totalSats: number;
  zapCount: number;
  /** Sender pubkey -> summed sats (0-sat receipts omitted). */
  satsByZapper: Map<string, number>;
}

const TALLY_MAX_WAIT_MS = 6000;

/** Relay set for receipt scans: the app's receipt coverage plus discovery. */
export function streamReceiptRelayUrls(): string[] {
  return [...new Set([...RECEIPT_RELAYS, ...ZAP_AGGREGATOR_RELAYS, ...DISCOVERY_RELAYS])];
}

/**
 * Sum the kind:9735 receipts targeting a stream address. Never throws —
 * returns whatever arrived before the timeout.
 */
export async function fetchStreamZapTally(address: string): Promise<StreamZapTally> {
  const tally: StreamZapTally = { totalSats: 0, zapCount: 0, satsByZapper: new Map() };
  const pool = createStreamPool();
  try {
    const events = (await pool.querySync(
      streamReceiptRelayUrls(),
      { kinds: [9735], '#a': [address], limit: 500 },
      { maxWait: TALLY_MAX_WAIT_MS }
    )) as unknown as { id: string; tags: string[][] }[];

    for (const receipt of events) {
      const { sats } = extractZapAmountSats(receipt);
      if (sats <= 0) continue;

      tally.totalSats += sats;
      tally.zapCount++;

      // Sender pubkey lives in the zap request (description tag), not on
      // the receipt itself.
      const descTag = receipt.tags.find((t) => t[0] === 'description');
      if (descTag?.[1]) {
        try {
          const zapRequest = JSON.parse(descTag[1]) as { pubkey?: unknown };
          if (typeof zapRequest.pubkey === 'string' && /^[a-f0-9]{64}$/.test(zapRequest.pubkey)) {
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
    console.debug('[StreamZaps] Fetch failed, keeping partial tally:', error);
  } finally {
    pool.destroy();
  }

  return tally;
}
