import { describe, it, expect } from 'vitest';
import fixture from '../test/fixtures/vault-v1.json';
import {
  PRF_INPUT,
  HKDF_SALT,
  HKDF_INFO,
  deriveKek,
  wrapDek,
  unwrapDek,
  encryptNsec,
  decryptNsec,
  generateDek,
  hexToBytes,
  bytesToB64,
  b64ToBytes,
  bytesToB64url,
  b64urlToBytes,
  zeroize
} from './passkeyVaultCrypto';
import { getPublicKey } from 'nostr-tools';
import { __testing as googleBackupNip44 } from './googleBackup/googleBackupCrypto';

/**
 * Vault v1 crypto vectors. The fixture file is the parity contract for the
 * Android implementation (Phase 3) — if any assertion here fails after a
 * dependency bump, the vault FORMAT changed and existing vaults would break.
 */

const bytesToHex = (b: Uint8Array) =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');

const prfOutput = () => hexToBytes(fixture.prfOutputHex);
const dek = () => hexToBytes(fixture.dekHex);
const dekIv = () => hexToBytes(fixture.dekIvHex);
const kek = () => hexToBytes(fixture.expectedKekHex);

describe('fixture self-consistency', () => {
  it('constants match the module', () => {
    expect(fixture.constants.prfInput).toBe(PRF_INPUT);
    expect(fixture.constants.hkdfSalt).toBe(HKDF_SALT);
    expect(fixture.constants.hkdfInfo).toBe(HKDF_INFO);
  });

  it('pubkey derives from the fixture nsec', () => {
    expect(getPublicKey(hexToBytes(fixture.nsecHex))).toBe(fixture.pubkeyHex);
  });
});

describe('deriveKek', () => {
  it('matches the fixture vector', () => {
    expect(bytesToHex(deriveKek(prfOutput()))).toBe(fixture.expectedKekHex);
  });

  it('rejects non-32-byte PRF output', () => {
    expect(() => deriveKek(new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe('wrapDek / unwrapDek', () => {
  it('wrap matches the fixture vector with the fixed IV', async () => {
    const { wrappedDek, iv } = await wrapDek(dek(), kek(), dekIv());
    expect(bytesToB64(wrappedDek)).toBe(fixture.expectedWrappedDekB64);
    expect(bytesToHex(iv)).toBe(fixture.dekIvHex);
  });

  it('unwrap recovers the DEK from the fixture ciphertext', async () => {
    const out = await unwrapDek(b64ToBytes(fixture.expectedWrappedDekB64), dekIv(), kek());
    expect(bytesToHex(out)).toBe(fixture.dekHex);
  });

  it('fails closed on a tampered wrapped DEK (GCM tag)', async () => {
    const tampered = b64ToBytes(fixture.expectedWrappedDekB64);
    tampered[3] ^= 0x01;
    await expect(unwrapDek(tampered, dekIv(), kek())).rejects.toThrow();
  });

  it('fails closed under the wrong KEK', async () => {
    const wrongKek = kek();
    wrongKek[0] ^= 0xff;
    await expect(
      unwrapDek(b64ToBytes(fixture.expectedWrappedDekB64), dekIv(), wrongKek)
    ).rejects.toThrow();
  });

  it('uses a random 12-byte IV when none is injected', async () => {
    const a = await wrapDek(dek(), kek());
    const b = await wrapDek(dek(), kek());
    expect(a.iv).toHaveLength(12);
    expect(bytesToHex(a.iv)).not.toBe(bytesToHex(b.iv));
  });
});

describe('encryptNsec / decryptNsec', () => {
  it('matches the fixture vector with the fixed nonce', () => {
    expect(encryptNsec(fixture.nsecHex, dek(), hexToBytes(fixture.nip44NonceHex))).toBe(
      fixture.expectedNsecCiphertextB64
    );
  });

  it('decrypts the fixture ciphertext', () => {
    expect(decryptNsec(fixture.expectedNsecCiphertextB64, dek())).toBe(fixture.nsecHex);
  });

  it('cross-validates against the independent googleBackupCrypto NIP-44 implementation', () => {
    // Two separately written NIP-44-with-raw-key implementations exist in this
    // repo (nostr-tools here, the hand-rolled Android-parity port for Google
    // backup). They must agree — this is the strongest local evidence that the
    // Android port in Phase 3 will interoperate.
    expect(googleBackupNip44.nip44Decrypt(fixture.expectedNsecCiphertextB64, dek())).toBe(
      fixture.nsecHex
    );
    const theirs = googleBackupNip44.nip44EncryptWithNonce(
      fixture.nsecHex,
      dek(),
      hexToBytes(fixture.nip44NonceHex)
    );
    expect(theirs).toBe(fixture.expectedNsecCiphertextB64);
  });

  it('round-trips with a random nonce', () => {
    const ct = encryptNsec(fixture.nsecHex, dek());
    expect(ct).not.toBe(fixture.expectedNsecCiphertextB64);
    expect(decryptNsec(ct, dek())).toBe(fixture.nsecHex);
  });

  it('fails closed under the wrong DEK (NIP-44 HMAC)', () => {
    const wrongDek = dek();
    wrongDek[0] ^= 0xff;
    expect(() => decryptNsec(fixture.expectedNsecCiphertextB64, wrongDek)).toThrow();
  });

  it('rejects non-hex plaintext on encrypt', () => {
    expect(() => encryptNsec('nsec1notahexkey', dek())).toThrow(/hex/);
    expect(() => encryptNsec(fixture.nsecHex.toUpperCase(), dek())).toThrow(/hex/);
  });
});

describe('helpers', () => {
  it('base64url round-trips the fixture credential id', () => {
    const bytes = b64urlToBytes(fixture.credentialIdB64url);
    expect(bytesToB64url(bytes)).toBe(fixture.credentialIdB64url);
    expect(bytes).toHaveLength(16);
  });

  it('generateDek returns 32 random bytes', () => {
    const a = generateDek();
    const b = generateDek();
    expect(a).toHaveLength(32);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('zeroize clears buffers and tolerates null', () => {
    const buf = hexToBytes('deadbeef');
    zeroize(buf, null, undefined);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0]);
  });
});
