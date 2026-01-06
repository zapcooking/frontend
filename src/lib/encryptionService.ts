/**
 * Unified Encryption Service
 *
 * Provides signer-agnostic encryption/decryption that works with:
 * - NIP-07 (browser extensions like Alby, nos2x)
 * - NIP-46 (remote signers like Amber)
 * - Private key signers
 *
 * The service routes encryption calls through NDK's signer interface when available,
 * falling back to window.nostr for legacy NIP-07 support.
 */

import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { NDKUser } from '@nostr-dev-kit/ndk';
import { browser } from '$app/environment';

export type EncryptionMethod = 'nip44' | 'nip04' | null;

/**
 * Check if encryption is supported (synchronous, for UI state)
 */
export function hasEncryptionSupport(): boolean {
	if (!browser) return false;

	const ndkInstance = get(ndk);

	// NDK signers always support encryption via their interface
	if (ndkInstance.signer) return true;

	// Fallback check for window.nostr (NIP-07 without NDK signer)
	const nostr = (window as any).nostr;
	return !!(nostr?.nip44?.encrypt || nostr?.nip04?.encrypt);
}

/**
 * Get the best available encryption method
 */
export async function getEncryptionMethod(): Promise<EncryptionMethod> {
	if (!browser) return null;

	const ndkInstance = get(ndk);
	const signer = ndkInstance.signer;

	// If we have an NDK signer, it supports encryption via its interface
	if (signer) {
		// NDK signers support both methods, prefer NIP-44
		if (typeof signer.nip44Encrypt === 'function') return 'nip44';
		if (typeof signer.nip04Encrypt === 'function') return 'nip04';
	}

	// Fallback to window.nostr check (NIP-07 without NDK signer set)
	const nostr = (window as any).nostr;
	if (nostr?.nip44?.encrypt) return 'nip44';
	if (nostr?.nip04?.encrypt) return 'nip04';

	return null;
}

/**
 * Get the best encryption method synchronously (for UI)
 */
export function getBestEncryptionMethod(): EncryptionMethod {
	if (!browser) return null;

	const ndkInstance = get(ndk);

	// NDK signers support both, prefer NIP-44
	if (ndkInstance.signer) {
		return 'nip44';
	}

	// Fallback to window.nostr
	const nostr = (window as any).nostr;
	if (nostr?.nip44?.encrypt) return 'nip44';
	if (nostr?.nip04?.encrypt) return 'nip04';

	return null;
}

/**
 * Encrypt data using the best available method
 */
export async function encrypt(
	recipientPubkey: string,
	plaintext: string,
	preferredMethod?: EncryptionMethod
): Promise<{ ciphertext: string; method: EncryptionMethod }> {
	if (!browser) {
		throw new Error('Encryption not available on server');
	}

	const ndkInstance = get(ndk);
	const signer = ndkInstance.signer;

	if (signer) {
		// Use NDK signer (works for NIP-07, NIP-46, and private key)
		const recipient = new NDKUser({ pubkey: recipientPubkey });
		const method = preferredMethod || 'nip44';

		let ciphertext: string;
		if (method === 'nip44' && typeof signer.nip44Encrypt === 'function') {
			ciphertext = await signer.nip44Encrypt(recipient, plaintext);
		} else if (typeof signer.nip04Encrypt === 'function') {
			ciphertext = await signer.nip04Encrypt(recipient, plaintext);
			return { ciphertext, method: 'nip04' };
		} else {
			throw new Error('Signer does not support encryption');
		}

		return { ciphertext, method };
	}

	// Fallback to window.nostr
	const nostr = (window as any).nostr;
	if (nostr?.nip44?.encrypt && (!preferredMethod || preferredMethod === 'nip44')) {
		const ciphertext = await nostr.nip44.encrypt(recipientPubkey, plaintext);
		return { ciphertext, method: 'nip44' };
	}
	if (nostr?.nip04?.encrypt) {
		const ciphertext = await nostr.nip04.encrypt(recipientPubkey, plaintext);
		return { ciphertext, method: 'nip04' };
	}

	throw new Error('No encryption method available. Please ensure you are logged in with a signer.');
}

/**
 * Decrypt data using the specified method, with fallback to alternative method.
 * Prioritizes window.nostr for NIP-07 extensions (more reliable across signers),
 * then falls back to NDK signer methods.
 */
export async function decrypt(
	senderPubkey: string,
	ciphertext: string,
	method: EncryptionMethod
): Promise<string> {
	if (!browser) {
		throw new Error('Decryption not available on server');
	}

	if (!method) {
		throw new Error('Encryption method not specified');
	}

	// Try primary method first, then fallback to alternative
	const methods: EncryptionMethod[] = method === 'nip44' ? ['nip44', 'nip04'] : ['nip04', 'nip44'];
	let lastError: Error | null = null;

	for (const tryMethod of methods) {
		try {
			// First try window.nostr (NIP-07) - this is the original working method
			const nostr = (window as any).nostr;
			if (tryMethod === 'nip44' && nostr?.nip44?.decrypt) {
				console.log('[Encryption] Trying window.nostr.nip44.decrypt...');
				const result = await nostr.nip44.decrypt(senderPubkey, ciphertext);
				if (result) return result;
			}
			if (tryMethod === 'nip04' && nostr?.nip04?.decrypt) {
				console.log('[Encryption] Trying window.nostr.nip04.decrypt...');
				const result = await nostr.nip04.decrypt(senderPubkey, ciphertext);
				if (result) return result;
			}

			// Fallback to NDK signer (for NIP-46 remote signers, etc.)
			const ndkInstance = get(ndk);
			const signer = ndkInstance.signer;
			if (signer) {
				const sender = new NDKUser({ pubkey: senderPubkey });

				if (tryMethod === 'nip44' && typeof signer.nip44Decrypt === 'function') {
					console.log('[Encryption] Trying NDK signer.nip44Decrypt...');
					const result = await signer.nip44Decrypt(sender, ciphertext);
					if (result) return result;
				} else if (tryMethod === 'nip04' && typeof signer.nip04Decrypt === 'function') {
					console.log('[Encryption] Trying NDK signer.nip04Decrypt...');
					const result = await signer.nip04Decrypt(sender, ciphertext);
					if (result) return result;
				}
			}
		} catch (e) {
			console.warn(`[Encryption] ${tryMethod} decryption failed, trying next method...`, e);
			lastError = e instanceof Error ? e : new Error(String(e));
			// Continue to next method
		}
	}

	throw lastError || new Error(`Cannot decrypt: no supported decryption method available`);
}

/**
 * Detect which encryption method was used for a ciphertext
 * NIP-04 ciphertexts contain "?iv=" while NIP-44 uses a different format
 */
export function detectEncryptionMethod(ciphertext: string): EncryptionMethod {
	if (ciphertext.includes('?iv=')) {
		return 'nip04';
	}
	// NIP-44 ciphertexts are typically base64 without the ?iv= suffix
	return 'nip44';
}

/**
 * Helper to create encryption/decryption functions for use in backup flows
 */
export function createEncryptFn(
	method?: EncryptionMethod
): (plaintext: string, recipientPubkey: string) => Promise<string> {
	return async (plaintext: string, recipientPubkey: string): Promise<string> => {
		const result = await encrypt(recipientPubkey, plaintext, method);
		return result.ciphertext;
	};
}

export function createDecryptFn(
	method: EncryptionMethod
): (ciphertext: string, senderPubkey: string) => Promise<string> {
	return async (ciphertext: string, senderPubkey: string): Promise<string> => {
		return await decrypt(senderPubkey, ciphertext, method);
	};
}
