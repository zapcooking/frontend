/**
 * Spark Wallet Module
 *
 * Self-custodial Lightning wallet integration using Breez SDK Spark.
 * Uses the v0.6.3+ API with SdkBuilder pattern.
 */

import { browser } from '$app/environment'
import { writable, get } from 'svelte/store'
import { generateMnemonic } from 'bip39'
import {
	saveMnemonic,
	loadMnemonic,
	hasMnemonic,
	deleteMnemonic,
	clearAllSparkWallets
} from './storage'
import { logger } from '$lib/logger'

/**
 * Validate mnemonic format (basic validation matching primal-web-spark)
 * Checks word count and format without full BIP39 checksum validation
 */
function validateMnemonic(mnemonic: string): boolean {
	// Basic validation: check word count (should be 12, 15, 18, 21, or 24 words)
	const words = mnemonic.trim().split(/\s+/)
	const validWordCounts = [12, 15, 18, 21, 24]

	if (!validWordCounts.includes(words.length)) {
		logger.warn('[Spark] Invalid mnemonic word count:', words.length)
		return false
	}

	// Check that all words are lowercase alphabetic
	for (const word of words) {
		if (!/^[a-z]+$/.test(word)) {
			logger.warn('[Spark] Invalid mnemonic word:', word)
			return false
		}
	}

	return true
}

// --- Writable Stores for Reactivity ---
export const breezSdk = writable<any | null>(null)
export const lightningAddress = writable<string | null>(null)
export const walletBalance = writable<bigint | null>(null)
export const walletInitialized = writable<boolean>(false)
export const sparkLoading = writable<boolean>(false)

// --- Internal State ---
let _sdkInstance: any = null
let _wasmInitialized = false
let _currentPubkey: string | null = null
let _connectionInProgress = false
let _connectionPromise: Promise<boolean> | null = null

/**
 * Event listener class for Spark SDK events
 */
class SparkEventListener {
	onEvent = (event: any) => {
		logger.info('[Spark] Event received:', event)

		// Handle different event types
		if (event.type === 'synced' || event.type === 'payment_received') {
			// Refresh balance on sync or incoming payment
			refreshBalanceInternal()
		}
	}
}

/**
 * Initialize the WASM module (must be called before any SDK operations)
 */
async function initWasm(): Promise<void> {
	if (_wasmInitialized) return

	if (!browser) {
		throw new Error('Spark SDK can only be initialized in browser')
	}

	try {
		const { default: init } = await import('@breeztech/breez-sdk-spark/web')
		await init()
		_wasmInitialized = true
		logger.info('[Spark] WASM module initialized')
	} catch (error) {
		logger.error('[Spark] Failed to initialize WASM:', error)
		throw error
	}
}

/**
 * Refresh balance from the SDK (internal helper)
 */
async function refreshBalanceInternal(ensureSynced = false): Promise<void> {
	if (!_sdkInstance) return

	try {
		// First try without sync to get immediate balance
		// ensureSynced: true can hang for 30+ seconds waiting for network sync
		const info = await _sdkInstance.getInfo({ ensureSynced: false })
		// Debug: log the full info object to see available properties
		logger.debug('[Spark] getInfo response:', JSON.stringify(info, (_, v) => typeof v === 'bigint' ? v.toString() : v))

		// Balance - try multiple possible property names from SDK
		const balanceValue = info.balanceSats ?? info.balanceSat ?? info.balance_sats ?? info.balance ?? 0
		const balance = BigInt(balanceValue)
		walletBalance.set(balance)
		logger.debug('[Spark] Balance updated:', balance.toString(), 'sats')

		// If requested and balance is 0, try synced fetch in background (don't await)
		if (ensureSynced && balance === BigInt(0)) {
			_sdkInstance.getInfo({ ensureSynced: true }).then((syncedInfo: any) => {
				const syncedBalance = BigInt(syncedInfo.balanceSats ?? syncedInfo.balanceSat ?? syncedInfo.balance_sats ?? syncedInfo.balance ?? 0)
				if (syncedBalance > BigInt(0)) {
					walletBalance.set(syncedBalance)
					logger.debug('[Spark] Synced balance updated:', syncedBalance.toString(), 'sats')
				}
			}).catch((e: any) => {
				logger.warn('[Spark] Background sync failed:', String(e))
			})
		}
	} catch (error) {
		logger.error('[Spark] Failed to get balance:', String(error))
	}
}

/**
 * Fetch lightning address from the SDK (internal helper)
 */
async function fetchLightningAddress(): Promise<void> {
	if (!_sdkInstance) return

	try {
		const addr = await _sdkInstance.getLightningAddress()
		if (addr) {
			// Extract address string from response object
			const address = typeof addr === 'string' ? addr : (addr.address || String(addr))
			lightningAddress.set(address)
			logger.info('[Spark] Lightning address:', address)
		}
	} catch (error) {
		// Lightning address might not be available for all configurations
		logger.debug('[Spark] No lightning address available:', String(error))
	}
}

/**
 * Helper to add a timeout to a promise
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs / 1000}s`)), timeoutMs)
		)
	])
}

/**
 * Initializes the Breez SDK and connects the wallet.
 * @param pubkey The user's Nostr public key (hex string).
 * @param mnemonic The BIP39 mnemonic phrase.
 * @param apiKey The Breez API key.
 * @returns True if initialization was successful, false otherwise.
 */
export async function initializeSdk(
	pubkey: string,
	mnemonic: string,
	apiKey: string
): Promise<boolean> {
	if (!browser) return false

	// Already initialized for this pubkey
	if (_currentPubkey === pubkey && _sdkInstance) {
		logger.info('[Spark] SDK already initialized for this pubkey')
		return true
	}

	// If connection is already in progress, wait for it
	if (_connectionInProgress && _connectionPromise) {
		logger.info('[Spark] Connection already in progress, waiting...')
		return _connectionPromise
	}

	// Set connection lock
	_connectionInProgress = true

	const doConnect = async (): Promise<boolean> => {
		try {
			sparkLoading.set(true)

			// Disconnect any existing connection (with error handling for WASM errors)
			try {
				await disconnectWallet()
			} catch (disconnectError) {
				logger.warn('[Spark] Disconnect error (continuing anyway):', String(disconnectError))
				// Reset state even if disconnect fails
				_sdkInstance = null
				_currentPubkey = null
			}

		// Initialize WASM
		await initWasm()

		// Import SDK functions (using connect pattern like primal-web-spark)
		const { defaultConfig, connect } = await import(
			'@breeztech/breez-sdk-spark/web'
		)

		// Create config for mainnet
		const config = defaultConfig('mainnet')
		config.apiKey = apiKey
		// Disable real-time sync to avoid sync loop issues
		config.realTimeSyncServerUrl = undefined

		logger.info('[Spark] Connecting to SDK...')

		// Create seed from mnemonic
		const seed = {
			type: 'mnemonic' as const,
			mnemonic: mnemonic
		}

		// Storage directory for web (uses IndexedDB)
		const storageDir = `spark-${pubkey.slice(0, 8)}`

		// Connect to SDK with timeout (60 seconds)
		try {
			_sdkInstance = await withTimeout(
				connect({
					config,
					seed,
					storageDir
				}),
				60000,
				'SDK connect'
			)
		} catch (connectError) {
			const errorMsg = connectError instanceof Error ? connectError.message : String(connectError)
			// Handle common errors with user-friendly messages
			if (errorMsg.includes('timed out')) {
				throw new Error('Connection timed out. Please check your network and try again.')
			}
			if (errorMsg.includes('Could not establish connection')) {
				throw new Error('Failed to connect to Spark network. Please refresh the page and try again.')
			}
			throw connectError
		}

		breezSdk.set(_sdkInstance)
		_currentPubkey = pubkey

		// Add event listener
		const eventListener = new SparkEventListener()
		await _sdkInstance.addEventListener(eventListener)

		// Get initial balance (don't wait for sync - get immediate cached value)
		try {
			await withTimeout(refreshBalanceInternal(false), 10000, 'Balance refresh')
		} catch (balanceError) {
			logger.warn('[Spark] Initial balance refresh failed, will retry:', String(balanceError))
		}

		try {
			await withTimeout(fetchLightningAddress(), 15000, 'Lightning address fetch')
		} catch (lnAddrError) {
			logger.warn('[Spark] Lightning address fetch failed:', String(lnAddrError))
		}

		walletInitialized.set(true)
		logger.info('[Spark] SDK initialized successfully')
		return true
		} catch (error) {
			logger.error('[Spark] Failed to initialize SDK:', String(error))
			breezSdk.set(null)
			walletInitialized.set(false)
			_sdkInstance = null
			_currentPubkey = null
			return false
		} finally {
			sparkLoading.set(false)
		}
	}

	// Store promise and execute
	_connectionPromise = doConnect().finally(() => {
		_connectionInProgress = false
		_connectionPromise = null
	})

	return _connectionPromise
}

/**
 * Creates a new BIP39 mnemonic, saves it securely, and connects the wallet.
 * @param pubkey The user's Nostr public key (hex string).
 * @param apiKey The Breez API key.
 * @returns The newly generated mnemonic phrase.
 * @throws Error if wallet creation or connection fails.
 */
export async function createAndConnectWallet(pubkey: string, apiKey: string): Promise<string> {
	const newMnemonic = generateMnemonic(128) // 12 words, 128-bit entropy

	// Save the mnemonic first
	await saveMnemonic(pubkey, newMnemonic)

	// Try to initialize
	const connected = await initializeSdk(pubkey, newMnemonic, apiKey)
	if (!connected) {
		// Clean up if connection fails
		deleteMnemonic(pubkey)
		throw new Error('Failed to connect new wallet after creation.')
	}

	return newMnemonic
}

/**
 * Loads a securely stored mnemonic and connects the wallet.
 * @param pubkey The user's Nostr public key (hex string).
 * @param apiKey The Breez API key.
 * @returns True if the wallet was successfully connected, false otherwise.
 */
export async function connectWallet(pubkey: string, apiKey: string): Promise<boolean> {
	const mnemonic = await loadMnemonic(pubkey)
	if (!mnemonic) {
		logger.warn('[Spark] No mnemonic found in local storage for this pubkey')
		return false
	}

	if (!validateMnemonic(mnemonic)) {
		logger.error('[Spark] Loaded mnemonic is invalid')
		deleteMnemonic(pubkey) // Delete corrupted mnemonic
		return false
	}

	return initializeSdk(pubkey, mnemonic, apiKey)
}

/**
 * Disconnects the Breez SDK.
 */
export async function disconnectWallet(): Promise<void> {
	try {
		if (_sdkInstance) {
			try {
				await _sdkInstance.disconnect()
				logger.info('[Spark] SDK disconnected')
			} catch (error) {
				// Suppress harmless disconnect errors
				const errorMsg = error instanceof Error ? error.message : String(error)
				if (!errorMsg.includes('RecvError') && !errorMsg.includes('sync trigger failed')) {
					logger.warn('[Spark] Disconnect error:', errorMsg)
				}
			}
		}
	} finally {
		breezSdk.set(null)
		lightningAddress.set(null)
		walletBalance.set(null)
		walletInitialized.set(false)
		_sdkInstance = null
		_currentPubkey = null
	}
}

/**
 * Sends a payment via the Spark wallet.
 * @param destination The BOLT11 invoice, LNURL, or Lightning address.
 * @param amountSats Optional amount in sats (for amountless invoices or LNURL).
 * @param comment Optional comment for LNURL payments.
 * @returns The payment result.
 */
export async function sendPayment(
	destination: string,
	amountSats?: number,
	comment?: string
): Promise<any> {
	if (!_sdkInstance) {
		throw new Error('Spark SDK is not initialized')
	}

	try {
		sparkLoading.set(true)

		// Prepare the payment request
		const prepareRequest: any = {
			destination
		}

		if (amountSats) {
			prepareRequest.amountSat = amountSats
		}

		// Prepare the payment (get fees, validate)
		logger.info('[Spark] Preparing payment...')
		const prepareResponse = await _sdkInstance.prepareSendPayment(prepareRequest)

		// Execute the payment
		logger.info('[Spark] Sending payment...')
		const sendRequest: any = {
			prepareResponse
		}

		if (comment) {
			sendRequest.comment = comment
		}

		const payment = await _sdkInstance.sendPayment(sendRequest)

		logger.info('[Spark] Payment sent successfully:', payment)

		// Refresh balance after payment
		await refreshBalanceInternal()

		return payment
	} catch (error) {
		logger.error('[Spark] Payment failed:', String(error))
		throw error
	} finally {
		sparkLoading.set(false)
	}
}

/**
 * Sends a zap payment (alias for sendPayment with LNURL support).
 * @param recipientInput The LNURL or Lightning Address of the recipient.
 * @param amountSats The amount in satoshis to send.
 * @param comment An optional comment for the payment.
 * @returns The payment object if successful.
 */
export async function sendZap(
	recipientInput: string,
	amountSats: number,
	comment: string
): Promise<any> {
	return sendPayment(recipientInput, amountSats, comment)
}

/**
 * Create an invoice to receive payment.
 * @param amountSats Amount in sats.
 * @param description Optional description.
 * @returns The invoice details.
 */
export async function receivePayment(
	amountSats: number,
	description?: string
): Promise<{ invoice: string; paymentHash?: string }> {
	if (!_sdkInstance) {
		throw new Error('Spark SDK is not initialized')
	}

	try {
		sparkLoading.set(true)

		const request: any = {
			amountSat: amountSats
		}

		if (description) {
			request.description = description
		}

		const response = await _sdkInstance.receivePayment(request)

		logger.info('[Spark] Invoice created')
		return {
			invoice: response.invoice || response.bolt11,
			paymentHash: response.paymentHash
		}
	} catch (error) {
		logger.error('[Spark] Failed to create invoice:', String(error))
		throw error
	} finally {
		sparkLoading.set(false)
	}
}

/**
 * Get payment history.
 */
export async function listPayments(): Promise<any[]> {
	if (!_sdkInstance) {
		throw new Error('Spark SDK is not initialized')
	}

	try {
		const response = await _sdkInstance.listPayments({})
		// Debug: log the response structure
		logger.debug('[Spark] listPayments response keys:', Object.keys(response || {}).join(', '))

		const payments = response.payments || response || []
		if (payments.length > 0) {
			// Log first payment structure to understand the schema
			logger.debug('[Spark] Sample payment:', JSON.stringify(payments[0], (_, v) => typeof v === 'bigint' ? v.toString() : v))
		}
		return payments
	} catch (error) {
		logger.error('[Spark] Failed to list payments:', String(error))
		throw error
	}
}

/**
 * Sync wallet state with the network.
 */
export async function syncWallet(): Promise<void> {
	if (!_sdkInstance) {
		throw new Error('Spark SDK is not initialized')
	}

	try {
		sparkLoading.set(true)
		await _sdkInstance.syncWallet({})
		await refreshBalanceInternal()
		logger.info('[Spark] Wallet synced')
	} catch (error) {
		logger.error('[Spark] Sync failed:', String(error))
		throw error
	} finally {
		sparkLoading.set(false)
	}
}

/**
 * Checks if a Spark wallet is already configured for the current user.
 * @param pubkey The user's Nostr public key.
 * @returns True if a wallet exists in local storage, false otherwise.
 */
export function isSparkWalletConfigured(pubkey: string): boolean {
	return hasMnemonic(pubkey)
}

/**
 * Get the current SDK instance (for advanced usage).
 */
export function getSdkInstance(): any {
	return _sdkInstance
}

/**
 * Manually refresh the balance.
 */
export async function refreshBalance(): Promise<bigint | null> {
	await refreshBalanceInternal(true)
	return get(walletBalance)
}

/**
 * Restore wallet from a mnemonic phrase.
 * @param pubkey The user's Nostr public key (hex string).
 * @param mnemonic The BIP39 mnemonic phrase.
 * @param apiKey The Breez API key.
 * @returns True if restoration was successful.
 */
export async function restoreFromMnemonic(
	pubkey: string,
	rawMnemonic: string,
	apiKey: string
): Promise<boolean> {
	if (!browser) return false

	try {
		sparkLoading.set(true)

		// Clean up the mnemonic - trim whitespace and normalize spaces
		const mnemonic = rawMnemonic.trim().replace(/\s+/g, ' ')
		logger.debug('[Spark] Restore mnemonic word count:', String(mnemonic.split(' ').length))

		// Validate mnemonic format
		if (!validateMnemonic(mnemonic)) {
			logger.error('[Spark] Mnemonic validation failed. First word:', mnemonic.split(' ')[0])
			throw new Error('Invalid mnemonic phrase')
		}

		// Save the mnemonic
		await saveMnemonic(pubkey, mnemonic)

		// Initialize SDK with the mnemonic
		const success = await initializeSdk(pubkey, mnemonic, apiKey)
		if (!success) {
			deleteMnemonic(pubkey)
			throw new Error('Failed to initialize SDK with mnemonic')
		}

		logger.info('[Spark] Wallet restored from mnemonic')
		return true
	} catch (error) {
		logger.error('[Spark] Failed to restore from mnemonic:', String(error))
		throw error
	} finally {
		sparkLoading.set(false)
	}
}

/**
 * Spark wallet backup file format (compatible with Primal/Jumble)
 */
export interface SparkWalletBackup {
	version: number
	type: string
	encryption: string
	pubkey: string
	encryptedMnemonic: string
	createdAt: number
	createdBy?: string
}

/**
 * Restore wallet from a backup file.
 * @param pubkey The user's Nostr public key (hex string).
 * @param backup The backup file contents.
 * @param apiKey The Breez API key.
 * @param decryptFn Function to decrypt the mnemonic using NIP-44.
 * @returns True if restoration was successful.
 */
export async function restoreFromBackup(
	pubkey: string,
	backup: SparkWalletBackup,
	apiKey: string,
	decryptFn: (ciphertext: string, senderPubkey: string) => Promise<string>
): Promise<boolean> {
	if (!browser) return false

	try {
		sparkLoading.set(true)

		// Validate backup format
		if (backup.type !== 'spark-wallet-backup' || backup.encryption !== 'nip44') {
			throw new Error('Invalid backup format')
		}

		// Decrypt the mnemonic
		const rawMnemonic = await decryptFn(backup.encryptedMnemonic, backup.pubkey)
		if (!rawMnemonic) {
			throw new Error('Failed to decrypt mnemonic from backup')
		}

		// Clean up the mnemonic - trim whitespace and normalize spaces
		const mnemonic = rawMnemonic.trim().replace(/\s+/g, ' ')
		logger.debug('[Spark] Decrypted mnemonic word count:', String(mnemonic.split(' ').length))

		// Validate mnemonic format
		if (!validateMnemonic(mnemonic)) {
			logger.error('[Spark] Mnemonic validation failed. First word:', mnemonic.split(' ')[0])
			throw new Error('Decrypted mnemonic is invalid')
		}

		// Save the mnemonic
		await saveMnemonic(pubkey, mnemonic)

		// Initialize SDK with the mnemonic
		const success = await initializeSdk(pubkey, mnemonic, apiKey)
		if (!success) {
			deleteMnemonic(pubkey)
			throw new Error('Failed to initialize SDK with mnemonic')
		}

		logger.info('[Spark] Wallet restored from backup')
		return true
	} catch (error) {
		logger.error('[Spark] Failed to restore from backup:', String(error))
		throw error
	} finally {
		sparkLoading.set(false)
	}
}

/**
 * Create a backup of the wallet (for download).
 * @param pubkey The user's Nostr public key (hex string).
 * @param encryptFn Function to encrypt the mnemonic using NIP-44.
 * @returns The backup object.
 */
export async function createBackup(
	pubkey: string,
	encryptFn: (plaintext: string, recipientPubkey: string) => Promise<string>
): Promise<SparkWalletBackup> {
	const mnemonic = await loadMnemonic(pubkey)
	if (!mnemonic) {
		throw new Error('No wallet found to backup')
	}

	const encryptedMnemonic = await encryptFn(mnemonic, pubkey)

	return {
		version: 2,
		type: 'spark-wallet-backup',
		encryption: 'nip44',
		pubkey,
		encryptedMnemonic,
		createdAt: Date.now(),
		createdBy: 'zap.cooking'
	}
}

/**
 * Backup wallet mnemonic to Nostr (stub - needs NDK integration).
 * @param _pubkey The user's Nostr public key.
 */
export async function backupWalletToNostr(_pubkey: string): Promise<any> {
	// TODO: Implement Nostr backup using NDK
	// This requires NIP-78 event publishing
	throw new Error('Nostr backup not yet implemented in v0.6.3 integration')
}

/**
 * Restore wallet from Nostr backup (stub - needs NDK integration).
 * @param _pubkey The user's Nostr public key.
 * @param _apiKey The Breez API key.
 */
export async function restoreWalletFromNostr(
	_pubkey: string,
	_apiKey: string
): Promise<string | null> {
	// TODO: Implement Nostr restore using NDK
	// This requires NIP-78 event fetching
	logger.warn('[Spark] Nostr restore not yet implemented in v0.6.3 integration')
	return null
}

// Export storage utilities
export { clearAllSparkWallets, deleteMnemonic }
