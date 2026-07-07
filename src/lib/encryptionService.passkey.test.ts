import { describe, it, expect, beforeEach, vi } from 'vitest';
import fixture from '../test/fixtures/vault-v1.json';
import { getPublicKey } from 'nostr-tools';

/**
 * encryptionService signer-key detection for passkey-vault sessions.
 *
 * The key requirement (Gate 2 ruling): detection must NOT rely on the
 * signer's class name — minification mangles constructor names in
 * production. These tests use a signer class whose name contains no
 * "PrivateKeySigner" substring at all; a name-based implementation of
 * getPrivateKey() would fail them.
 */

vi.mock('$app/environment', () => ({ browser: true }));

const { fakeNdk } = vi.hoisted(() => ({ fakeNdk: { signer: null as unknown } }));
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable(fakeNdk) };
});

import { hasEncryptionSupport, encrypt, decrypt } from './encryptionService';
import { hexToBytes } from './passkeyVaultCrypto';

// Deliberately mangled name — simulates production minification output.
class Xq {
  privateKey: string;
  constructor(pk: string) {
    this.privateKey = pk;
  }
}

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };
  (globalThis as any).window = {}; // no window.nostr
  fakeNdk.signer = null;
});

describe('in-memory signer key detection (duck-typed, minification-proof)', () => {
  it('hasEncryptionSupport is true with a mangled-name signer and empty localStorage', () => {
    fakeNdk.signer = new Xq(fixture.nsecHex);
    expect(store.get('nostrcooking_privateKey')).toBeUndefined();
    expect(hasEncryptionSupport()).toBe(true);
  });

  it('hasEncryptionSupport is false without a key anywhere', () => {
    fakeNdk.signer = new Xq('not-a-key'); // property present but not 64-hex
    expect(hasEncryptionSupport()).toBe(false);
  });

  it('encrypt/decrypt round-trip using ONLY the in-memory signer key', async () => {
    fakeNdk.signer = new Xq(fixture.nsecHex);
    const selfPubkey = getPublicKey(hexToBytes(fixture.nsecHex));

    const { ciphertext, method } = await encrypt(selfPubkey, 'passkey vault says hi');
    expect(method).toBe('nip44');
    // Nothing was ever read from (or written to) localStorage.
    expect(store.size).toBe(0);

    await expect(decrypt(selfPubkey, ciphertext, 'nip44')).resolves.toBe('passkey vault says hi');
  });

  it('a NIP-46-shaped signer (no privateKey getter) cannot leak a key', async () => {
    fakeNdk.signer = { remotePubkey: 'ab'.repeat(32) }; // no privateKey property
    expect(hasEncryptionSupport()).toBe(false);
    await expect(encrypt('cd'.repeat(32), 'x')).rejects.toThrow();
  });

  it('legacy plaintext sessions still work via the localStorage fallback', () => {
    fakeNdk.signer = null;
    store.set('nostrcooking_privateKey', fixture.nsecHex);
    expect(hasEncryptionSupport()).toBe(true);
  });
});
