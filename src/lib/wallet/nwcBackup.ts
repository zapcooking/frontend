/**
 * NWC Wallet Backup to Nostr Relays
 *
 * Backs up NWC connection strings to Nostr using NIP-78 (kind 30078)
 * with NIP-44 encryption (falls back to NIP-04).
 */

import { browser } from '$app/environment'

const NWC_BACKUP_EVENT_KIND = 30078
const NWC_BACKUP_D_TAG = 'zapcooking-nwc-backup'

/**
 * Get the Nostr extension from window
 */
function getNostrExtension(): any {
	if (!browser) throw new Error('Nostr extension only available in browser')
	const nostr = (window as any).nostr
	if (!nostr) {
		throw new Error('No Nostr extension found. Please install Alby or another NIP-07 extension.')
	}
	return nostr
}

/**
 * Check if NIP-44 encryption is available
 */
export function hasNip44Support(): boolean {
	if (!browser) return false
	const nostr = (window as any).nostr
	return !!(nostr?.nip44?.encrypt && nostr?.nip44?.decrypt)
}

/**
 * Check if NIP-04 encryption is available
 */
export function hasNip04Support(): boolean {
	if (!browser) return false
	const nostr = (window as any).nostr
	return !!(nostr?.nip04?.encrypt && nostr?.nip04?.decrypt)
}

/**
 * Check if any encryption method is available
 */
export function hasEncryptionSupport(): boolean {
	return hasNip44Support() || hasNip04Support()
}

/**
 * Backup NWC connection string to Nostr relays.
 * Uses NIP-78 (kind 30078) replaceable events with NIP-44/NIP-04 encryption.
 * @param pubkey The user's Nostr public key.
 * @param nwcConnectionString The NWC connection string to backup.
 */
export async function backupNwcToNostr(pubkey: string, nwcConnectionString: string): Promise<any> {
	if (!browser) throw new Error('Backup can only be performed in browser')

	if (!nwcConnectionString) {
		throw new Error('No NWC connection string provided')
	}

	const nostr = getNostrExtension()

	// Determine encryption method - prefer NIP-44, fall back to NIP-04
	let encryptedContent: string
	let encryptionMethod: 'nip44' | 'nip04'

	if (nostr.nip44?.encrypt) {
		console.log('[NWC Backup] Encrypting with NIP-44...')
		encryptedContent = await nostr.nip44.encrypt(pubkey, nwcConnectionString)
		encryptionMethod = 'nip44'
	} else if (nostr.nip04?.encrypt) {
		console.log('[NWC Backup] NIP-44 not available, falling back to NIP-04...')
		encryptedContent = await nostr.nip04.encrypt(pubkey, nwcConnectionString)
		encryptionMethod = 'nip04'
	} else {
		throw new Error('Your Nostr extension does not support encryption. Please use a different extension like Alby.')
	}

	// Create the backup event (kind 30078 - NIP-78 application-specific data)
	const eventTemplate = {
		kind: NWC_BACKUP_EVENT_KIND,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['d', NWC_BACKUP_D_TAG],
			['client', 'zap.cooking'],
			['encryption', encryptionMethod]
		],
		content: encryptedContent
	}

	// Sign with extension
	console.log('[NWC Backup] Signing backup event...')
	const signedEvent = await nostr.signEvent(eventTemplate)

	// Publish using NDK
	const { ndk, ndkReady } = await import('$lib/nostr')
	const { NDKEvent } = await import('@nostr-dev-kit/ndk')
	const { get } = await import('svelte/store')

	await ndkReady
	const ndkInstance = get(ndk)

	const ndkEvent = new NDKEvent(ndkInstance)
	ndkEvent.kind = signedEvent.kind
	ndkEvent.content = signedEvent.content
	ndkEvent.tags = signedEvent.tags
	ndkEvent.created_at = signedEvent.created_at
	ndkEvent.pubkey = signedEvent.pubkey
	ndkEvent.id = signedEvent.id
	ndkEvent.sig = signedEvent.sig

	console.log('[NWC Backup] Publishing backup to Nostr relays...')
	await ndkEvent.publish()

	console.log('[NWC Backup] NWC connection backed up to Nostr successfully')
	return signedEvent
}

/**
 * Restore NWC connection string from Nostr backup.
 * Fetches NIP-78 event and decrypts with NIP-44 or NIP-04.
 * @param pubkey The user's Nostr public key.
 * @returns The decrypted NWC connection string if found, null otherwise.
 */
export async function restoreNwcFromNostr(pubkey: string): Promise<string | null> {
	if (!browser) return null

	const nostr = getNostrExtension()

	// Check that we have at least one decryption method available
	if (!nostr.nip44?.decrypt && !nostr.nip04?.decrypt) {
		throw new Error('Your Nostr extension does not support decryption. Please use a different extension.')
	}

	// Fetch backup event from relays using NDK
	const { ndk, ndkReady } = await import('$lib/nostr')
	const { get } = await import('svelte/store')

	await ndkReady
	const ndkInstance = get(ndk)

	console.log('[NWC Backup] Searching for Nostr backup...')

	// Query for the backup event
	const filter = {
		kinds: [NWC_BACKUP_EVENT_KIND],
		authors: [pubkey],
		'#d': [NWC_BACKUP_D_TAG]
	}

	// Fetch with timeout
	const events = await ndkInstance.fetchEvents(filter, { closeOnEose: true })

	if (!events || events.size === 0) {
		console.log('[NWC Backup] No backup found on Nostr relays')
		return null
	}

	// Get the most recent backup
	let latestEvent: any = null
	for (const event of events) {
		if (!latestEvent || event.created_at! > latestEvent.created_at!) {
			latestEvent = event
		}
	}

	if (!latestEvent || !latestEvent.content) {
		console.warn('[NWC Backup] Backup event found but has no content')
		return null
	}

	// Determine encryption method from event tags, or detect from ciphertext format
	const encryptionTag = latestEvent.tags?.find((t: string[]) => t[0] === 'encryption')
	let encryptionMethod: string
	if (encryptionTag?.[1]) {
		encryptionMethod = encryptionTag[1]
	} else if (latestEvent.content.includes('?iv=')) {
		encryptionMethod = 'nip04'
	} else {
		encryptionMethod = 'nip44'
	}
	console.log('[NWC Backup] Found backup, decrypting with', encryptionMethod, '...')

	// Helper to add timeout to decrypt operations
	const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
		])
	}

	// Decrypt the connection string
	let connectionString: string
	const DECRYPT_TIMEOUT = 15000

	if (encryptionMethod === 'nip04') {
		if (!nostr.nip04?.decrypt) {
			throw new Error('This backup was encrypted with NIP-04 but your extension does not support it.')
		}
		connectionString = await withTimeout(
			nostr.nip04.decrypt(pubkey, latestEvent.content),
			DECRYPT_TIMEOUT,
			'Decryption timed out. Please approve the decryption request in your Nostr extension.'
		)
	} else {
		if (!nostr.nip44?.decrypt) {
			throw new Error('This backup was encrypted with NIP-44 but your extension does not support it.')
		}
		connectionString = await withTimeout(
			nostr.nip44.decrypt(pubkey, latestEvent.content),
			DECRYPT_TIMEOUT,
			'Decryption timed out. Please approve the decryption request in your Nostr extension.'
		)
	}

	if (!connectionString) {
		throw new Error('Failed to decrypt backup. Make sure you are using the same Nostr key.')
	}

	// Validate it looks like an NWC connection string
	if (!connectionString.includes('nostr+walletconnect') && !connectionString.includes('nostrwalletconnect')) {
		throw new Error('Decrypted data does not appear to be a valid NWC connection string.')
	}

	console.log('[NWC Backup] Successfully restored NWC connection from Nostr backup')
	return connectionString
}

/**
 * Check if an NWC backup exists on Nostr relays.
 * @param pubkey The user's Nostr public key.
 * @returns True if a backup exists, false otherwise.
 */
export async function hasNwcBackupOnNostr(pubkey: string): Promise<boolean> {
	if (!browser) return false

	try {
		const { ndk, ndkReady } = await import('$lib/nostr')
		const { get } = await import('svelte/store')

		await ndkReady
		const ndkInstance = get(ndk)

		const filter = {
			kinds: [NWC_BACKUP_EVENT_KIND],
			authors: [pubkey],
			'#d': [NWC_BACKUP_D_TAG]
		}

		const events = await ndkInstance.fetchEvents(filter, { closeOnEose: true })
		return events && events.size > 0
	} catch (e) {
		console.error('[NWC Backup] Error checking for backup:', e)
		return false
	}
}

/**
 * Relay backup status result
 */
export interface RelayBackupStatus {
	relay: string
	hasBackup: boolean
	timestamp?: number
	error?: string
}

/**
 * Check which relays have a backup of the NWC connection.
 * Queries each relay individually to determine backup status.
 * @param pubkey The user's Nostr public key.
 * @returns Array of relay backup statuses.
 */
export async function checkRelayBackups(pubkey: string): Promise<RelayBackupStatus[]> {
	if (!browser) return []

	const { ndk, ndkReady, relays } = await import('$lib/nostr')
	const { standardRelays } = await import('$lib/consts')
	const { get } = await import('svelte/store')
	const { NDKRelaySet } = await import('@nostr-dev-kit/ndk')

	await ndkReady
	const ndkInstance = get(ndk)

	// Use the user's explicitly configured relays (from localStorage or defaults)
	const relaysToCheck: string[] = Array.isArray(relays)
		? relays.filter((r: unknown): r is string => typeof r === 'string')
		: standardRelays

	if (relaysToCheck.length === 0) {
		console.warn('[NWC Backup] No relays configured')
		return []
	}

	console.log(`[NWC Backup] Checking backup status on ${relaysToCheck.length} relays...`)

	// Query each relay individually in parallel
	const checkPromises = relaysToCheck.map(async (relayUrl): Promise<RelayBackupStatus> => {
		try {
			// Create a filter for the backup event
			const filter = {
				kinds: [NWC_BACKUP_EVENT_KIND],
				authors: [pubkey],
				'#d': [NWC_BACKUP_D_TAG]
			}

			// Create a relay set for this specific relay
			const relaySet = NDKRelaySet.fromRelayUrls([relayUrl], ndkInstance, true)

			// Fetch from this specific relay with timeout
			const events = await Promise.race([
				ndkInstance.fetchEvents(filter, { closeOnEose: true }, relaySet),
				new Promise<Set<any>>((resolve) => setTimeout(() => resolve(new Set()), 8000))
			])

			if (events && events.size > 0) {
				// Get the most recent event
				let latestEvent: any = null
				for (const event of events) {
					if (!latestEvent || event.created_at! > latestEvent.created_at!) {
						latestEvent = event
					}
				}

				return {
					relay: relayUrl,
					hasBackup: true,
					timestamp: latestEvent?.created_at ? latestEvent.created_at * 1000 : undefined
				}
			} else {
				return {
					relay: relayUrl,
					hasBackup: false
				}
			}
		} catch (error) {
			console.warn(`[NWC Backup] Failed to check backup on ${relayUrl}: ${String(error)}`)
			return {
				relay: relayUrl,
				hasBackup: false,
				error: 'Connection failed'
			}
		}
	})

	const results = await Promise.all(checkPromises)
	const backupCount = results.filter((r) => r.hasBackup).length
	console.log(`[NWC Backup] Found backups on ${backupCount} of ${results.length} relays`)

	return results
}

/**
 * Delete NWC wallet backup from Nostr relays.
 * Publishes an empty replaceable event to overwrite the backup (more reliable than NIP-09).
 * @param pubkey The user's Nostr public key.
 */
export async function deleteBackupFromNostr(pubkey: string): Promise<void> {
	if (!browser) throw new Error('Backup deletion can only be performed in browser')

	const nostr = getNostrExtension()

	const { ndk, ndkReady } = await import('$lib/nostr')
	const { NDKEvent } = await import('@nostr-dev-kit/ndk')
	const { get } = await import('svelte/store')

	await ndkReady
	const ndkInstance = get(ndk)

	console.log('[NWC Backup] Deleting backup by publishing empty replacement...')

	// Create an empty replaceable event with the same d-tag to overwrite the backup
	// This is more reliable than NIP-09 deletion since relays must replace the old event
	const emptyBackupEvent = {
		kind: NWC_BACKUP_EVENT_KIND,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['d', NWC_BACKUP_D_TAG],
			['deleted', 'true']
		],
		content: '' // Empty content - no backup data
	}

	// Sign with extension
	console.log('[NWC Backup] Signing empty backup event...')
	const signedEvent = await nostr.signEvent(emptyBackupEvent)

	// Publish to overwrite the backup
	const ndkEvent = new NDKEvent(ndkInstance)
	ndkEvent.kind = signedEvent.kind
	ndkEvent.content = signedEvent.content
	ndkEvent.tags = signedEvent.tags
	ndkEvent.created_at = signedEvent.created_at
	ndkEvent.pubkey = signedEvent.pubkey
	ndkEvent.id = signedEvent.id
	ndkEvent.sig = signedEvent.sig

	console.log('[NWC Backup] Publishing empty backup to overwrite existing...')
	await ndkEvent.publish()

	console.log('[NWC Backup] Backup deleted (replaced with empty event)')
}
