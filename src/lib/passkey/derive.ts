// SPIKE ONLY — Phase C.0 derivation pipeline.
// Throwaway code under spike/passkey-prf-validation. NOT for production.
// Real Phase C will re-implement with server-verified challenges, salt
// registry publishing, authManager integration, and proper test coverage.

import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { getPublicKey, nip19 } from 'nostr-tools';

// "NYOASTRTSAOYN" per Breez passkey-login spec v0.9.1 — fixed challenge that
// distinguishes the master derivation from any user-chosen salt.
export const PRF_MAGIC = new Uint8Array([
  0x4e, 0x59, 0x4f, 0x41, 0x53, 0x54, 0x52, 0x54, 0x53, 0x41, 0x4f, 0x59, 0x4e
]);

// Default per-app salt. Phase B locked this in for v1; multi-salt UX is v2.
export const ZAP_COOKING_SALT = new TextEncoder().encode('zap.cooking');

export interface SaltRegistry {
  pubkeyHex: string;
  privkey: Uint8Array;
  mnemonic: string; // 24-word phrase derived from PRF(MAGIC) — for diagnostics
}

export interface IdentityAccount {
  npub: string;
  pubkeyHex: string;
  privkey: Uint8Array;
  mnemonic: string; // 24-word phrase derived from PRF(salt) — backup phrase
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derive the salt registry account (NIP-06 path m/44'/1237'/55'/0/0)
 * from the 32-byte PRF(MAGIC) output.
 */
export async function deriveSaltRegistryAccount(prfMaster: Uint8Array): Promise<SaltRegistry> {
  if (prfMaster.length !== 32) {
    throw new Error(`PRF master must be 32 bytes, got ${prfMaster.length}`);
  }
  const mnemonic = bip39.entropyToMnemonic(prfMaster, wordlist);
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const node = root.derive("m/44'/1237'/55'/0/0");
  if (!node.privateKey) throw new Error('No private key derived for salt registry path');
  return {
    pubkeyHex: getPublicKey(node.privateKey),
    privkey: node.privateKey,
    mnemonic
  };
}

/**
 * Derive the per-salt identity account (NIP-06 path m/44'/1237'/0'/0/0)
 * from the 32-byte PRF(salt) output. Returns the user's nsec/npub for that salt.
 */
export async function deriveSaltIdentity(prfSalt: Uint8Array): Promise<IdentityAccount> {
  if (prfSalt.length !== 32) {
    throw new Error(`PRF salt output must be 32 bytes, got ${prfSalt.length}`);
  }
  const mnemonic = bip39.entropyToMnemonic(prfSalt, wordlist);
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const node = root.derive("m/44'/1237'/0'/0/0");
  if (!node.privateKey) throw new Error('No private key derived for identity path');
  const pubkeyHex = getPublicKey(node.privateKey);
  return {
    npub: nip19.npubEncode(pubkeyHex),
    pubkeyHex,
    privkey: node.privateKey,
    mnemonic
  };
}

export function nsecFromPrivkey(privkey: Uint8Array): string {
  return nip19.nsecEncode(privkey);
}

export { bytesToHex };
