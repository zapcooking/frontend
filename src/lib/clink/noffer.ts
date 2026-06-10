/**
 * CLINK noffer1… bech32 decoder.
 *
 * Spec: https://github.com/shocknet/CLINK/blob/main/specs/clink-offers.md
 *
 *   TLV 0 — 32-byte service pubkey
 *   TLV 1 — recommended relay URL (utf-8)
 *   TLV 2 — opaque offer identifier (utf-8)
 *   TLV 3 — (opt) pricing type: 0=Fixed, 1=Variable, 2=Spontaneous (default)
 *   TLV 4 — (opt) price in sats (big-endian)
 *   TLV 5 — (opt) currency code (utf-8; only meaningful with type 1)
 *
 * nostr-tools 2.13 does not include `noffer` in `nip19`, so this module
 * hand-rolls the TLV decode against the existing `bech32` package
 * (already used in `src/lib/zapManager.ts`).
 */

import { bech32 } from 'bech32';
import type { NofferData, PricingType } from './types';

const NOFFER_HRP = 'noffer';

// noffer payloads can comfortably exceed bech32's default 90-char limit
// (the user's profile noffer in the screenshot is ~85+ chars and that's a
// short offer id). nostr-tools sets this to 5000 for nip19 — match it.
const BECH32_LIMIT = 5000;

const TLV_PUBKEY = 0;
const TLV_RELAY = 1;
const TLV_OFFER_ID = 2;
const TLV_PRICING_TYPE = 3;
const TLV_PRICE = 4;
const TLV_CURRENCY = 5;

interface TlvEntry {
  type: number;
  value: Uint8Array;
}

function parseTlvs(bytes: Uint8Array): TlvEntry[] {
  const tlvs: TlvEntry[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 2 > bytes.length) {
      throw new Error('Malformed noffer: TLV header truncated');
    }
    const type = bytes[offset];
    const length = bytes[offset + 1];
    if (offset + 2 + length > bytes.length) {
      throw new Error(`Malformed noffer: TLV ${type} body truncated`);
    }
    tlvs.push({ type, value: bytes.slice(offset + 2, offset + 2 + length) });
    offset += 2 + length;
  }
  return tlvs;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function bytesToBigEndianInt(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    n = n * 256 + bytes[i];
  }
  return n;
}

function pricingTypeFromByte(byte: number): PricingType {
  if (byte === 0) return 'fixed';
  if (byte === 1) return 'variable';
  return 'spontaneous';
}

/**
 * Decode a `noffer1…` (or `nostr:noffer1…`) string into its TLV fields.
 *
 * Throws on:
 * - wrong HRP / non-bech32 input,
 * - missing required TLVs 0/1/2,
 * - truncated TLV bytes,
 * - pubkey TLV not exactly 32 bytes.
 */
export function decodeNoffer(input: string): NofferData {
  const cleaned = input.trim().replace(/^nostr:/i, '');
  if (!cleaned.toLowerCase().startsWith(NOFFER_HRP + '1')) {
    throw new Error("Not a noffer string (expected 'noffer1…')");
  }

  const decoded = bech32.decode(cleaned.toLowerCase(), BECH32_LIMIT);
  if (decoded.prefix !== NOFFER_HRP) {
    throw new Error(`Expected hrp 'noffer', got '${decoded.prefix}'`);
  }

  const bytes = new Uint8Array(bech32.fromWords(decoded.words));
  const tlvs = parseTlvs(bytes);

  const pubkeyTlv = tlvs.find((t) => t.type === TLV_PUBKEY);
  if (!pubkeyTlv || pubkeyTlv.value.length !== 32) {
    throw new Error('Malformed noffer: missing or wrong-length pubkey (TLV 0)');
  }
  const relayTlv = tlvs.find((t) => t.type === TLV_RELAY);
  if (!relayTlv) throw new Error('Malformed noffer: missing relay (TLV 1)');
  const offerIdTlv = tlvs.find((t) => t.type === TLV_OFFER_ID);
  if (!offerIdTlv) throw new Error('Malformed noffer: missing offer id (TLV 2)');

  const pricingTypeTlv = tlvs.find((t) => t.type === TLV_PRICING_TYPE);
  const priceTlv = tlvs.find((t) => t.type === TLV_PRICE);
  const currencyTlv = tlvs.find((t) => t.type === TLV_CURRENCY);

  const data: NofferData = {
    pubkey: bytesToHex(pubkeyTlv.value),
    relay: bytesToUtf8(relayTlv.value),
    offerId: bytesToUtf8(offerIdTlv.value),
    pricingType: pricingTypeTlv ? pricingTypeFromByte(pricingTypeTlv.value[0]) : 'spontaneous'
  };
  if (priceTlv && priceTlv.value.length > 0) {
    data.price = bytesToBigEndianInt(priceTlv.value);
  }
  if (currencyTlv && currencyTlv.value.length > 0) {
    data.currency = bytesToUtf8(currencyTlv.value);
  }
  return data;
}

/**
 * Lightweight detector — checks shape only, does NOT decode TLVs.
 * Use this in regex/segment parsers where you just need to know "is this
 * a noffer-shaped token". For real use, call `decodeNoffer()` and let it
 * throw if malformed.
 */
export function isNofferString(s: string | undefined | null): s is string {
  if (typeof s !== 'string') return false;
  return /^(nostr:)?noffer1[023456789acdefghjklmnpqrstuvwxyz]{6,}$/i.test(s.trim());
}

/**
 * Strip a leading `nostr:` prefix if present and return the bare
 * `noffer1…` token. Useful for building `lightning:` URIs and copy-to-
 * clipboard affordances.
 *
 * Trims surrounding whitespace before the prefix check so a stored
 * profile field like `"  nostr:noffer1…"` doesn't leak its leading
 * spaces into the `lightning:` URI or the clipboard. `isNofferString`
 * already trims on its own match, so callers that validated with it
 * could otherwise produce an invalid `lightning: nostr:…` URI here.
 */
export function stripNostrPrefix(noffer: string): string {
  return noffer.trim().replace(/^nostr:/i, '');
}
