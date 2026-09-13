/**
 * At-rest storage for the Spark wallet mnemonic.
 *
 * V2 wraps the mnemonic in a NIP-44 encrypt-to-self envelope. Note the
 * honest limitation: for plaintext-nsec sessions the wrapping key is the
 * identity key sitting in `nostrcooking_privateKey` in the same
 * localStorage, so an attacker who can read one key can read the other —
 * the envelope is not a defense against local storage compromise there.
 * It IS a real defense for NIP-07 and passkey-vault sessions, where the
 * identity key never sits at rest, and it collapses to vault strength
 * once a user enrolls a passkey.
 *
 * Deriving the envelope key from something else was considered and
 * rejected: it would orphan every mnemonic already stored as V2.
 *
 * V1 (legacy) derived its key as `sha256(pubkey)` — the pubkey is public,
 * so a V1 record is decryptable by anyone who can read localStorage. V1
 * records must be migrated on sight, not merely on next wallet open.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { encrypt, decrypt, detectEncryptionMethod } from '$lib/encryptionService'

const LOCAL_STORAGE_KEY_PREFIX = 'spark_wallet_'

// ── V2 storage format ────────────────────────────────────────

interface StoredMnemonicV2 {
	version: 2
	ciphertext: string
}

// ── V1 legacy support (migration only) ──────────────────────

/** @deprecated V1 key derivation — used only for migrating old stored mnemonics */
function deriveKeyV1(pubkey: string): Uint8Array {
	const pubkeyBytes = hexToBytes(pubkey)
	return sha256(pubkeyBytes)
}

/** Decrypt a V1 (XChaCha20-Poly1305 with pubkey-derived key) stored mnemonic */
function decryptV1(pubkey: string, storedDataHex: string): string | null {
	try {
		const storedData = hexToBytes(storedDataHex)
		const nonce = storedData.slice(0, 24)
		const ciphertext = storedData.slice(24)
		const key = deriveKeyV1(pubkey)
		const cipher = xchacha20poly1305(key, nonce)
		const decrypted = cipher.decrypt(ciphertext)
		return new TextDecoder().decode(decrypted)
	} catch {
		return null
	}
}

// ── V2: NIP-44 encrypt-to-self ──────────────────────────────

/**
 * Saves an encrypted mnemonic to local storage using NIP-44 encrypt-to-self.
 * The mnemonic can only be decrypted with the user's Nostr private key.
 * @param pubkey The user's Nostr public key (hex string).
 * @param mnemonic The mnemonic string to encrypt and save.
 */
export async function saveMnemonic(pubkey: string, mnemonic: string): Promise<void> {
	const { ciphertext } = await encrypt(pubkey, mnemonic)
	const stored: StoredMnemonicV2 = { version: 2, ciphertext }
	localStorage.setItem(`${LOCAL_STORAGE_KEY_PREFIX}${pubkey}`, JSON.stringify(stored))
}

/**
 * Loads and decrypts a mnemonic from local storage.
 * Handles both V2 (NIP-44) and V1 (legacy XChaCha20) formats.
 * V1 data is silently migrated to V2 on successful load when a signer is available.
 * @param pubkey The user's Nostr public key (hex string).
 * @returns The decrypted mnemonic string, or null if not found or decryption fails.
 */
export async function loadMnemonic(pubkey: string): Promise<string | null> {
	const raw = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${pubkey}`)
	if (!raw) return null

	// Try V2 JSON format first
	try {
		const parsed = JSON.parse(raw) as StoredMnemonicV2
		if (parsed.version === 2 && parsed.ciphertext) {
			const method = detectEncryptionMethod(parsed.ciphertext)
			return await decrypt(pubkey, parsed.ciphertext, method)
		}
	} catch {
		// JSON parse failed — this is a V1 legacy hex string
	}

	// V1 legacy: decrypt with old method, then migrate to V2
	try {
		const mnemonic = decryptV1(pubkey, raw)
		if (!mnemonic) {
			console.error('[Wallet Storage] Failed to decrypt V1 mnemonic')
			return null
		}

		// Silent migration to V2 (best-effort; if signer unavailable, skip)
		try {
			await saveMnemonic(pubkey, mnemonic)
		} catch {
			// Migration failed (signer unavailable) — mnemonic stays in V1 until next load
		}

		return mnemonic
	} catch (error) {
		console.error('[Wallet Storage] Failed to decrypt mnemonic:', error)
		return null
	}
}

/**
 * Checks if a mnemonic exists in local storage for a given public key.
 * @param pubkey The user's Nostr public key (hex string).
 * @returns True if a mnemonic exists, false otherwise.
 */
export function hasMnemonic(pubkey: string): boolean {
	return localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${pubkey}`) !== null
}

/**
 * Is this pubkey's stored mnemonic still in the legacy V1 format?
 *
 * Cheap and synchronous (no decryption, no signer) so it can gate the
 * login-time sweep without cost for the common V2 case.
 * @param pubkey The user's Nostr public key (hex string).
 */
export function hasLegacyMnemonic(pubkey: string): boolean {
	const raw = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${pubkey}`)
	if (!raw) return false
	try {
		const parsed = JSON.parse(raw) as StoredMnemonicV2
		return !(parsed?.version === 2 && !!parsed.ciphertext)
	} catch {
		// Not JSON — a V1 legacy hex string.
		return true
	}
}

/**
 * Upgrade a V1 record to V2 without opening the wallet.
 *
 * `loadMnemonic` already migrates on read, but it only runs when the user
 * actually opens the Spark wallet — so a V1 record could sit decryptable-
 * by-anyone indefinitely. This is the proactive sweep, called once per
 * pubkey at login.
 *
 * V1 data is left untouched unless the V2 write succeeds, so a failure
 * here can never lose the mnemonic; the next attempt simply retries.
 *
 * @param pubkey The user's Nostr public key (hex string).
 * @returns True if a record was migrated, false if there was nothing to do.
 */
export async function migrateLegacyMnemonic(pubkey: string): Promise<boolean> {
	const raw = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${pubkey}`)
	if (!raw || !hasLegacyMnemonic(pubkey)) return false

	const mnemonic = decryptV1(pubkey, raw)
	if (!mnemonic) {
		console.error('[Wallet Storage] Could not decrypt V1 mnemonic for migration')
		return false
	}

	// saveMnemonic overwrites the key only after encrypt() resolves, so a
	// signer denial throws here and leaves the V1 record in place.
	await saveMnemonic(pubkey, mnemonic)
	return true
}

/**
 * Deletes a mnemonic from local storage for a given public key.
 * @param pubkey The user's Nostr public key (hex string).
 */
export function deleteMnemonic(pubkey: string): void {
	localStorage.removeItem(`${LOCAL_STORAGE_KEY_PREFIX}${pubkey}`)
}

/**
 * Clears all Spark wallet mnemonics from local storage.
 */
export function clearAllSparkWallets(): void {
	const keysToRemove: string[] = []
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i)
		if (key && key.startsWith(LOCAL_STORAGE_KEY_PREFIX)) {
			keysToRemove.push(key)
		}
	}
	keysToRemove.forEach((key) => localStorage.removeItem(key))
}
