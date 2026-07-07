/**
 * Passkey-vault crypto primitives (vault format v1).
 *
 * Envelope layout — every constant here is part of the on-disk format and
 * the Android Phase 3 parity contract (fixtures: src/test/fixtures/vault-v1.json):
 *
 *   passkey PRF(PRF_INPUT) ──HKDF-SHA256(salt, info)──▶ KEK (32B)
 *   KEK ──AES-256-GCM(dekIv)──▶ wraps random DEK (32B)
 *   DEK ──NIP-44 v2 (DEK in place of the ECDH conversation key)──▶ nsecCiphertext
 *
 * The NIP-44-with-raw-key construction deliberately mirrors the Android
 * Google-backup crypto (BackupCrypto.kt / googleBackupCrypto.ts): nostr-tools
 * `nip44.v2.encrypt/decrypt` use the 32-byte conversation key directly as the
 * HKDF-expand PRK — ECDH only ever happens inside getConversationKey, which
 * this module never calls.
 *
 * Pure module: no WebAuthn, no storage, no Svelte imports — everything is
 * bytes in / bytes out so the vectors can be pinned. IV/nonce parameters are
 * injectable for the fixture tests ONLY; production callers must omit them.
 */

import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as nip44 from 'nostr-tools/nip44';

/** PRF extension eval input (UTF-8). Changing this orphans every vault. */
export const PRF_INPUT = 'zap.cooking/nsec-vault/v1';
/** HKDF salt/info for KEK derivation. Same warning as above. */
export const HKDF_SALT = 'zap.cooking/nsec-vault/v1';
export const HKDF_INFO = 'kek-aes256-gcm';

const utf8 = (s: string) => new TextEncoder().encode(s);

export function hexToBytes(hex: string): Uint8Array {
  if (!/^([0-9a-fA-F]{2})+$/.test(hex)) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function bytesToB64url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return b64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** Best-effort scrub of key material. Strings can't be zeroed in JS; pass buffers. */
export function zeroize(...buffers: Array<Uint8Array | null | undefined>): void {
  for (const b of buffers) b?.fill(0);
}

/** PRF output → 32-byte KEK. */
export function deriveKek(prfOutput: Uint8Array): Uint8Array {
  if (prfOutput.length !== 32) throw new Error('PRF output must be 32 bytes');
  return hkdf(sha256, prfOutput, utf8(HKDF_SALT), utf8(HKDF_INFO), 32);
}

/** AES-256-GCM wrap of the DEK under the KEK. `iv` injectable for tests only. */
export async function wrapDek(
  dek: Uint8Array,
  kek: Uint8Array,
  iv?: Uint8Array
): Promise<{ wrappedDek: Uint8Array; iv: Uint8Array }> {
  if (dek.length !== 32) throw new Error('DEK must be 32 bytes');
  if (kek.length !== 32) throw new Error('KEK must be 32 bytes');
  const usedIv = iv ?? crypto.getRandomValues(new Uint8Array(12));
  if (usedIv.length !== 12) throw new Error('IV must be 12 bytes');
  const key = await crypto.subtle.importKey('raw', kek as BufferSource, 'AES-GCM', false, [
    'encrypt'
  ]);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: usedIv as BufferSource },
    key,
    dek as BufferSource
  );
  return { wrappedDek: new Uint8Array(ct), iv: usedIv };
}

/** AES-256-GCM unwrap. Throws (fails closed) on tag mismatch / wrong KEK. */
export async function unwrapDek(
  wrappedDek: Uint8Array,
  iv: Uint8Array,
  kek: Uint8Array
): Promise<Uint8Array> {
  if (kek.length !== 32) throw new Error('KEK must be 32 bytes');
  const key = await crypto.subtle.importKey('raw', kek as BufferSource, 'AES-GCM', false, [
    'decrypt'
  ]);
  const pt = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      wrappedDek as BufferSource
    )
  );
  if (pt.length !== 32) throw new Error('unwrapped DEK is not 32 bytes');
  return pt;
}

/**
 * Encrypt the 64-char hex private key under the DEK (NIP-44 v2 payload).
 * `nonce` injectable for tests only.
 */
export function encryptNsec(privkeyHex: string, dek: Uint8Array, nonce?: Uint8Array): string {
  if (!/^[0-9a-f]{64}$/.test(privkeyHex)) {
    throw new Error('private key must be 64 lowercase hex characters');
  }
  if (dek.length !== 32) throw new Error('DEK must be 32 bytes');
  return nip44.v2.encrypt(privkeyHex, dek, nonce);
}

/** Decrypt the nsec envelope. Throws on HMAC failure (wrong DEK) or bad shape. */
export function decryptNsec(payload: string, dek: Uint8Array): string {
  if (dek.length !== 32) throw new Error('DEK must be 32 bytes');
  const hex = nip44.v2.decrypt(payload, dek);
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error('decrypted vault payload is not a 32-byte hex key');
  }
  return hex;
}

/** Random 32-byte DEK. */
export function generateDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
