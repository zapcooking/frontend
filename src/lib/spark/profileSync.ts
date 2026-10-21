/**
 * Profile Sync Service for Spark Lightning Address
 *
 * Syncs a lightning address to the user's Nostr profile (kind 0),
 * changing only `lud16`. Loading the current profile goes through
 * $lib/ownKind0, which refuses (throws, publishing nothing) unless it
 * has the latest kind:0 for certain, so the other fields are never lost.
 */

import type NDK from '@nostr-dev-kit/ndk'
import { loadLatestKind0, publishKind0Changes } from '$lib/ownKind0'

/**
 * Sync a lightning address to the user's Nostr profile.
 *
 * @param lightningAddress The lightning address to set (e.g., "user@breez.tips")
 * @param pubkey The user's public key (hex)
 * @param ndk NDK instance for publishing
 * @returns True if sync was successful
 */
export async function syncLightningAddressToProfile(
	lightningAddress: string,
	pubkey: string,
	ndk: NDK
): Promise<boolean> {
	if (!ndk.signer) throw new Error('No signer available - please log in first')

	const loaded = await loadLatestKind0(ndk, pubkey)
	if (loaded.status === 'found' && loaded.content.lud16 === lightningAddress) return true

	await publishKind0Changes(ndk, pubkey, loaded, { lud16: lightningAddress })
	return true
}

/**
 * Remove lightning address from profile (set lud16 to empty/remove it).
 *
 * @param pubkey The user's public key (hex)
 * @param ndk NDK instance for publishing
 * @returns True if removal was successful
 */
export async function removeLightningAddressFromProfile(pubkey: string, ndk: NDK): Promise<boolean> {
	if (!ndk.signer) throw new Error('No signer available - please log in first')

	const loaded = await loadLatestKind0(ndk, pubkey)
	if (loaded.status !== 'found' || !loaded.content.lud16) return true

	await publishKind0Changes(ndk, pubkey, loaded, { lud16: undefined })
	return true
}
