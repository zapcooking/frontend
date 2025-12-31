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
		return true
	} catch (e) {
		weblnProvider = null
		throw e
	}
}

export function disconnectWebln(): void {
	weblnProvider = null
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
	if (!weblnProvider) throw new Error('WebLN not connected')
	try {
		if (typeof weblnProvider.getBalance === 'function') {
			const response = await weblnProvider.getBalance()
			return response.balance
		}
		return null
	} catch {
		return null
	}
}

/**
 * Pay a Lightning invoice via WebLN
 */
export async function payWeblnInvoice(invoice: string): Promise<{ preimage: string }> {
	if (!weblnProvider) throw new Error('WebLN not connected')
	const response = await weblnProvider.sendPayment(invoice)
	return { preimage: response.preimage }
}

/**
 * Create a Lightning invoice via WebLN
 */
export async function createWeblnInvoice(
	amountSats: number,
	description?: string
): Promise<{ invoice: string; paymentHash: string }> {
	if (!weblnProvider) throw new Error('WebLN not connected')
	const response = await weblnProvider.makeInvoice({
		amount: amountSats,
		defaultMemo: description || 'zap.cooking payment'
	})
	return { invoice: response.paymentRequest, paymentHash: response.paymentHash }
}

/**
 * Get WebLN wallet info
 */
export async function getWeblnInfo(): Promise<{ alias?: string; pubkey?: string }> {
	if (!weblnProvider) throw new Error('WebLN not connected')
	const info = await weblnProvider.getInfo()
	return { alias: info.node?.alias, pubkey: info.node?.pubkey }
}

export async function getWeblnDisplayName(): Promise<string> {
	try {
		const info = await getWeblnInfo()
		return info.alias || 'WebLN Wallet'
	} catch {
		return 'WebLN Wallet'
	}
}
