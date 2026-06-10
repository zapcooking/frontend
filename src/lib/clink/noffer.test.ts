/**
 * Tests for the CLINK noffer1… bech32 decoder.
 *
 * We don't have a publicly-shared production noffer to use as a fixture
 * (the user's profile noffer in the screenshot is truncated in the UI),
 * so the tests encode synthetic noffers via the same `bech32` library
 * and round-trip them through the decoder. Each test pins the TLV byte
 * layout described in the CLINK spec.
 */

import { describe, it, expect } from 'vitest';
import { bech32 } from 'bech32';
import { decodeNoffer, isNofferString, stripNostrPrefix } from './noffer';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return out;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function encodeTestNoffer(tlvs: Array<{ type: number; value: Uint8Array }>): string {
  const parts: number[] = [];
  for (const { type, value } of tlvs) {
    parts.push(type, value.length, ...value);
  }
  const words = bech32.toWords(new Uint8Array(parts));
  return bech32.encode('noffer', words, 5000);
}

// A 32-byte hex string (the user's pubkey from the conversation — used
// because it's a known-real pubkey, makes the test fixture meaningful).
const PUBKEY = 'ee6ea13ab9fe5c4a68eaf9b1a34fe014a66b40117c50ee2a614f4cda959b6e74';
const RELAY = 'wss://relay.example.com';
const OFFER_ID = 'tip-jar';

describe('decodeNoffer', () => {
  it('decodes the minimum-required TLVs (0/1/2) and defaults pricingType to spontaneous', () => {
    const noffer = encodeTestNoffer([
      { type: 0, value: hexToBytes(PUBKEY) },
      { type: 1, value: utf8(RELAY) },
      { type: 2, value: utf8(OFFER_ID) }
    ]);
    const decoded = decodeNoffer(noffer);
    expect(decoded.pubkey).toBe(PUBKEY);
    expect(decoded.relay).toBe(RELAY);
    expect(decoded.offerId).toBe(OFFER_ID);
    expect(decoded.pricingType).toBe('spontaneous');
    expect(decoded.price).toBeUndefined();
    expect(decoded.currency).toBeUndefined();
  });

  it('decodes Fixed pricing with a price in sats (TLVs 3 + 4)', () => {
    const noffer = encodeTestNoffer([
      { type: 0, value: hexToBytes(PUBKEY) },
      { type: 1, value: utf8(RELAY) },
      { type: 2, value: utf8(OFFER_ID) },
      { type: 3, value: new Uint8Array([0]) }, // Fixed
      { type: 4, value: new Uint8Array([0x27, 0x10]) } // 10000 big-endian
    ]);
    const decoded = decodeNoffer(noffer);
    expect(decoded.pricingType).toBe('fixed');
    expect(decoded.price).toBe(10000);
  });

  it('decodes Variable pricing with a currency code (TLVs 3 + 5)', () => {
    const noffer = encodeTestNoffer([
      { type: 0, value: hexToBytes(PUBKEY) },
      { type: 1, value: utf8(RELAY) },
      { type: 2, value: utf8(OFFER_ID) },
      { type: 3, value: new Uint8Array([1]) }, // Variable
      { type: 5, value: utf8('USD') }
    ]);
    const decoded = decodeNoffer(noffer);
    expect(decoded.pricingType).toBe('variable');
    expect(decoded.currency).toBe('USD');
  });

  it('accepts the nostr: URI prefix', () => {
    const noffer = encodeTestNoffer([
      { type: 0, value: hexToBytes(PUBKEY) },
      { type: 1, value: utf8(RELAY) },
      { type: 2, value: utf8(OFFER_ID) }
    ]);
    expect(decodeNoffer('nostr:' + noffer).pubkey).toBe(PUBKEY);
    expect(decodeNoffer('NOSTR:' + noffer).pubkey).toBe(PUBKEY);
  });

  it('throws on non-noffer hrp', () => {
    expect(() => decodeNoffer('npub1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toThrow();
  });

  it('throws on missing required TLVs', () => {
    const noffer = encodeTestNoffer([
      { type: 0, value: hexToBytes(PUBKEY) }
      // missing relay + offer id
    ]);
    expect(() => decodeNoffer(noffer)).toThrow(/relay/i);
  });

  it('throws on pubkey TLV with wrong length', () => {
    const noffer = encodeTestNoffer([
      { type: 0, value: new Uint8Array(16) }, // 16-byte pubkey is invalid
      { type: 1, value: utf8(RELAY) },
      { type: 2, value: utf8(OFFER_ID) }
    ]);
    expect(() => decodeNoffer(noffer)).toThrow(/pubkey/i);
  });
});

describe('isNofferString', () => {
  it('matches bare noffer1', () => {
    const noffer = encodeTestNoffer([
      { type: 0, value: hexToBytes(PUBKEY) },
      { type: 1, value: utf8(RELAY) },
      { type: 2, value: utf8(OFFER_ID) }
    ]);
    expect(isNofferString(noffer)).toBe(true);
  });
  it('matches nostr:noffer1', () => {
    const noffer = encodeTestNoffer([
      { type: 0, value: hexToBytes(PUBKEY) },
      { type: 1, value: utf8(RELAY) },
      { type: 2, value: utf8(OFFER_ID) }
    ]);
    expect(isNofferString('nostr:' + noffer)).toBe(true);
  });
  it('does not match npub', () => {
    expect(isNofferString('npub1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(false);
  });
  it('does not match empty / null / undefined', () => {
    expect(isNofferString('')).toBe(false);
    expect(isNofferString(null)).toBe(false);
    expect(isNofferString(undefined)).toBe(false);
  });
});

describe('stripNostrPrefix', () => {
  it('strips nostr: when present', () => {
    expect(stripNostrPrefix('nostr:noffer1abc')).toBe('noffer1abc');
    expect(stripNostrPrefix('NOSTR:noffer1abc')).toBe('noffer1abc');
  });
  it('is a no-op when absent', () => {
    expect(stripNostrPrefix('noffer1abc')).toBe('noffer1abc');
  });
});
