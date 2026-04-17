/**
 * Canonical zap-amount extraction for NIP-57 kind:9735 zap receipts.
 *
 * Source of truth is the bolt11 invoice embedded in the receipt: the Lightning
 * node actually settled that amount, which is unambiguous. The inner zap
 * request's `amount` tag is a spec-compliant (NIP-57: millisats) fallback used
 * only when bolt11 is missing or undecodable — we do not attempt to detect
 * clients that write sats there, since sats-vs-msats can't be disambiguated
 * without heuristics that would break small zaps.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/57.md
 */

import { decode } from '@gandlaf21/bolt11-decode';

export type ZapAmountSource = 'bolt11' | 'amount-tag' | 'none';

export interface ZapAmountResult {
  /** Amount in sats, floored. 0 if unextractable. */
  sats: number;
  /** Which field the value came from, for telemetry / sanity checks. */
  source: ZapAmountSource;
}

interface ZapEventLike {
  tags: string[][];
}

function findTag(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

function msatsFromBolt11(bolt11: string): number | null {
  try {
    const decoded = decode(bolt11);
    const amountSection = decoded.sections.find(
      (s: { name: string; value?: unknown }) => s.name === 'amount'
    );
    if (!amountSection?.value) return null;
    const msats = Number(amountSection.value);
    return Number.isFinite(msats) && msats > 0 ? msats : null;
  } catch {
    return null;
  }
}

function msatsFromZapRequestTag(descriptionTag: string): number | null {
  try {
    const zapRequest = JSON.parse(descriptionTag);
    const amount = zapRequest?.tags?.find?.(
      (t: string[]) => t[0] === 'amount'
    )?.[1];
    if (!amount) return null;
    const msats = parseInt(amount, 10);
    return Number.isFinite(msats) && msats > 0 ? msats : null;
  } catch {
    return null;
  }
}

// Warn at most once per session when the amount-tag fallback fires. The extractor
// is called on hot paths (feeds, caches, subscriptions) — an unconditional warn
// would flood the console and degrade performance under noisy relays.
let fallbackWarned = false;

/**
 * Extract the sat amount of a kind:9735 zap receipt.
 *
 * Order: bolt11 first (ground truth), then the inner zap request's `amount`
 * tag as a fallback. When the fallback fires we log a warning at most once per
 * session so we can track how often receipts arrive without a decodable invoice.
 */
export function extractZapAmountSats(event: ZapEventLike): ZapAmountResult {
  const bolt11 = findTag(event.tags, 'bolt11');
  if (bolt11) {
    const msats = msatsFromBolt11(bolt11);
    if (msats !== null) {
      return { sats: Math.floor(msats / 1000), source: 'bolt11' };
    }
  }

  const description = findTag(event.tags, 'description');
  if (description) {
    const msats = msatsFromZapRequestTag(description);
    if (msats !== null) {
      if (!fallbackWarned) {
        fallbackWarned = true;
        console.warn(
          '[zapAmount] Falling back to zap-request amount tag; bolt11 missing or undecodable (further occurrences suppressed)'
        );
      }
      return { sats: Math.floor(msats / 1000), source: 'amount-tag' };
    }
  }

  return { sats: 0, source: 'none' };
}
