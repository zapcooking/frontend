/**
 * NIP-51 private items: a list can carry items encrypted to its author's own
 * key in `content` (NIP-44, or NIP-04 in older events) next to its public
 * tags. A private-only mute list has no public tags at all, so counting tags
 * alone reads a full list and an emptied one as the same zero. These helpers
 * size private items from the encrypted payload without decrypting, and
 * count them exactly once decrypted.
 *
 * Vendored from the spec’s reference implementation (dmnyc/jumble-spark, branch feat/lazarus-data-recovery)
 * (src/services/lazarus/private-items.ts); its one zod import is replaced
 * with a hand-rolled guard, this repo not depending on zod.
 */

export type LazarusEncryption = 'nip04' | 'nip44';

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// NIP-44 v2 payload: version (1) + nonce (32) + [u16 length (2) + padded plaintext] + mac (32)
const NIP44_OVERHEAD_BYTES = 67;
// The smallest payload holds 32 bytes of padded plaintext: 99 bytes, 132 base64 characters
const NIP44_MIN_PAYLOAD_CHARS = 132;

/**
 * A private item is a JSON-encoded tag, most often ["p", <64-hex pubkey>]:
 * 72 characters, plus a comma between items. Estimates assume that shape,
 * so lists heavy on short words or hashtags hold more items than estimated.
 */
const BYTES_PER_ITEM = 73;

/** How a list's content is encrypted, or null when it isn't (e.g. kind 3 relay JSON). */
export function getContentEncryption(content: string): LazarusEncryption | null {
  const value = content.trim();
  if (!value) return null;
  const [cipherText, iv, ...rest] = value.split('?iv=');
  if (iv !== undefined) {
    return rest.length === 0 && BASE64.test(cipherText) && BASE64.test(iv) ? 'nip04' : null;
  }
  return value.length >= NIP44_MIN_PAYLOAD_CHARS && BASE64.test(value) ? 'nip44' : null;
}

function base64ByteLength(value: string): number | undefined {
  if (value.length % 4) return undefined;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/** NIP-44 v2 padded length for a plaintext of `length` bytes. */
function nip44PaddedLength(length: number): number {
  if (length <= 32) return 32;
  const nextPower = 1 << (Math.floor(Math.log2(length - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((length - 1) / chunk) + 1);
}

/** The range of plaintext lengths (bytes) an encrypted payload can hold, from its size alone. */
export function getPlaintextLengthRange(content: string): { min: number; max: number } | undefined {
  const value = content.trim();
  const encryption = getContentEncryption(value);

  if (encryption === 'nip04') {
    const bytes = base64ByteLength(value.split('?iv=')[0]);
    // AES-CBC with PKCS#7 always adds 1–16 bytes of padding
    if (!bytes || bytes % 16) return undefined;
    return { min: bytes - 16, max: bytes - 1 };
  }

  if (encryption === 'nip44') {
    const bytes = base64ByteLength(value);
    if (bytes === undefined) return undefined;
    const padded = bytes - NIP44_OVERHEAD_BYTES;
    if (padded < 32 || padded > 65536 || nip44PaddedLength(padded) !== padded) return undefined;
    // The smallest plaintext that pads to this length
    let low = 1;
    let high = padded;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (nip44PaddedLength(mid) >= padded) high = mid;
      else low = mid + 1;
    }
    return { min: low, max: padded };
  }

  return undefined;
}

/** How many private items an encrypted payload holds, estimated from its size. */
export function estimatePrivateItems(content: string): { min: number; max: number } | undefined {
  const range = getPlaintextLengthRange(content);
  if (!range) return undefined;
  // A JSON array of n such tags is 73n + 1 bytes
  return {
    min: Math.max(Math.floor((range.min - 1) / BYTES_PER_ITEM), 0),
    max: Math.max(Math.ceil((range.max - 1) / BYTES_PER_ITEM), 0)
  };
}

/** A parsed plaintext is a private-tag list only when it is an array of
 * string arrays — anything else (a kind 3's relay JSON, a profile blob) is
 * not private items. */
function isTagList(value: unknown): value is string[][] {
  return (
    Array.isArray(value) && value.every((tag) => Array.isArray(tag) && tag.every((s) => typeof s === 'string'))
  );
}

/** Decrypted private items, or undefined when the plaintext isn't a tag list. */
export function parsePrivateTags(plainText: string): string[][] | undefined {
  try {
    const parsed: unknown = JSON.parse(plainText);
    return isTagList(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function countItemTags(tags: string[][], types: string[]): number {
  return tags.filter((tag) => types.includes(tag[0])).length;
}
