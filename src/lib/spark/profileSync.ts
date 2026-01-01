/**
 * Profile Sync Service for Spark Lightning Address
 *
 * Safely syncs lightning address to Nostr profile (kind 0)
 * with careful preservation of all existing profile fields.
 */

import { NDKEvent } from '@nostr-dev-kit/ndk'
import type NDK from '@nostr-dev-kit/ndk'

/**
 * Fetch the user's current kind 0 profile event from relays.
 * Returns the raw event so we can preserve all fields.
 */
async function fetchCurrentProfileEvent(pubkey: string, ndk: NDK): Promise<NDKEvent | null> {
	try {
		const events = await ndk.fetchEvents({ kinds: [0], authors: [pubkey], limit: 1 }, { closeOnEose: true })
		if (!events || events.size === 0) return null
		let latestEvent: NDKEvent | null = null
		for (const event of events) {
			if (!latestEvent || (event.created_at && latestEvent.created_at && event.created_at > latestEvent.created_at)) {
				latestEvent = event
			}
		}
		return latestEvent
	} catch {
		return null
	}
}

/**
 * Sync a lightning address to the user's Nostr profile.
 *
 * SAFETY: This function carefully preserves all existing profile fields
 * and only adds/updates the lud16 field.
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
	const currentProfileEvent = await fetchCurrentProfileEvent(pubkey, ndk)
	if (!currentProfileEvent) {
		throw new Error('No existing profile found. Please set up your profile first before syncing lightning address.')
	}

	let oldProfileContent: Record<string, any>
	try {
		oldProfileContent = JSON.parse(currentProfileEvent.content || '{}')
	} catch {
		throw new Error('Failed to parse existing profile data')
	}

	if (oldProfileContent.lud16 === lightningAddress) return true

	const newProfileContent: Record<string, any> = { ...oldProfileContent, lud16: lightningAddress }
	const oldKeyCount = Object.keys(oldProfileContent).length
	const newKeyCount = Object.keys(newProfileContent).length

	if (newKeyCount < oldKeyCount) {
		console.error('[ProfileSync] Data loss detected! Old keys:', oldKeyCount, 'New keys:', newKeyCount)
		throw new Error('Profile update would lose data - aborting for safety')
	}

	if (!ndk.signer) throw new Error('No signer available - please log in first')

	const profileEvent = new NDKEvent(ndk)
	profileEvent.kind = 0
	profileEvent.content = JSON.stringify(newProfileContent)
	profileEvent.tags = currentProfileEvent.tags || []

	await profileEvent.sign()
	await profileEvent.publish()
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
	const currentProfileEvent = await fetchCurrentProfileEvent(pubkey, ndk)
	if (!currentProfileEvent) return true

	let oldProfileContent: Record<string, any>
	try {
		oldProfileContent = JSON.parse(currentProfileEvent.content || '{}')
	} catch {
		throw new Error('Failed to parse existing profile data')
	}

	if (!oldProfileContent.lud16) return true

	const { lud16: _, ...newProfileContent } = oldProfileContent
	if (!ndk.signer) throw new Error('No signer available - please log in first')

	const profileEvent = new NDKEvent(ndk)
	profileEvent.kind = 0
	profileEvent.content = JSON.stringify(newProfileContent)
	profileEvent.tags = currentProfileEvent.tags || []

	await profileEvent.sign()
	await profileEvent.publish()
	return true
}
