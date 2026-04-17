/**
 * Canonical zap-amount extraction for NIP-57 kind:9735 zap receipts.
 *
 * Source of truth is the bolt11 invoice embedded in the receipt: the Lightning
 * node actually settled that amount, while the `amount` tag on the inner zap
 * request is client-authored and — despite NIP-57 specifying millisats — is
 * written as plain sats by some clients. Using bolt11 sidesteps that divergence.
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

/**
 * Extract the sat amount of a kind:9735 zap receipt.
 *
 * Order: bolt11 first (ground truth), then the inner zap request's `amount`
 * tag as a fallback. When the fallback fires we log a warning so we can track
 * how often receipts arrive without a decodable invoice.
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
      console.warn(
        '[zapAmount] Falling back to zap-request amount tag; bolt11 missing or undecodable'
      );
      return { sats: Math.floor(msats / 1000), source: 'amount-tag' };
    }
  }

  return { sats: 0, source: 'none' };
}
