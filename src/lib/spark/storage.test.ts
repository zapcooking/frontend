import { describe, it, expect, beforeEach, vi } from 'vitest';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';

/**
 * V1 -> V2 mnemonic migration.
 *
 * V1 derived its encryption key as sha256(pubkey). The pubkey is public,
 * so a V1 record is decryptable by anyone who can read localStorage —
 * these records must be upgraded proactively, and must never be dropped
 * when the upgrade can't complete.
 */

const { encryption } = vi.hoisted(() => ({
  encryption: {
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    detectEncryptionMethod: vi.fn()
  }
}));

vi.mock('$lib/encryptionService', () => encryption);

import {
  hasLegacyMnemonic,
  hasMnemonic,
  migrateLegacyMnemonic,
  loadMnemonic
} from './storage';

const PUBKEY = 'b'.repeat(64);
const MNEMONIC = 'abandon abandon abandon abandon about';
const KEY = `spark_wallet_${PUBKEY}`;

/** Build a V1 record exactly the way the legacy writer did. */
function makeV1Record(pubkey: string, mnemonic: string): string {
  const key = sha256(hexToBytes(pubkey));
  const nonce = new Uint8Array(24).fill(7);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(new TextEncoder().encode(mnemonic));
  const out = new Uint8Array(nonce.length + ciphertext.length);
  out.set(nonce);
  out.set(ciphertext, nonce.length);
  return bytesToHex(out);
}

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null
  };

  encryption.encrypt.mockReset();
  encryption.decrypt.mockReset();
  encryption.detectEncryptionMethod.mockReset();
  encryption.encrypt.mockResolvedValue({ ciphertext: 'V2-CIPHERTEXT', method: 'nip44v2' });
  encryption.decrypt.mockResolvedValue(MNEMONIC);
  encryption.detectEncryptionMethod.mockReturnValue('nip44v2');
});

describe('hasLegacyMnemonic', () => {
  it('is true for a V1 hex record', () => {
    store.set(KEY, makeV1Record(PUBKEY, MNEMONIC));
    expect(hasLegacyMnemonic(PUBKEY)).toBe(true);
  });

  it('is false for a V2 record', () => {
    store.set(KEY, JSON.stringify({ version: 2, ciphertext: 'V2-CIPHERTEXT' }));
    expect(hasLegacyMnemonic(PUBKEY)).toBe(false);
  });

  it('is false when nothing is stored', () => {
    expect(hasLegacyMnemonic(PUBKEY)).toBe(false);
  });
});

describe('migrateLegacyMnemonic', () => {
  it('rewrites a V1 record as V2 without changing the mnemonic', async () => {
    store.set(KEY, makeV1Record(PUBKEY, MNEMONIC));

    const migrated = await migrateLegacyMnemonic(PUBKEY);

    expect(migrated).toBe(true);
    // The plaintext handed to encrypt() is the original mnemonic — proves
    // the V1 decrypt path is still correct.
    expect(encryption.encrypt).toHaveBeenCalledWith(PUBKEY, MNEMONIC);
    expect(JSON.parse(store.get(KEY)!)).toEqual({ version: 2, ciphertext: 'V2-CIPHERTEXT' });
    expect(hasLegacyMnemonic(PUBKEY)).toBe(false);
  });

  it('is a no-op for records already on V2', async () => {
    const v2 = JSON.stringify({ version: 2, ciphertext: 'V2-CIPHERTEXT' });
    store.set(KEY, v2);

    expect(await migrateLegacyMnemonic(PUBKEY)).toBe(false);
    expect(encryption.encrypt).not.toHaveBeenCalled();
    expect(store.get(KEY)).toBe(v2);
  });

  it('is a no-op when nothing is stored', async () => {
    expect(await migrateLegacyMnemonic(PUBKEY)).toBe(false);
    expect(store.has(KEY)).toBe(false);
  });

  it('leaves the V1 record intact when the signer refuses to encrypt', async () => {
    const v1 = makeV1Record(PUBKEY, MNEMONIC);
    store.set(KEY, v1);
    encryption.encrypt.mockRejectedValue(new Error('signer denied'));

    await expect(migrateLegacyMnemonic(PUBKEY)).rejects.toThrow('signer denied');

    // Never lose the mnemonic: V1 survives so a later attempt can retry.
    expect(store.get(KEY)).toBe(v1);
    expect(hasMnemonic(PUBKEY)).toBe(true);
    expect(hasLegacyMnemonic(PUBKEY)).toBe(true);
  });

  it('leaves the record alone when the V1 payload cannot be decrypted', async () => {
    store.set(KEY, 'deadbeef');

    expect(await migrateLegacyMnemonic(PUBKEY)).toBe(false);
    expect(store.get(KEY)).toBe('deadbeef');
    expect(encryption.encrypt).not.toHaveBeenCalled();
  });
});

describe('loadMnemonic still reads both formats', () => {
  it('reads a V1 record and migrates it on the way out', async () => {
    store.set(KEY, makeV1Record(PUBKEY, MNEMONIC));

    expect(await loadMnemonic(PUBKEY)).toBe(MNEMONIC);
    expect(hasLegacyMnemonic(PUBKEY)).toBe(false);
  });

  it('reads a V2 record via the encryption service', async () => {
    store.set(KEY, JSON.stringify({ version: 2, ciphertext: 'V2-CIPHERTEXT' }));

    expect(await loadMnemonic(PUBKEY)).toBe(MNEMONIC);
    expect(encryption.decrypt).toHaveBeenCalledWith(PUBKEY, 'V2-CIPHERTEXT', 'nip44v2');
  });
});
