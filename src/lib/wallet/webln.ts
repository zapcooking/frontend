/**
 * WebLN Integration
 *
 * WebLN is a browser API for interacting with Lightning wallets.
 * Common providers: Alby, Zeus, BlueWallet, etc.
 */

import { browser } from '$app/environment'

// WebLN provider instance
let weblnProvider: WebLNProvider | null = null

// WebLN types (from webln package)
interface WebLNProvider {
	enable(): Promise<void>
	getInfo(): Promise<{ node: { alias?: string; pubkey?: string } }>
	sendPayment(paymentRequest: string): Promise<{ preimage: string }>
	makeInvoice(args: { amount?: number; defaultAmount?: number; defaultMemo?: string }): Promise<{
		paymentRequest: string
		paymentHash: string
	}>
	getBalance?(): Promise<{ balance: number; currency?: string }>
}

declare global {
	interface Window {
		webln?: WebLNProvider
	}
}

/**
 * Check if WebLN is available in the browser
 */
export function isWeblnAvailable(): boolean {
	return browser && typeof window !== 'undefined' && !!window.webln
}

/**
 * Connect to WebLN provider
 */
export async function connectWebln(): Promise<boolean> {
	if (!browser) return false

	if (!window.webln) {
		throw new Error('No WebLN provider found. Please install a Lightning wallet extension.')
	}

	try {
		await window.webln.enable()
		weblnProvider = window.webln
		console.log('[WebLN] Connected successfully')
		return true
	} catch (e) {
		console.error('[WebLN] Connection failed:', e)
		weblnProvider = null
		throw e
	}
}

/**
 * Disconnect WebLN (just clears local reference)
 */
export function disconnectWebln(): void {
	weblnProvider = null
	console.log('[WebLN] Disconnected')
}

/**
 * Check if WebLN is connected
 */
export function isWeblnConnected(): boolean {
	return weblnProvider !== null
}

/**
 * Get WebLN wallet balance
 * Note: Not all providers support getBalance()
 */
export async function getWeblnBalance(): Promise<number | null> {
	if (!weblnProvider) {
		throw new Error('WebLN not connected')
	}

	try {
		// getBalance is optional in WebLN spec
		if (typeof weblnProvider.getBalance === 'function') {
			const response = await weblnProvider.getBalance()
			console.log('[WebLN] Balance:', response.balance, 'sats')
			return response.balance
		} else {
			console.log('[WebLN] Balance not supported by this provider')
			return null
		}
	} catch (e) {
		console.warn('[WebLN] Failed to get balance:', e)
		return null
	}
}

/**
 * Pay a Lightning invoice via WebLN
 */
export async function payWeblnInvoice(invoice: string): Promise<{ preimage: string }> {
	if (!weblnProvider) {
		throw new Error('WebLN not connected')
	}

	try {
		console.log('[WebLN] Paying invoice...')
		const response = await weblnProvider.sendPayment(invoice)
		console.log('[WebLN] Payment successful, preimage:', response.preimage)
		return { preimage: response.preimage }
	} catch (e) {
		console.error('[WebLN] Payment failed:', e)
		throw e
	}
}

/**
 * Create a Lightning invoice via WebLN
 */
export async function createWeblnInvoice(
	amountSats: number,
	description?: string
): Promise<{ invoice: string; paymentHash: string }> {
	if (!weblnProvider) {
		throw new Error('WebLN not connected')
	}

	try {
		console.log('[WebLN] Creating invoice for', amountSats, 'sats')
		const response = await weblnProvider.makeInvoice({
			amount: amountSats,
			defaultMemo: description || 'zap.cooking payment'
		})
		console.log('[WebLN] Invoice created')
		return {
			invoice: response.paymentRequest,
			paymentHash: response.paymentHash
		}
	} catch (e) {
		console.error('[WebLN] Failed to create invoice:', e)
		throw e
	}
}

/**
 * Get WebLN wallet info
 */
export async function getWeblnInfo(): Promise<{ alias?: string; pubkey?: string }> {
	if (!weblnProvider) {
		throw new Error('WebLN not connected')
	}

	try {
		const info = await weblnProvider.getInfo()
		return {
			alias: info.node?.alias,
			pubkey: info.node?.pubkey
		}
	} catch (e) {
		console.error('[WebLN] Failed to get info:', e)
		throw e
	}
}

/**
 * Get a display name for WebLN wallet
 */
export async function getWeblnDisplayName(): Promise<string> {
	try {
		const info = await getWeblnInfo()
		return info.alias || 'WebLN Wallet'
	} catch {
		return 'WebLN Wallet'
	}
}
