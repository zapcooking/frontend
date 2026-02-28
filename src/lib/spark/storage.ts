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
