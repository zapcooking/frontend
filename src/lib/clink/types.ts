/**
 * Types for CLINK (Nostr-native LN protocol) noffer support.
 *
 * Spec: https://github.com/shocknet/CLINK/blob/main/specs/clink-offers.md
 *
 * The `noffer1…` bech32 string carries TLVs describing a static payment
 * offer. The payer encrypts a kind-21001 request to the service pubkey,
 * the service responds with an encrypted kind-21001 carrying a bolt11
 * invoice.
 */

export type PricingType = 'fixed' | 'variable' | 'spontaneous';

export interface NofferData {
  /** 32-byte service pubkey, hex-encoded lowercase. (TLV 0) */
  pubkey: string;
  /** Recommended relay URL where the service listens. (TLV 1) */
  relay: string;
  /** Opaque offer identifier the service uses to look up the offer. (TLV 2) */
  offerId: string;
  /** Pricing type — defaults to 'spontaneous' when TLV 3 is absent. */
  pricingType: PricingType;
  /** Price in sats. (TLV 4) Present for Fixed offers and as a hint for Variable. */
  price?: number;
  /** Currency code (TLV 5) — only meaningful when `pricingType === 'variable'`. */
  currency?: string;
}

/** Payload of the kind-21001 request event (NIP-44 encrypted before sending). */
export interface NofferRequest {
  offer: string;
  amount_sats?: number;
  payer_data?: Record<string, unknown>;
  zap?: string;
  expires_in_seconds?: number;
  description?: string;
}

/** Payload of the kind-21001 response event (NIP-44 encrypted on the wire). */
export interface NofferResponse {
  bolt11?: string;
  error?: string;
  code?: number;
  range?: { min: number; max: number };
  /** Present on error code 3 (Expired/Moved) — the noffer to use instead. */
  latest?: string;
}

export const NOFFER_ERROR_CODE = {
  INVALID_OFFER: 1,
  TEMPORARY_FAILURE: 2,
  EXPIRED_OR_MOVED: 3,
  UNSUPPORTED_FEATURE: 4,
  INVALID_AMOUNT: 5
} as const;

export class NofferError extends Error {
  code: number;
  range?: { min: number; max: number };
  latest?: string;
  constructor(
    code: number,
    message: string,
    range?: { min: number; max: number },
    latest?: string
  ) {
    super(message);
    this.name = 'NofferError';
    this.code = code;
    this.range = range;
    this.latest = latest;
  }
}
