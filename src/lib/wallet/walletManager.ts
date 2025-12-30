/**
 * Wallet Manager
 *
 * Unified interface for managing multiple wallet types.
 * Routes operations to the appropriate wallet implementation.
 */

import { get, writable } from 'svelte/store'
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
	payNwcLightningAddress,
	isLightningAddress,
	createNwcInvoice,
	lookupNwcInvoice,
	isNwcConnected,
	getNwcDisplayName,
	getNwcInfo,
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

// Import Spark functions
import {
	walletBalance as sparkBalance,
	walletInitialized as sparkInitialized,
	lightningAddress as sparkLightningAddress,
	connectWallet as connectSparkWallet,
	disconnectWallet as disconnectSparkWallet,
	listPayments as listSparkPayments,
	refreshBalance as refreshSparkBalance,
	receivePayment as receiveSparkPayment,
	recentSparkPayments
} from '$lib/spark'
import { userPublickey } from '$lib/nostr'

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
				// Try to get wallet alias, fall back to pubkey-based name
				try {
					const info = await getNwcInfo()
					name = info.alias || getNwcDisplayName(data)
				} catch {
					name = getNwcDisplayName(data)
				}
				break

			case 4: // Spark
				// Spark connection is handled separately via the Spark module
				// This just registers it in the wallet list
				name = 'Breez Spark'
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
				await disconnectSparkWallet()
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
 * Ensure the active wallet is connected (reconnect if needed)
 */
async function ensureWalletConnected(wallet: Wallet): Promise<boolean> {
	try {
		switch (wallet.kind) {
			case 1: // WebLN
				if (!isWeblnConnected()) {
					if (isWeblnAvailable()) {
						await connectWebln()
						return true
					}
					return false
				}
				return true

			case 3: // NWC
				// Always call connectNwc to ensure we're connected to the correct wallet
				// (connectNwc handles the case where we're already connected to the same wallet)
				if (wallet.data) {
					await connectNwc(wallet.data)
					return true
				}
				return false

			case 4: // Spark
				if (!get(sparkInitialized)) {
					const apiKey = import.meta.env.VITE_BREEZ_API_KEY
					const pubkey = get(userPublickey)
					if (apiKey && pubkey) {
						try {
							const connected = await connectSparkWallet(pubkey, apiKey)
							return connected
						} catch (sparkError) {
							// WASM errors can occur if SDK is in bad state
							console.warn('[WalletManager] Spark reconnect failed (WASM error?):', sparkError)
							return false
						}
					}
					return false
				}
				return true

			default:
				return false
		}
	} catch (e) {
		console.warn('[WalletManager] Failed to reconnect wallet:', e)
		return false
	}
}

/**
 * Get balance from the active wallet
 * @param sync For Spark: if true, sync with network first (slower but gets fresh data). Default false.
 */
export async function refreshBalance(sync = false): Promise<number | null> {
	const wallet = getActiveWallet()

	if (!wallet) {
		walletBalance.set(null)
		return null
	}

	try {
		walletLoading.set(true)

		// Ensure the wallet is connected before trying to get balance
		const connected = await ensureWalletConnected(wallet)
		if (!connected) {
			console.warn('[WalletManager] Wallet not connected, cannot refresh balance')
			walletBalance.set(null)
			return null
		}

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
				// Trigger a refresh and get balance from Spark store
				// Pass sync flag - only sync when needed (payment detection)
				try {
					const sparkBal = await refreshSparkBalance(sync)
					balance = sparkBal !== null ? Number(sparkBal) : null
				} catch (e) {
					console.warn('[WalletManager] Spark balance refresh failed:', e)
					// Fall back to current store value
					const currentBal = get(sparkBalance)
					balance = currentBal !== null ? Number(currentBal) : null
				}
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
 * @param invoice The bolt11 invoice to pay
 * @param metadata Optional metadata for pending transaction display
 */
export async function sendPayment(
	invoice: string,
	metadata?: { amount?: number; description?: string; comment?: string }
): Promise<{ success: boolean; preimage?: string; error?: string }> {
	const wallet = getActiveWallet()

	if (!wallet) {
		return { success: false, error: 'No wallet connected' }
	}

	// Generate a temporary ID for the pending transaction
	const pendingId = `pending-${Date.now()}-${Math.random().toString(36).substring(7)}`

	// Add pending transaction if we have metadata
	if (metadata?.amount) {
		addPendingTransaction({
			id: pendingId,
			type: 'outgoing',
			amount: metadata.amount,
			description: metadata.description || 'Sending payment...',
			timestamp: Math.floor(Date.now() / 1000)
		})
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
				// Check if it's a Lightning address
				if (isLightningAddress(invoice)) {
					if (!metadata?.amount) {
						throw new Error('Amount is required for Lightning address payments')
					}
					const lnAddrResult = await payNwcLightningAddress(
						invoice,
						metadata.amount,
						metadata?.comment
					)
					preimage = lnAddrResult.preimage
				} else {
					const nwcResult = await payNwcInvoice(invoice)
					preimage = nwcResult.preimage
				}
				break

			case 4: // Spark
				// Import dynamically to avoid circular dependency
				const { sendZap } = await import('$lib/spark')
				// For Lightning addresses, amount and comment are passed via metadata
				// For invoices, amount is encoded in the invoice itself
				const payment = await sendZap(invoice, metadata?.amount || 0, metadata?.comment || '')
				preimage = payment?.id || payment?.paymentHash || ''
				break

			default:
				throw new Error(`Unknown wallet kind: ${wallet.kind}`)
		}

		// Mark pending transaction as completed (don't remove - let history dedup it)
		// This keeps it visible until the real transaction appears in history
		if (metadata?.amount) {
			updatePendingTransactionStatus(pendingId, 'completed')
		}

		// Refresh balance after payment
		await refreshBalance()

		// Signal that transaction history should be refreshed
		signalTransactionsRefresh()

		console.log('[WalletManager] Payment successful')
		return { success: true, preimage }
	} catch (e) {
		// Remove pending transaction on failure
		if (metadata?.amount) {
			removePendingTransaction(pendingId)
		}

		const error = e instanceof Error ? e.message : String(e) || 'Payment failed'
		console.error('[WalletManager] Payment failed:', e)
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
 * Create a Lightning invoice for receiving payments
 * @param amountSats Amount in satoshis
 * @param description Optional description for the invoice
 * @returns Invoice string and optional payment hash
 */
export async function createInvoice(
	amountSats: number,
	description?: string
): Promise<{ invoice: string; paymentHash?: string }> {
	const wallet = getActiveWallet()

	if (!wallet) {
		throw new Error('No wallet connected')
	}

	if (amountSats <= 0) {
		throw new Error('Amount must be greater than 0')
	}

	try {
		walletLoading.set(true)

		switch (wallet.kind) {
			case 3: // NWC
				const nwcResult = await createNwcInvoice(amountSats, description)
				return {
					invoice: nwcResult.invoice,
					paymentHash: nwcResult.paymentHash
				}

			case 4: // Spark
				// Ensure Spark is initialized before trying to create invoice
				if (!get(sparkInitialized)) {
					throw new Error('Spark wallet is not initialized. Please wait for it to connect.')
				}
				try {
					const sparkResult = await receiveSparkPayment(amountSats, description)
					return {
						invoice: sparkResult.invoice,
						paymentHash: sparkResult.paymentHash
					}
				} catch (sparkError) {
					console.error('[WalletManager] Spark receivePayment error:', sparkError)
					throw new Error(sparkError instanceof Error ? sparkError.message : 'Failed to create Spark invoice')
				}

			default:
				throw new Error('This wallet type does not support invoice generation')
		}
	} catch (e) {
		const error = e instanceof Error ? e.message : 'Failed to create invoice'
		console.error('[WalletManager] Failed to create invoice:', e)
		throw new Error(error)
	} finally {
		walletLoading.set(false)
	}
}

/**
 * Lookup invoice status by payment hash
 * @param paymentHash The payment hash of the invoice to lookup
 * @returns Whether the invoice was paid
 */
export async function lookupInvoice(
	paymentHash: string
): Promise<{ paid: boolean; preimage?: string }> {
	const wallet = getActiveWallet()

	if (!wallet) {
		throw new Error('No wallet connected')
	}

	try {
		switch (wallet.kind) {
			case 3: // NWC
				return await lookupNwcInvoice(paymentHash)

			case 4: // Spark
				// Spark doesn't have a direct lookup - we rely on events
				// For now, return not paid and let events handle it
				return { paid: false }

			default:
				throw new Error('This wallet type does not support invoice lookup')
		}
	} catch (e) {
		console.error('[WalletManager] Failed to lookup invoice:', e)
		// Don't throw - just return not paid
		return { paid: false }
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
	comment?: string // Zap comment from kind 9734 content field
	timestamp: number // unix timestamp
	fees?: number // in sats
	status?: 'pending' | 'completed' | 'failed'
}

/**
 * Store for pending transactions (shown while payment is in progress)
 * Uses localStorage to sync across browser tabs and page navigations
 */
const PENDING_TX_KEY = 'zapcooking_pending_transactions'

function loadPendingFromStorage(): Transaction[] {
	if (typeof window === 'undefined' || typeof localStorage === 'undefined') return []
	try {
		const stored = localStorage.getItem(PENDING_TX_KEY)
		if (stored) {
			const txs = JSON.parse(stored) as Transaction[]
			// Filter out old pending transactions (older than 5 minutes)
			const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300
			const filtered = txs.filter((tx) => tx.timestamp > fiveMinutesAgo)
			console.log('[WalletManager] Loaded pending transactions from storage:', filtered.length)
			return filtered
		}
	} catch (e) {
		console.error('[WalletManager] Failed to load pending transactions:', e)
	}
	return []
}

function savePendingToStorage(txs: Transaction[]): void {
	if (typeof window === 'undefined' || typeof localStorage === 'undefined') return
	try {
		localStorage.setItem(PENDING_TX_KEY, JSON.stringify(txs))
		console.log('[WalletManager] Saved pending transactions to storage:', txs.length)
	} catch (e) {
		console.error('[WalletManager] Failed to save pending transactions:', e)
	}
}

// Initialize empty, will load from storage on client
export const pendingTransactions = writable<Transaction[]>([])

// Track if we've initialized from storage
let pendingTxInitialized = false

// Initialize from localStorage on client side
function initPendingTransactions(): void {
	if (pendingTxInitialized) return
	if (typeof window === 'undefined') return

	pendingTxInitialized = true
	const stored = loadPendingFromStorage()
	if (stored.length > 0) {
		pendingTransactions.set(stored)
	}
}

// Call init immediately if we're in browser
if (typeof window !== 'undefined') {
	initPendingTransactions()
}

// Sync to localStorage when pending transactions change
pendingTransactions.subscribe((txs) => {
	if (pendingTxInitialized) {
		savePendingToStorage(txs)
	}
})

// Listen for storage events from other tabs
if (typeof window !== 'undefined') {
	window.addEventListener('storage', (event) => {
		if (event.key === PENDING_TX_KEY) {
			const newTxs = event.newValue ? JSON.parse(event.newValue) : []
			pendingTransactions.set(newTxs)
		}
	})
}

// Export init function so components can ensure it's called
export function ensurePendingTransactionsLoaded(): void {
	initPendingTransactions()
}

/**
 * Store to signal that transaction history needs refresh
 * Wallet page can subscribe to this and refresh when it changes
 */
export const transactionsNeedRefresh = writable<number>(0)

/**
 * Signal that transactions should be refreshed (call after payment completes)
 */
export function signalTransactionsRefresh(): void {
	transactionsNeedRefresh.update((n) => n + 1)
	// Also trigger via localStorage for cross-tab sync
	if (typeof window !== 'undefined') {
		localStorage.setItem('zapcooking_tx_refresh', String(Date.now()))
	}
}

/**
 * Add a pending transaction (shown immediately when payment starts)
 */
export function addPendingTransaction(tx: Omit<Transaction, 'status'>): string {
	const pendingTx: Transaction = {
		...tx,
		status: 'pending'
	}
	pendingTransactions.update((txs) => [pendingTx, ...txs])
	console.log('[WalletManager] Added pending transaction:', pendingTx.id)
	return tx.id
}

/**
 * Remove a pending transaction (after it completes or fails)
 */
export function removePendingTransaction(id: string): void {
	pendingTransactions.update((txs) => txs.filter((tx) => tx.id !== id))
	console.log('[WalletManager] Removed pending transaction:', id)
}

/**
 * Update a pending transaction's status
 */
export function updatePendingTransactionStatus(id: string, status: 'pending' | 'completed' | 'failed'): void {
	pendingTransactions.update((txs) =>
		txs.map((tx) => tx.id === id ? { ...tx, status } : tx)
	)
	console.log('[WalletManager] Updated pending transaction status:', id, status)
}

/**
 * Clear all pending transactions
 */
export function clearPendingTransactions(): void {
	pendingTransactions.set([])
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

	// Ensure the wallet is connected before trying to get history
	const connected = await ensureWalletConnected(wallet)
	if (!connected) {
		console.warn('[WalletManager] Wallet not connected, cannot get payment history')
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
				console.log('[WalletManager] getPaymentHistory: Spark, offset:', offset, 'limit:', limit)

				// Get payments from SDK
				const sparkPayments = await listSparkPayments(offset, limit)
				console.log('[WalletManager] listSparkPayments returned:', sparkPayments.length, 'payments')

				// Get recent payments extracted from SDK events (for immediate display)
				const recentFromEvents = get(recentSparkPayments)
				console.log('[WalletManager] recentSparkPayments has:', recentFromEvents.length, 'event-based payments')

				// Merge and deduplicate by ID (event payments take priority as they're more recent)
				const seenIds = new Set<string>()
				const mergedPayments: any[] = []

				// Add recent event payments first (they're most up-to-date)
				for (const p of recentFromEvents) {
					const id = p.id || p.paymentHash || p.payment_hash
					if (id && !seenIds.has(id)) {
						seenIds.add(id)
						mergedPayments.push(p)
					}
				}

				// Add SDK payments that aren't duplicates
				for (const p of sparkPayments) {
					const id = p.id || p.paymentHash || p.payment_hash
					if (id && !seenIds.has(id)) {
						seenIds.add(id)
						mergedPayments.push(p)
					}
				}

				console.log('[WalletManager] Merged payments total:', mergedPayments.length)

				// Helper function to map SDK payment to Transaction
				const mapSparkPayment = (p: any): Transaction => {
					// Handle different SDK property naming conventions (camelCase, snake_case)
					const paymentType = p.paymentType || p.payment_type || p.type || ''
					const isIncoming = paymentType === 'received' || paymentType === 'RECEIVED' ||
						paymentType === 'receive' || paymentType === 'incoming'

					// Amount - try multiple property names, SDK may use msat or sat
					const amountMsat = p.amountMsat || p.amount_msat || p.amountMSat || 0
					const amountSat = p.amountSat || p.amount_sat || p.amount || Math.floor(Number(amountMsat) / 1000)

					// Timestamp - SDK might use seconds or milliseconds
					let timestamp = p.createdAt || p.created_at || p.timestamp || p.time || 0
					// If timestamp looks like milliseconds (> year 2100 in seconds), convert to seconds
					if (timestamp > 4102444800) {
						timestamp = Math.floor(timestamp / 1000)
					}

					// Fees
					const feesMsat = p.feesMsat || p.fees_msat || p.feesMSat || 0
					const feesSat = p.feesSat || p.fees_sat || p.fees || (feesMsat ? Math.floor(Number(feesMsat) / 1000) : undefined)

					// Status - map from SDK status field
					const rawStatus = p.status || 'completed'
					const status = rawStatus === 'pending' ? 'pending'
						: rawStatus === 'failed' ? 'failed'
						: 'completed'

					return {
						id: p.id || p.paymentHash || p.payment_hash || String(Math.random()),
						type: isIncoming ? 'incoming' : 'outgoing' as 'incoming' | 'outgoing',
						amount: Number(amountSat),
						description: p.description || p.memo || p.bolt11?.substring(0, 20),
						timestamp: timestamp || Math.floor(Date.now() / 1000),
						fees: feesSat,
						status
					}
				}

				// Sort by timestamp descending, then apply offset/limit
				mergedPayments.sort((a, b) => {
					const tsA = a.createdAt || a.created_at || a.timestamp || a.time || 0
					const tsB = b.createdAt || b.created_at || b.timestamp || b.time || 0
					return tsB - tsA
				})

				// Apply pagination to merged results
				const paginatedPayments = mergedPayments.slice(offset, offset + limit)

				return {
					transactions: paginatedPayments.map(mapSparkPayment),
					hasMore: mergedPayments.length > offset + limit || sparkPayments.length >= limit
				}

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
						// Reconnect Spark wallet if API key is available
						const apiKey = import.meta.env.VITE_BREEZ_API_KEY
						const pubkey = get(userPublickey)
						if (apiKey && pubkey) {
							await connectSparkWallet(pubkey, apiKey)
						}
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
