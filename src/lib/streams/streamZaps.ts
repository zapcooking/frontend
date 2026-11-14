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

import { targetFilter } from './target';
import { extractZapAmountSats } from '$lib/zapAmount';
import { ZAP_AGGREGATOR_RELAYS } from '$lib/recipeZaps';
import { verifyEvent } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools/filter';
import { createStreamPool, relayPage } from './relayPage';
import { resolveZapProvider } from './zapProvider';
import { embeddedRequestOf, extraZapRelays, relayHints, zapHistory, ZapTotals } from './zapTotals';
import { DISCOVERY_RELAYS, RECEIPT_RELAYS } from './relays';
import type { NostrEventLike } from './types';

export interface StreamZapTally {
  totalSats: number;
  zapCount: number;
  /** Sender pubkey -> summed sats (0-sat receipts omitted). */
  satsByZapper: Map<string, number>;
}

const TALLY_MAX_WAIT_MS = 6000;
const SCAN_PAGE_SIZE = 250;
const SCAN_MAX_PAGES = 30;
const SCAN_PAGE_TIMEOUT_MS = 8000;

/** Relay set for receipt scans: the app's receipt coverage plus discovery. */
export function streamReceiptRelayUrls(): string[] {
  return [...new Set([...RECEIPT_RELAYS, ...ZAP_AGGREGATOR_RELAYS, ...DISCOVERY_RELAYS])];
}

/**
 * Sum the kind:9735 receipts targeting a stream address. Never throws —
 * returns whatever arrived before the timeout.
 */
export async function fetchStreamZapTally(
  address: string,
  extraRelays: string[] = []
): Promise<StreamZapTally> {
  const tally: StreamZapTally = { totalSats: 0, zapCount: 0, satsByZapper: new Map() };
  const pool = createStreamPool();
  // The zap request's own relay set (NIP-65 outbox) is where the provider
  // publishes the receipt for THIS zapper's zap — the aggregator set alone
  // can miss fresh receipts until they propagate.
  const relays = [...new Set([...streamReceiptRelayUrls(), ...extraRelays])];
  try {
    const events = (await pool.querySync(
      relays,
      { kinds: [9735], ...targetFilter(address), limit: 500 },
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

// ── Deep history scan (Sidecar's verified pipeline) ────────────────────
//
// A single querySync per relay caps at the relay's most recent `limit`
// receipts, which reads as roughly half of a long stream's true total.
// This scan walks each relay's history backward page by page (Sidecar's
// zapHistory: inclusive boundary draining, done/capped/failed per relay),
// counting only receipts the host's own LNURL provider signed when the
// provider resolves — zap.stream's rule — and falling back to accept-all
// with id dedupe when it does not. An archive second pass follows the
// relay hints the accepted zap requests carry.

export interface StreamZapScanResult {
  tally: StreamZapTally;
  /** Counted under provider-signed acceptance rules. */
  verified: boolean;
  /** Every scanned relay answered EOSE through its whole history. */
  complete: boolean;
}

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export async function scanStreamZapHistory(
  address: string,
  host: string | null,
  opts: {
    hostRelays?: string[];
    /** The zap request's own relay set — where fresh receipts land first. */
    extraRelays?: string[];
    signal?: AbortSignal;
    onPartial?: (tally: StreamZapTally) => void;
  } = {}
): Promise<StreamZapScanResult> {
  const {
    hostRelays = [],
    extraRelays = [],
    signal = new AbortController().signal,
    onPartial
  } = opts;
  const pool = createStreamPool();
  const tally: StreamZapTally = { totalSats: 0, zapCount: 0, satsByZapper: new Map() };
  const seenIds = new Set<string>();
  const hints = new Map<string, number>();
  let verified = false;
  let complete = false;
  let lastEmit = 0;

  const emit = (force = false) => {
    if (!onPartial) return;
    const now = Date.now();
    if (!force && now - lastEmit < 400) return;
    lastEmit = now;
    onPartial({
      totalSats: tally.totalSats,
      zapCount: tally.zapCount,
      satsByZapper: new Map(tally.satsByZapper)
    });
  };

  const countUnverified = (event: NostrEventLike): boolean => {
    if (seenIds.has(event.id)) return false;
    seenIds.add(event.id);
    const row = receiptRowFor(event);
    if (!row) return false;
    tally.totalSats += row.sats;
    tally.zapCount++;
    if (row.sender) {
      tally.satsByZapper.set(row.sender, (tally.satsByZapper.get(row.sender) || 0) + row.sats);
    }
    for (const hint of relayHints(embeddedRequestOf(event)))
      hints.set(hint, (hints.get(hint) || 0) + 1);
    return true;
  };

  const totals = new ZapTotals();
  const countVerified = (event: NostrEventLike, provider: string): Promise<boolean> =>
    totals
      .accept(event, {
        address,
        recipient: host || '',
        provider,
        verify: verifyEvent as never,
        digest: sha256Hex
      })
      .then((ok) => {
        if (!ok) return false;
        seenIds.add(event.id);
        for (const hint of relayHints(embeddedRequestOf(event)))
          hints.set(hint, (hints.get(hint) || 0) + 1);
        return true;
      });

  const accept = (provider: string | null) => async (event: NostrEventLike) => {
    if (provider) {
      const ok = await countVerified(event, provider);
      if (!ok) return;
      tally.totalSats = totals.msats / 1000;
      tally.zapCount = totals.count;
      tally.satsByZapper = new Map(
        [...totals.authors].map(([pubkey, msats]) => [pubkey, msats / 1000])
      );
      emit();
    } else if (countUnverified(event)) {
      emit();
    }
  };

  try {
    const relays = [...new Set([...streamReceiptRelayUrls(), ...extraRelays])];
    const baseFilter = { kinds: [9735], ...targetFilter(address) };
    const query = (relay: string, filter: Record<string, unknown>) =>
      relayPage<NostrEventLike>(pool, relay, filter as Filter, signal, SCAN_PAGE_TIMEOUT_MS);

    // Provider first: it decides whether receipts are countable at all.
    // When the provider cannot resolve for a hosted stream, verification is
    // impossible — returning an empty tally (the page keeps its last
    // verified result) is safer than accepting receipts from any signer.
    let provider: string | null = null;
    if (host) {
      try {
        provider = (
          await resolveZapProvider(
            pool,
            [...new Set([...DISCOVERY_RELAYS, ...hostRelays])],
            host,
            signal
          )
        ).nostrPubkey;
      } catch {
        provider = null;
      }
      if (!provider) {
        return {
          tally: { totalSats: 0, zapCount: 0, satsByZapper: new Map() },
          verified: false,
          complete: false
        };
      }
    }
    verified = !!provider;

    const history = await zapHistory({
      sources: relays,
      query,
      accept: accept(provider),
      filter: { ...baseFilter, until: Math.floor(Date.now() / 1000) },
      signal,
      pageSize: SCAN_PAGE_SIZE,
      maxPages: SCAN_MAX_PAGES
    });
    complete = history.complete;
    emit(true);

    // Archive second pass: relays that hold many receipts, on Sidecar's
    // clock (batches with a deadline) so the first number never waits.
    if (!signal.aborted) {
      const more = extraZapRelays({ known: relays, hints, limit: 8 });
      if (more.length) {
        const archive = await zapHistory({
          sources: more,
          query,
          accept: accept(provider),
          filter: { ...baseFilter, until: Math.floor(Date.now() / 1000) },
          signal,
          pageSize: SCAN_PAGE_SIZE,
          maxPages: 15
        });
        complete = complete && archive.complete;
        emit(true);
      }
    }

    return { tally, verified, complete };
  } finally {
    pool.destroy();
  }
}

/** The zap request embedded in a receipt's description tag, when valid. */
/** Sats + sender of a receipt, for the fallback accept-all counter. */
function receiptRowFor(event: NostrEventLike): { sats: number; sender: string | null } | null {
  const { sats } = extractZapAmountSats(event);
  if (sats <= 0) return null;
  const desc = event.tags.find((t) => t[0] === 'description');
  if (desc?.[1]) {
    try {
      const request = JSON.parse(desc[1]) as { pubkey?: unknown };
      if (typeof request.pubkey === 'string' && /^[a-f0-9]{64}$/.test(request.pubkey)) {
        return { sats, sender: request.pubkey };
      }
    } catch {
      // Malformed description — the amount still counts.
    }
  }
  return { sats, sender: null };
}
