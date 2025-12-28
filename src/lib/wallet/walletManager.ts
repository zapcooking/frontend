/**
 * Wallet Manager
 *
 * Unified interface for managing multiple wallet types.
 * Routes operations to the appropriate wallet implementation.
 */

import { get } from 'svelte/store'
import { ndkReady } from '$lib/nostr'
import {
	type Wallet,
	type WalletKind,
	wallets,
	activeWallet,
	walletBalance,
	walletLoading,
	walletLastSync,
	addWallet,
	removeWallet,
	setActiveWallet,
	getActiveWallet
} from './walletStore'
import {
	connectNwc,
	disconnectNwc,
	getNwcBalance,
	payNwcInvoice,
	isNwcConnected,
	getNwcDisplayName,
	listNwcTransactions,
	type NwcTransaction
} from './nwc'
import {
	connectWebln,
	disconnectWebln,
	getWeblnBalance,
	payWeblnInvoice,
	isWeblnAvailable,
	isWeblnConnected,
	getWeblnDisplayName
} from './webln'

// Import Spark functions (these will be updated after we fix the Spark module)
import {
	walletBalance as sparkBalance,
	walletInitialized as sparkInitialized,
	lightningAddress as sparkLightningAddress
} from '$lib/spark'

/**
 * Connect a new wallet
 */
export async function connectWallet(
	kind: WalletKind,
	data?: string
): Promise<{ success: boolean; wallet?: Wallet; error?: string }> {
	try {
		walletLoading.set(true)

		let name: string

		switch (kind) {
			case 1: // WebLN
				if (!isWeblnAvailable()) {
					throw new Error('No WebLN provider found')
				}
				await connectWebln()
				name = await getWeblnDisplayName()
				break

			case 3: // NWC
				if (!data) {
					throw new Error('NWC connection URL required')
				}
				await connectNwc(data)
				name = getNwcDisplayName(data)
				break

			case 4: // Spark
				// Spark connection is handled separately via the Spark module
				// This just registers it in the wallet list
				name = 'Spark Wallet'
				break

			default:
				throw new Error(`Unknown wallet kind: ${kind}`)
		}

		// Add to wallet store
		const wallet = addWallet(kind, name, data || kind.toString())

		// Make it active
		setActiveWallet(wallet.id)

		// Fetch initial balance
		await refreshBalance()

		console.log('[WalletManager] Connected wallet:', name)
		return { success: true, wallet }
	} catch (e) {
		const error = e instanceof Error ? e.message : 'Connection failed'
		console.error('[WalletManager] Connection failed:', error)
		return { success: false, error }
	} finally {
		walletLoading.set(false)
	}
}

/**
 * Disconnect a wallet
 */
export async function disconnectWallet(walletId?: number): Promise<void> {
	const wallet = walletId
		? get(wallets).find((w) => w.id === walletId)
		: getActiveWallet()

	if (!wallet) {
		console.warn('[WalletManager] No wallet to disconnect')
		return
	}

	try {
		switch (wallet.kind) {
			case 1: // WebLN
				disconnectWebln()
				break

			case 3: // NWC
				await disconnectNwc()
				break

			case 4: // Spark
				// Spark disconnection is handled by the Spark module
				// We just remove it from the wallet list
				break
		}

		// Remove from store
		removeWallet(wallet.id)

		console.log('[WalletManager] Disconnected wallet:', wallet.name)
	} catch (e) {
		console.error('[WalletManager] Disconnect error:', e)
		// Still remove from store even if disconnect fails
		removeWallet(wallet.id)
	}
}

/**
 * Get balance from the active wallet
 */
export async function refreshBalance(): Promise<number | null> {
	const wallet = getActiveWallet()

	if (!wallet) {
		walletBalance.set(null)
		return null
	}

	try {
		walletLoading.set(true)

		let balance: number | null = null

		switch (wallet.kind) {
			case 1: // WebLN
				try {
					balance = await getWeblnBalance()
				} catch (e) {
					console.warn('[WalletManager] WebLN balance fetch failed:', e)
					balance = null
				}
				break

			case 3: // NWC
				try {
					balance = await getNwcBalance()
				} catch (e) {
					console.warn('[WalletManager] NWC balance fetch failed (will retry on next refresh):', e)
					// Don't throw - the wallet is still connected, just couldn't fetch balance
					balance = null
				}
				break

			case 4: // Spark
				// Get balance from Spark store (it's a bigint, convert to number)
				const sparkBal = get(sparkBalance)
				balance = sparkBal !== null ? Number(sparkBal) : null
				break
		}

		walletBalance.set(balance)
		if (balance !== null) {
			walletLastSync.set(Date.now())
		}

		console.log('[WalletManager] Balance refreshed:', balance, 'sats')
		return balance
	} catch (e) {
		console.error('[WalletManager] Failed to refresh balance:', e)
		walletBalance.set(null)
		return null
	} finally {
		walletLoading.set(false)
	}
}

/**
 * Send a payment via the active wallet
 */
export async function sendPayment(invoice: string): Promise<{ success: boolean; preimage?: string; error?: string }> {
	const wallet = getActiveWallet()

	if (!wallet) {
		return { success: false, error: 'No wallet connected' }
	}

	try {
		walletLoading.set(true)

		let preimage: string

		switch (wallet.kind) {
			case 1: // WebLN
				const weblnResult = await payWeblnInvoice(invoice)
				preimage = weblnResult.preimage
				break

			case 3: // NWC
				const nwcResult = await payNwcInvoice(invoice)
				preimage = nwcResult.preimage
				break

			case 4: // Spark
				// Import dynamically to avoid circular dependency
				const { sendZap } = await import('$lib/spark')
				const payment = await sendZap(invoice, 0, '') // Amount is in invoice
				preimage = payment.id || ''
				break

			default:
				throw new Error(`Unknown wallet kind: ${wallet.kind}`)
		}

		// Refresh balance after payment
		await refreshBalance()

		console.log('[WalletManager] Payment successful')
		return { success: true, preimage }
	} catch (e) {
		const error = e instanceof Error ? e.message : 'Payment failed'
		console.error('[WalletManager] Payment failed:', error)
		return { success: false, error }
	} finally {
		walletLoading.set(false)
	}
}

/**
 * Check if any wallet is ready to use
 */
export function isWalletReady(): boolean {
	const wallet = getActiveWallet()
	if (!wallet) return false

	switch (wallet.kind) {
		case 1:
			return isWeblnConnected()
		case 3:
			return isNwcConnected()
		case 4:
			return get(sparkInitialized)
		default:
			return false
	}
}

/**
 * Get Lightning address for receiving (if available)
 */
export async function getLightningAddress(): Promise<string | null> {
	const wallet = getActiveWallet()
	if (!wallet) return null

	switch (wallet.kind) {
		case 4: // Spark has registered Lightning address
			return get(sparkLightningAddress)
		default:
			// NWC and WebLN don't typically provide Lightning addresses
			return null
	}
}

/**
 * Unified transaction type
 */
export interface Transaction {
	id: string
	type: 'incoming' | 'outgoing'
	amount: number // in sats
	description?: string
	timestamp: number // unix timestamp
	fees?: number // in sats
}

/**
 * Get payment history from the active wallet
 */
export async function getPaymentHistory(options: {
	limit?: number
	offset?: number
} = {}): Promise<{ transactions: Transaction[]; hasMore: boolean }> {
	const wallet = getActiveWallet()

	if (!wallet) {
		return { transactions: [], hasMore: false }
	}

	const limit = options.limit || 10
	const offset = options.offset || 0

	try {
		switch (wallet.kind) {
			case 3: // NWC
				const nwcResult = await listNwcTransactions({ limit, offset })
				return {
					transactions: nwcResult.transactions.map((tx) => ({
						id: tx.payment_hash,
						type: tx.type,
						amount: Math.floor(tx.amount / 1000), // Convert msats to sats
						description: tx.description,
						timestamp: tx.settled_at || tx.created_at,
						fees: tx.fees_paid ? Math.floor(tx.fees_paid / 1000) : undefined
					})),
					hasMore: nwcResult.hasMore
				}

			case 4: // Spark
				// TODO: Implement Spark transaction history
				return { transactions: [], hasMore: false }

			default:
				// WebLN doesn't support transaction history
				return { transactions: [], hasMore: false }
		}
	} catch (e) {
		console.error('[WalletManager] Failed to get payment history:', e)
		return { transactions: [], hasMore: false }
	}
}

// Track initialization state
let isInitialized = false
let initializationPromise: Promise<void> | null = null

/**
 * Initialize wallet manager (restore saved wallets)
 */
export async function initializeWalletManager(): Promise<void> {
	// Already initialized
	if (isInitialized) {
		console.log('[WalletManager] Already initialized')
		return
	}

	// Initialization in progress
	if (initializationPromise) {
		console.log('[WalletManager] Initialization already in progress')
		return initializationPromise
	}

	initializationPromise = (async () => {
		console.log('[WalletManager] Initializing...')

		// Wait for NDK to be ready before connecting wallets
		console.log('[WalletManager] Waiting for NDK...')
		await ndkReady
		console.log('[WalletManager] NDK ready, proceeding...')

		const savedWallets = get(wallets)
		const active = savedWallets.find((w) => w.active)

		if (active) {
			// Try to reconnect to the saved active wallet
			try {
				switch (active.kind) {
					case 1: // WebLN
						if (isWeblnAvailable()) {
							await connectWebln()
						}
						break

					case 3: // NWC
						await connectNwc(active.data)
						break

					case 4: // Spark
						// Spark auto-restores on its own
						break
				}

				await refreshBalance()
				console.log('[WalletManager] Restored active wallet:', active.name)
			} catch (e) {
				console.warn('[WalletManager] Failed to restore wallet:', e)
				// Don't remove - user can manually reconnect
			}
		}

		isInitialized = true
		console.log('[WalletManager] Initialized with', savedWallets.length, 'wallets')
	})()

	try {
		await initializationPromise
	} finally {
		initializationPromise = null
	}
}

// Re-export stores for convenience
export { wallets, activeWallet, walletBalance, walletConnected, walletLoading, walletLastSync } from './walletStore'
export { isWeblnAvailable } from './webln'
export { isValidNwcUrl } from './nwc'
