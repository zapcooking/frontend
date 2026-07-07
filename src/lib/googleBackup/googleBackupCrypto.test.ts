import { describe, it, expect } from 'vitest';
import {
	deriveBackupKey,
	encryptNsec,
	decryptNsec,
	isValidPin,
	__testing
} from './googleBackupCrypto';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import fixture from './google-backup-parity-fixture.json';

/**
 * Cross-platform parity for the Google Drive nsec backup.
 *
 * The fixture was generated to match the Android reference implementation
 * (BackupCrypto.kt + Nip44.kt + Hkdf.kt). If any of these assertions fail, the
 * web crypto has drifted and backups will NOT be mutually decryptable with
 * Android — even though round-trip-with-itself would still pass. That is the
 * whole reason this fixture exists: self-round-trip proves nothing about parity.
 *
 * If you change a constant here to make a test pass, STOP — you are almost
 * certainly breaking compatibility with every key already backed up on Android.
 */
describe('Google backup crypto — Android parity', () => {
	const { sub, pin, nsecHex, nonceHex } = fixture.input;

	it('per-account salt matches Android', () => {
		expect(bytesToHex(__testing.perAccountSalt(sub))).toBe(fixture.expected.perAccountSaltHex);
	});

	it('derived backup key matches Android (PBKDF2 600k / SHA-256 / 32B)', () => {
		expect(bytesToHex(deriveBackupKey(sub, pin))).toBe(fixture.expected.backupKeyHex);
	});

	it('NIP-44 v2 payload matches Android byte-for-byte (fixed nonce)', () => {
		const key = deriveBackupKey(sub, pin);
		const payload = __testing.nip44EncryptWithNonce(nsecHex, key, hexToBytes(nonceHex));
		expect(payload).toBe(fixture.expected.payloadBase64);
	});

	it('decrypts the Android-produced payload back to the nsec', () => {
		const key = deriveBackupKey(sub, pin);
		expect(__testing.nip44Decrypt(fixture.expected.payloadBase64, key)).toBe(nsecHex);
	});
});

describe('Google backup crypto — behaviour', () => {
	it('round-trips a random nsec through the public API', () => {
		const key = deriveBackupKey('107654321098765432109', '4729');
		const nsec = hexToBytes(fixture.input.nsecHex);
		const payload = encryptNsec(nsec, key);
		expect(bytesToHex(decryptNsec(payload, key))).toBe(fixture.input.nsecHex);
	});

	it('fails to decrypt with the wrong PIN (PIN really is a second factor)', () => {
		const good = deriveBackupKey('107654321098765432109', '4729');
		const bad = deriveBackupKey('107654321098765432109', '4728');
		const payload = encryptNsec(hexToBytes(fixture.input.nsecHex), good);
		expect(() => decryptNsec(payload, bad)).toThrow(); // HMAC verification failed
	});

	it('validates PIN format (4–8 digits)', () => {
		expect(isValidPin('4729')).toBe(true);
		expect(isValidPin('12345678')).toBe(true);
		expect(isValidPin('123')).toBe(false);
		expect(isValidPin('123456789')).toBe(false);
		expect(isValidPin('47a9')).toBe(false);
	});
});
