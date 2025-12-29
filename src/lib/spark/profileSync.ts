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
async function fetchCurrentProfileEvent(
	pubkey: string,
	ndk: NDK
): Promise<NDKEvent | null> {
	try {
		const filter = {
			kinds: [0],
			authors: [pubkey],
			limit: 1
		}

		const events = await ndk.fetchEvents(filter, { closeOnEose: true })

		if (!events || events.size === 0) {
			return null
		}

		// Get the most recent event (should only be one for kind 0)
		let latestEvent: NDKEvent | null = null
		for (const event of events) {
			if (!latestEvent || (event.created_at && latestEvent.created_at && event.created_at > latestEvent.created_at)) {
				latestEvent = event
			}
		}

		return latestEvent
	} catch (error) {
		console.error('[ProfileSync] Failed to fetch profile event:', error)
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
	console.log('[ProfileSync] Starting sync for:', lightningAddress)

	// 1. Fetch current profile event
	const currentProfileEvent = await fetchCurrentProfileEvent(pubkey, ndk)

	if (!currentProfileEvent) {
		console.warn('[ProfileSync] No existing profile event found - cannot sync to avoid creating incomplete profile')
		throw new Error('No existing profile found. Please set up your profile first before syncing lightning address.')
	}

	// 2. Parse existing profile content
	let oldProfileContent: Record<string, any>
	try {
		oldProfileContent = JSON.parse(currentProfileEvent.content || '{}')
	} catch (error) {
		console.error('[ProfileSync] Failed to parse profile content:', error)
		throw new Error('Failed to parse existing profile data')
	}

	console.log('[ProfileSync] Current profile has', Object.keys(oldProfileContent).length, 'fields')

	// 3. Check if lud16 is already set to this value
	if (oldProfileContent.lud16 === lightningAddress) {
		console.log('[ProfileSync] Lightning address already set to:', lightningAddress)
		return true // Already synced, nothing to do
	}

	// 4. Create new profile content preserving ALL existing fields
	const newProfileContent: Record<string, any> = {
		...oldProfileContent, // Spread operator preserves everything
		lud16: lightningAddress // Add/update only the lightning address
	}

	// 5. Safety check - verify we haven't lost any fields
	const oldKeyCount = Object.keys(oldProfileContent).length
	const newKeyCount = Object.keys(newProfileContent).length

	if (newKeyCount < oldKeyCount) {
		console.error('[ProfileSync] Data loss detected! Old keys:', oldKeyCount, 'New keys:', newKeyCount)
		throw new Error('Profile update would lose data - aborting for safety')
	}

	console.log('[ProfileSync] New profile will have', newKeyCount, 'fields')

	// 6. Create and sign the new profile event
	if (!ndk.signer) {
		throw new Error('No signer available - please log in first')
	}

	const profileEvent = new NDKEvent(ndk)
	profileEvent.kind = 0
	profileEvent.content = JSON.stringify(newProfileContent)
	// Preserve any existing tags from the original event
	profileEvent.tags = currentProfileEvent.tags || []

	// 7. Sign and publish
	try {
		await profileEvent.sign()
		await profileEvent.publish()
		console.log('[ProfileSync] Profile updated successfully with lightning address:', lightningAddress)
		return true
	} catch (error) {
		console.error('[ProfileSync] Failed to publish profile update:', error)
		throw new Error('Failed to publish profile update')
	}
}

/**
 * Remove lightning address from profile (set lud16 to empty/remove it).
 *
 * @param pubkey The user's public key (hex)
 * @param ndk NDK instance for publishing
 * @returns True if removal was successful
 */
export async function removeLightningAddressFromProfile(
	pubkey: string,
	ndk: NDK
): Promise<boolean> {
	console.log('[ProfileSync] Removing lightning address from profile')

	// 1. Fetch current profile event
	const currentProfileEvent = await fetchCurrentProfileEvent(pubkey, ndk)

	if (!currentProfileEvent) {
		console.warn('[ProfileSync] No existing profile event found')
		return true // Nothing to remove
	}

	// 2. Parse existing profile content
	let oldProfileContent: Record<string, any>
	try {
		oldProfileContent = JSON.parse(currentProfileEvent.content || '{}')
	} catch (error) {
		console.error('[ProfileSync] Failed to parse profile content:', error)
		throw new Error('Failed to parse existing profile data')
	}

	// 3. Check if lud16 is set
	if (!oldProfileContent.lud16) {
		console.log('[ProfileSync] No lightning address in profile to remove')
		return true // Nothing to remove
	}

	// 4. Create new profile content without lud16
	const { lud16: _, ...newProfileContent } = oldProfileContent

	console.log('[ProfileSync] Removing lud16, profile will have', Object.keys(newProfileContent).length, 'fields')

	// 5. Create and sign the new profile event
	if (!ndk.signer) {
		throw new Error('No signer available - please log in first')
	}

	const profileEvent = new NDKEvent(ndk)
	profileEvent.kind = 0
	profileEvent.content = JSON.stringify(newProfileContent)
	profileEvent.tags = currentProfileEvent.tags || []

	// 6. Sign and publish
	try {
		await profileEvent.sign()
		await profileEvent.publish()
		console.log('[ProfileSync] Lightning address removed from profile')
		return true
	} catch (error) {
		console.error('[ProfileSync] Failed to publish profile update:', error)
		throw new Error('Failed to publish profile update')
	}
}
