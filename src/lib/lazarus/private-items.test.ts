import { generateSecretKey, getPublicKey, nip04, nip44 } from 'nostr-tools';
import { describe, expect, it } from 'vitest';
import {
  estimatePrivateItems,
  getContentEncryption,
  getPlaintextLengthRange,
  parsePrivateTags
} from './private-items';

/** Ported from the spec’s reference implementation (dmnyc/jumble-spark, feat/lazarus-data-recovery) (private-items.spec.ts):
 * the spec's private-items conformance vectors — real NIP-44 and NIP-04
 * payloads, so the sizing math is pinned against actual ciphertexts. */

const secretKey = generateSecretKey();
const pubkey = getPublicKey(secretKey);
const conversationKey = nip44.getConversationKey(secretKey, pubkey);

/** A private mute list of n pubkeys, encrypted to self the way clients do */
function privateMutes(n: number) {
  const tags = Array.from({ length: n }, () => ['p', getPublicKey(generateSecretKey())]);
  const plainText = JSON.stringify(tags);
  return { tags, plainText, nip44Content: nip44.encrypt(plainText, conversationKey) };
}

describe('getContentEncryption', () => {
  it('recognizes NIP-44 and NIP-04 payloads', async () => {
    const { plainText, nip44Content } = privateMutes(3);
    expect(getContentEncryption(nip44Content)).toBe('nip44');
    expect(getContentEncryption(await nip04.encrypt(secretKey, pubkey, plainText))).toBe('nip04');
  });

  it('does not treat plain content as encrypted', () => {
    expect(getContentEncryption('')).toBeNull();
    expect(getContentEncryption('{"wss://relay.damus.io":{"read":true,"write":true}}')).toBeNull();
    expect(getContentEncryption('encrypted-private-items')).toBeNull();
    expect(getContentEncryption('abc?iv=not base64!')).toBeNull();
  });
});

describe('estimatePrivateItems', () => {
  it('brackets the real count of a NIP-44 list across sizes', () => {
    for (const n of [0, 1, 3, 150, 593]) {
      const { plainText, nip44Content } = privateMutes(n);
      const lengths = getPlaintextLengthRange(nip44Content)!;
      expect(lengths.min).toBeLessThanOrEqual(plainText.length);
      expect(lengths.max).toBeGreaterThanOrEqual(plainText.length);
      const estimate = estimatePrivateItems(nip44Content)!;
      expect(estimate.min).toBeLessThanOrEqual(n);
      expect(estimate.max).toBeGreaterThanOrEqual(n);
    }
  });

  it('tells an emptied list apart from a full one', () => {
    const emptied = estimatePrivateItems(privateMutes(2).nip44Content)!;
    const full = estimatePrivateItems(privateMutes(593).nip44Content)!;
    expect(full.min).toBeGreaterThan(emptied.max);
  });

  it('brackets the real count of a NIP-04 list', async () => {
    const { plainText } = privateMutes(40);
    const content = await nip04.encrypt(secretKey, pubkey, plainText);
    const lengths = getPlaintextLengthRange(content)!;
    expect(lengths.min).toBeLessThanOrEqual(plainText.length);
    expect(lengths.max).toBeGreaterThanOrEqual(plainText.length);
    const estimate = estimatePrivateItems(content)!;
    expect(estimate.min).toBeLessThanOrEqual(40);
    expect(estimate.max).toBeGreaterThanOrEqual(40);
  });

  it('sizes NIP-44 padded lengths that are not powers of two', () => {
    // 300 bytes pad to 320, which holds any plaintext from 257 bytes up
    const content = nip44.encrypt('x'.repeat(300), conversationKey);
    expect(getPlaintextLengthRange(content)).toEqual({ min: 257, max: 320 });
    expect(estimatePrivateItems(content)).toEqual({ min: 3, max: 5 });
  });

  it('lets a one-block NIP-04 payload hold no items', async () => {
    // One block holds 0 to 15 bytes, so the minimum is zero, never negative
    const content = await nip04.encrypt(secretKey, pubkey, '[]');
    expect(getPlaintextLengthRange(content)).toEqual({ min: 0, max: 15 });
    expect(estimatePrivateItems(content)).toEqual({ min: 0, max: 1 });
  });

  it('returns undefined for payloads that are not a valid size', () => {
    expect(estimatePrivateItems('A'.repeat(133))).toBeUndefined();
    expect(estimatePrivateItems('plain text')).toBeUndefined();
  });
});

describe('parsePrivateTags', () => {
  it('parses a decrypted tag list and rejects anything else', () => {
    const { tags, plainText } = privateMutes(2);
    expect(parsePrivateTags(plainText)).toEqual(tags);
    expect(parsePrivateTags('{"not":"tags"}')).toBeUndefined();
    expect(parsePrivateTags('not json')).toBeUndefined();
  });
});
