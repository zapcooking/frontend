/**
 * Google Drive nsec backup crypto — WEB port of the Android reference
 * (zap_cooking_android: auth/BackupCrypto.kt + nostr/Nip44.kt + nostr/Hkdf.kt).
 *
 * PARITY IS LOAD-BEARING. A key backed up on Android must decrypt on web and
 * vice versa. Every constant and construction below is chosen to reproduce the
 * Android output byte-for-byte. Do not "modernize" any of it:
 *   - SALT string stays "wisp-google-backup" (baked into every existing Android
 *     backup in the wild; changing it orphans them).
 *   - PBKDF2 stays 600000 iterations, SHA-256, 32-byte output.
 *   - The PBKDF2 output is used DIRECTLY as the NIP-44 v2 "conversation key"
 *     (BackupCrypto does not do the ECDH + HKDF-extract that normal NIP-44 does;
 *     it substitutes the derived key). Then standard NIP-44 v2 message-key
 *     expansion + ChaCha20 + HMAC-SHA256 (encrypt-then-MAC) applies.
 *   - identity = the Google ID token `sub` claim (NOT email).
 *
 * Verified against @noble/hashes@2 + @noble/ciphers@2 (already in package.json).
 * noble's ChaCha20 == RFC 8439 == BouncyCastle ChaCha7539Engine used by Android
 * (counter starts at 0). Confirmed against the RFC 8439 §2.4.2 known-answer
 * vector and against a fixture generated from the Android logic — see
 * google-backup-crypto.test.ts and google-backup-parity-fixture.json.
 *
 * NOTE on imports: @noble v2 requires the ".js" subpath suffix and exports
 * `expand` as a named function (there is no `hkdf.expand` method).
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { expand as hkdfExpand } from '@noble/hashes/hkdf.js';
import { chacha20 } from '@noble/ciphers/chacha.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const SALT = 'wisp-google-backup';
const PBKDF2_ITERATIONS = 600_000;
const KEY_BYTES = 32;
const NIP44_VERSION = 0x02;

export function isValidPin(pin: string): boolean {
	return /^[0-9]{4,8}$/.test(pin);
}

/** HMAC-SHA256(key = "wisp-google-backup", msg = sub) — mirrors perAccountSalt(). */
function perAccountSalt(sub: string): Uint8Array {
	return hmac(sha256, utf8ToBytes(SALT), utf8ToBytes(sub));
}

/** PBKDF2-HMAC-SHA256(pin, perAccountSalt(sub), 600k, 32B) — mirrors deriveBackupKey(). */
export function deriveBackupKey(sub: string, pin: string): Uint8Array {
	if (!sub) throw new Error('Google sub claim must not be empty');
	if (!isValidPin(pin)) throw new Error('PIN must be 4–8 digits');
	const salt = perAccountSalt(sub);
	return pbkdf2(sha256, utf8ToBytes(pin), salt, { c: PBKDF2_ITERATIONS, dkLen: KEY_BYTES });
}

// ---- NIP-44 v2 (matches Nip44.kt exactly) ----

function calcPaddedLen(len: number): number {
	if (len <= 32) return 32;
	const nextPow2 = 1 << (32 - Math.clz32(len - 1));
	const chunk = Math.max(32, nextPow2 / 8);
	return Math.floor((len + chunk - 1) / chunk) * chunk;
}

function pad(plaintext: Uint8Array): Uint8Array {
	const len = plaintext.length;
	if (len < 1 || len > 65535) throw new Error('Plaintext must be 1-65535 bytes');
	const out = new Uint8Array(2 + calcPaddedLen(len));
	out[0] = (len >> 8) & 0xff;
	out[1] = len & 0xff;
	out.set(plaintext, 2);
	return out;
}

function unpad(padded: Uint8Array): Uint8Array {
	const len = (padded[0] << 8) | padded[1];
	if (len < 1 || len > padded.length - 2) throw new Error('Invalid padding length');
	return padded.slice(2, 2 + len);
}

/** HKDF-Expand(prk = conversationKey, info = nonce, len = 76). */
function deriveMessageKeys(conversationKey: Uint8Array, nonce: Uint8Array): Uint8Array {
	return hkdfExpand(sha256, conversationKey, nonce, 76);
}

function b64encode(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}
function b64decode(s: string): Uint8Array {
	return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function nip44EncryptWithNonce(
	plaintext: string,
	conversationKey: Uint8Array,
	nonce: Uint8Array
): string {
	const padded = pad(utf8ToBytes(plaintext));
	const mk = deriveMessageKeys(conversationKey, nonce);
	const chachaKey = mk.slice(0, 32);
	const chachaNonce = mk.slice(32, 44);
	const hmacKey = mk.slice(44, 76);
	const ciphertext = chacha20(chachaKey, chachaNonce, padded);
	const mac = hmac(sha256, hmacKey, concat(nonce, ciphertext));
	return b64encode(concat(new Uint8Array([NIP44_VERSION]), nonce, ciphertext, mac));
}

function nip44Decrypt(payloadB64: string, conversationKey: Uint8Array): string {
	const data = b64decode(payloadB64);
	if (data.length < 99) throw new Error('Payload too short');
	if (data[0] !== NIP44_VERSION) throw new Error(`Unsupported NIP-44 version: ${data[0]}`);
	const nonce = data.slice(1, 33);
	const ciphertext = data.slice(33, data.length - 32);
	const mac = data.slice(data.length - 32);
	const mk = deriveMessageKeys(conversationKey, nonce);
	const chachaKey = mk.slice(0, 32);
	const chachaNonce = mk.slice(32, 44);
	const hmacKey = mk.slice(44, 76);
	const expected = hmac(sha256, hmacKey, concat(nonce, ciphertext));
	if (!constantTimeEqual(mac, expected)) throw new Error('HMAC verification failed');
	const padded = chacha20(chachaKey, chachaNonce, ciphertext);
	return new TextDecoder().decode(unpad(padded));
}

function concat(...arrays: Uint8Array[]): Uint8Array {
	const total = arrays.reduce((n, a) => n + a.length, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const a of arrays) {
		out.set(a, off);
		off += a.length;
	}
	return out;
}
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
	return r === 0;
}

// ---- Public API (matches encryptNsec / decryptNsec) ----

/**
 * @param nsec  32-byte private key (raw bytes). encryptNsec on Android encrypts
 *              the LOWERCASE HEX string of these bytes, so we do the same.
 * @param key   32-byte backup key from deriveBackupKey().
 */
export function encryptNsec(nsec: Uint8Array, key: Uint8Array): string {
	if (nsec.length !== 32) throw new Error('nsec must be 32 bytes');
	if (key.length !== 32) throw new Error('backup key must be 32 bytes');
	// A random 32-byte nonce in production; deterministic only in the parity test.
	const nonce = crypto.getRandomValues(new Uint8Array(32));
	return nip44EncryptWithNonce(bytesToHex(nsec), key, nonce);
}

export function decryptNsec(payload: string, key: Uint8Array): Uint8Array {
	if (key.length !== 32) throw new Error('backup key must be 32 bytes');
	const hex = nip44Decrypt(payload, key);
	if (hex.length !== 64) throw new Error('decrypted backup is not a 32-byte hex string');
	return hexToBytes(hex);
}

// Exposed for the parity test (deterministic nonce). Do NOT use in production.
export const __testing = { nip44EncryptWithNonce, nip44Decrypt, perAccountSalt };
