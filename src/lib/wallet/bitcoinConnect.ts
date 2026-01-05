/**
 * Bitcoin Connect External Wallet State
 *
 * Simple enabled/disabled state for external wallet connections.
 * When enabled and no embedded wallet is active, payments use Bitcoin Connect modal.
 * The actual connection happens via lightningService.ts when paying.
 */

import { writable, get } from 'svelte/store'
import { browser } from '$app/environment'

const STORAGE_KEY = 'zapcooking_bitcoin_connect_enabled'

/**
 * Load enabled state from localStorage
 */
function loadEnabled(): boolean {
	if (!browser) return false
	try {
		const stored = localStorage.getItem(STORAGE_KEY)
		return stored === 'true'
	} catch {
		return false
	}
}

/**
 * Save enabled state to localStorage
 */
function saveEnabled(enabled: boolean): void {
	if (!browser) return
	try {
		localStorage.setItem(STORAGE_KEY, String(enabled))
	} catch {
		// Ignore storage errors
	}
}

// --- Store ---

export const bitcoinConnectEnabled = writable<boolean>(false)

// Track if we've loaded from storage
let hasLoaded = false

// Load from localStorage on client
if (browser) {
	setTimeout(() => {
		hasLoaded = true
		bitcoinConnectEnabled.set(loadEnabled())
	}, 0)
}

// Persist changes
bitcoinConnectEnabled.subscribe((enabled) => {
	if (browser && hasLoaded) {
		saveEnabled(enabled)
	}
})

// --- Functions ---

/**
 * Enable Bitcoin Connect as external wallet
 */
export function enableBitcoinConnect(): void {
	bitcoinConnectEnabled.set(true)
}

/**
 * Disable Bitcoin Connect
 */
export function disableBitcoinConnect(): void {
	bitcoinConnectEnabled.set(false)
	// Also disconnect any active BC session
	if (browser) {
		import('@getalby/bitcoin-connect').then(({ disconnect }) => {
			try {
				disconnect()
			} catch {
				// Ignore disconnect errors
			}
		}).catch(() => {
			// Ignore import errors
		})
	}
}

/**
 * Check if Bitcoin Connect is enabled
 */
export function isBitcoinConnectEnabled(): boolean {
	return get(bitcoinConnectEnabled)
}
