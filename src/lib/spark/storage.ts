import { xchacha20poly1305 } from '@noble/ciphers/xchacha'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

const LOCAL_STORAGE_KEY_PREFIX = 'spark_wallet_'

/**
 * Derives a 32-byte (256-bit) encryption key from the user's Nostr public key and a password.
 * @param pubkey The user's Nostr public key (hex string).
 * @param password The user-provided password.
 * @returns A Uint8Array representing the 32-byte encryption key.
 */
function deriveKey(pubkey: string, password: string): Uint8Array {
	const dataToHash = new TextEncoder().encode(pubkey + password)
	return sha256(dataToHash)
}

/**
 * Saves an encrypted mnemonic to local storage.
 * The mnemonic is encrypted using XChaCha20-Poly1305 with a key derived from the Nostr pubkey and password.
 * @param pubkey The user's Nostr public key (hex string).
 * @param password The user-provided password.
 * @param mnemonic The mnemonic string to encrypt and save.
 */
export async function saveMnemonic(pubkey: string, password: string, mnemonic: string): Promise<void> {
	const key = deriveKey(pubkey, password)
	const nonce = crypto.getRandomValues(new Uint8Array(24)) // 24-byte nonce for XChaCha20-Poly1305
	const plaintext = new TextEncoder().encode(mnemonic)

	const cipher = xchacha20poly1305(key, nonce)
	const ciphertext = cipher.encrypt(plaintext)

	// Store nonce + ciphertext as a single hex string
	const storedData = bytesToHex(new Uint8Array([...nonce, ...ciphertext]))
	localStorage.setItem(`${LOCAL_STORAGE_KEY_PREFIX}${pubkey}`, storedData)
}

/**
 * Loads and decrypts a mnemonic from local storage.
 * @param pubkey The user's Nostr public key (hex string).
 * @param password The user-provided password used for encryption.
 * @returns The decrypted mnemonic string, or null if not found or decryption fails.
 */
export async function loadMnemonic(pubkey: string, password: string): Promise<string | null> {
	const storedDataHex = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${pubkey}`)
	if (!storedDataHex) {
		return null
	}

	try {
		const storedData = hexToBytes(storedDataHex)
		const nonce = storedData.slice(0, 24)
		const ciphertext = storedData.slice(24)

		const key = deriveKey(pubkey, password)
		const cipher = xchacha20poly1305(key, nonce)
		const decrypted = cipher.decrypt(ciphertext)

		return new TextDecoder().decode(decrypted)
	} catch (error) {
		console.error('Failed to decrypt mnemonic:', error)
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
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i)
		if (key && key.startsWith(LOCAL_STORAGE_KEY_PREFIX)) {
			localStorage.removeItem(key)
		}
	}
}
