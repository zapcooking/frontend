/**
 * Spark Wallet Module
 *
 * Self-custodial Lightning wallet integration using Breez SDK Spark.
 * Uses the v0.6.3+ API with SdkBuilder pattern.
 */

import { browser } from '$app/environment'
import { writable, get } from 'svelte/store'
import {
	saveMnemonic,
	loadMnemonic,
	hasMnemonic,
	deleteMnemonic,
	clearAllSparkWallets
} from './storage'
import { logger } from '$lib/logger'

/**
 * Dynamically import bip39 with Buffer polyfill
 * Required because bip39 uses Buffer which isn't available in browser by default
 */
async function getBip39(): Promise<{ generateMnemonic: (strength?: number) => string }> {
	// Polyfill Buffer for browser (required by bip39)
	if (browser && typeof globalThis !== 'undefined' && !(globalThis as any).Buffer) {
		const { Buffer } = await import('buffer')
		;(globalThis as any).Buffer = Buffer
	}
	const bip39 = await import('bip39')
	return bip39
}

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
		const info = await _sdkInstance.getInfo({ ensureSynced: false })
		// Debug: log the full info object to see available properties
		logger.debug('[Spark] getInfo response:', JSON.stringify(info, (_, v) => typeof v === 'bigint' ? v.toString() : v))

		// Balance - try multiple possible property names from SDK
		const balanceValue = info.balanceSats ?? info.balanceSat ?? info.balance_sats ?? info.balance ?? 0
		const balance = BigInt(balanceValue)
		walletBalance.set(balance)
		logger.debug('[Spark] Balance updated:', balance.toString(), 'sats')

		// If requested and balance is 0, try synced fetch (with timeout)
		// This ensures restored wallets show their balance on first load
		if (ensureSynced && balance === BigInt(0)) {
			try {
				const syncedInfo: any = await withTimeout(
					_sdkInstance.getInfo({ ensureSynced: true }),
					15000,
					'Synced balance fetch'
				)
				const syncedBalance = BigInt(syncedInfo.balanceSats ?? syncedInfo.balanceSat ?? syncedInfo.balance_sats ?? syncedInfo.balance ?? 0)
				if (syncedBalance > BigInt(0)) {
					walletBalance.set(syncedBalance)
					logger.debug('[Spark] Synced balance updated:', syncedBalance.toString(), 'sats')
				}
			} catch (syncError) {
				// Timeout or error - log but don't fail
				logger.warn('[Spark] Synced balance fetch failed:', String(syncError))
			}
		}
	} catch (error) {
		logger.error('[Spark] Failed to get balance:', String(error))
	}
}

/**
 * Extract lightning address string from SDK response.
 * The SDK may return a string or an object with various property names.
 */
function extractLightningAddressString(addr: unknown): string | null {
	if (!addr) return null

	// If it's already a string, return it
	if (typeof addr === 'string') {
		return addr
	}

	// If it's an object, try various property names
	if (typeof addr === 'object' && addr !== null) {
		const obj = addr as Record<string, unknown>

		// Log the object structure for debugging
		logger.debug('[Spark] Lightning address response structure:', JSON.stringify(obj, null, 2))

		// Try common property names
		const possibleKeys = ['lightningAddress', 'lightning_address', 'address', 'lnAddress', 'ln_address']
		for (const key of possibleKeys) {
			if (typeof obj[key] === 'string') {
				return obj[key] as string
			}
			// Handle nested object
			if (typeof obj[key] === 'object' && obj[key] !== null) {
				const nested = obj[key] as Record<string, unknown>
				for (const nestedKey of possibleKeys) {
					if (typeof nested[nestedKey] === 'string') {
						return nested[nestedKey] as string
					}
				}
			}
		}

		// If there's only one string property, use it
		const stringValues = Object.values(obj).filter((v): v is string => typeof v === 'string')
		if (stringValues.length === 1) {
			return stringValues[0]
		}

		// Look for any string that looks like a lightning address (contains @)
		for (const value of Object.values(obj)) {
			if (typeof value === 'string' && value.includes('@')) {
				return value
			}
		}
	}

	logger.warn('[Spark] Could not extract lightning address from:', JSON.stringify(addr))
	return null
}

/**
 * Fetch lightning address from the SDK (internal helper)
 */
async function fetchLightningAddress(): Promise<void> {
	if (!_sdkInstance) return

	try {
		const addr = await _sdkInstance.getLightningAddress()
		const address = extractLightningAddressString(addr)
		if (address) {
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
	const { generateMnemonic } = await getBip39()
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
 * Get the current lightning address.
 */
export async function getLightningAddress(): Promise<string | null> {
	if (!_sdkInstance) return null

	try {
		const addr = await _sdkInstance.getLightningAddress()
		const address = extractLightningAddressString(addr)
		if (address) {
			lightningAddress.set(address)
			return address
		}
		return null
	} catch (error) {
		logger.debug('[Spark] No lightning address available:', String(error))
		return null
	}
}

/**
 * Check if a lightning address username is available.
 * @param username The username to check (without @breez.tips suffix)
 */
export async function checkLightningAddressAvailable(username: string): Promise<boolean> {
	if (!_sdkInstance) throw new Error('SDK not connected')

	try {
		const isAvailable = await _sdkInstance.checkLightningAddressAvailable({ username })
		logger.debug('[Spark] Username availability check:', username, isAvailable)
		return isAvailable
	} catch (error) {
		logger.error('[Spark] Failed to check username availability:', String(error))
		throw error
	}
}

/**
 * Register a new lightning address.
 * @param username The desired username (without @breez.tips suffix)
 * @param description Optional description for the address
 */
export async function registerLightningAddress(
	username: string,
	description?: string
): Promise<string> {
	if (!_sdkInstance) throw new Error('SDK not connected')

	try {
		logger.info('[Spark] Registering lightning address:', username)
		const response = await _sdkInstance.registerLightningAddress({
			username,
			description: description || 'zap.cooking user'
		})

		// Extract address string from response using shared helper
		const address = extractLightningAddressString(response) || `${username}@breez.tips`

		lightningAddress.set(address)
		logger.info('[Spark] Lightning address registered:', address)
		return address
	} catch (error) {
		logger.error('[Spark] Failed to register lightning address:', String(error))
		throw error
	}
}

/**
 * Delete the current lightning address.
 */
export async function deleteLightningAddress(): Promise<void> {
	if (!_sdkInstance) throw new Error('SDK not connected')

	try {
		logger.info('[Spark] Deleting lightning address...')
		await _sdkInstance.deleteLightningAddress()
		lightningAddress.set(null)
		logger.info('[Spark] Lightning address deleted')
	} catch (error) {
		logger.error('[Spark] Failed to delete lightning address:', String(error))
		throw error
	}
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

		// Explicitly fetch the lightning address for this wallet
		try {
			const addr = await getLightningAddress()
			logger.info('[Spark] Wallet lightning address:', addr || 'none')
		} catch (e) {
			logger.warn('[Spark] Could not fetch lightning address after restore:', String(e))
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
 * Spark wallet backup file format (compatible with Primal/Jumble/Yakihonne)
 * Version 1: NIP-04 encryption, no explicit encryption field
 * Version 2: NIP-44 or NIP-04 with explicit encryption field
 */
export interface SparkWalletBackup {
	version: number
	type: string
	encryption?: 'nip44' | 'nip04' // Optional for v1 backups
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
		if (backup.type !== 'spark-wallet-backup') {
			throw new Error('Invalid backup file format')
		}

		// Support both version 1 (NIP-04) and version 2 (NIP-44 or NIP-04)
		if (backup.version !== 1 && backup.version !== 2) {
			throw new Error(`Unsupported backup version: ${backup.version}`)
		}

		// Check if the backup belongs to the current user
		if (backup.pubkey && backup.pubkey !== pubkey) {
			throw new Error(
				'This backup belongs to a different Nostr account. ' +
				'Please log in with the correct account or use a backup file created with your current account.'
			)
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

		// Explicitly fetch the lightning address for this wallet
		try {
			const addr = await getLightningAddress()
			logger.info('[Spark] Wallet lightning address:', addr || 'none')
		} catch (e) {
			logger.warn('[Spark] Could not fetch lightning address after restore:', String(e))
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
 * @param encryptFn Function to encrypt the mnemonic.
 * @param encryption The encryption method used ('nip44' or 'nip04').
 * @returns The backup object.
 */
export async function createBackup(
	pubkey: string,
	encryptFn: (plaintext: string, recipientPubkey: string) => Promise<string>,
	encryption: 'nip44' | 'nip04' = 'nip44'
): Promise<SparkWalletBackup> {
	const mnemonic = await loadMnemonic(pubkey)
	if (!mnemonic) {
		throw new Error('No wallet found to backup')
	}

	const encryptedMnemonic = await encryptFn(mnemonic, pubkey)

	return {
		version: 2,
		type: 'spark-wallet-backup',
		encryption,
		pubkey,
		encryptedMnemonic,
		createdAt: Date.now(),
		createdBy: 'zap.cooking'
	}
}

// Nostr backup constants
const BACKUP_EVENT_KIND = 30078 // NIP-78 application-specific data
const BACKUP_D_TAG = 'spark-wallet-backup'

/**
 * Get Nostr extension from browser window
 */
function getNostrExtension(): any {
	if (!browser) return null
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
 * Get the best available encryption method
 */
export function getBestEncryptionMethod(): 'nip44' | 'nip04' | null {
	if (hasNip44Support()) return 'nip44'
	if (hasNip04Support()) return 'nip04'
	return null
}

/**
 * Backup wallet mnemonic to Nostr relays.
 * Uses NIP-78 (kind 30078) replaceable events with NIP-44 encryption (falls back to NIP-04).
 * @param pubkey The user's Nostr public key.
 */
export async function backupWalletToNostr(pubkey: string): Promise<any> {
	if (!browser) throw new Error('Backup can only be performed in browser')

	const mnemonic = await loadMnemonic(pubkey)
	if (!mnemonic) {
		throw new Error('No wallet found to backup')
	}

	const nostr = getNostrExtension()

	// Determine encryption method - prefer NIP-44, fall back to NIP-04
	let encryptedMnemonic: string
	let encryptionMethod: 'nip44' | 'nip04'

	if (nostr.nip44?.encrypt) {
		logger.info('[Spark] Encrypting mnemonic with NIP-44...')
		encryptedMnemonic = await nostr.nip44.encrypt(pubkey, mnemonic)
		encryptionMethod = 'nip44'
	} else if (nostr.nip04?.encrypt) {
		logger.info('[Spark] NIP-44 not available, falling back to NIP-04...')
		encryptedMnemonic = await nostr.nip04.encrypt(pubkey, mnemonic)
		encryptionMethod = 'nip04'
	} else {
		throw new Error('Your Nostr extension does not support encryption. Please use a different extension like Alby.')
	}

	// Create the backup event (kind 30078 - NIP-78 application-specific data)
	// Include encryption method in tags for restore
	const eventTemplate = {
		kind: BACKUP_EVENT_KIND,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['d', BACKUP_D_TAG],
			['client', 'zap.cooking'],
			['encryption', encryptionMethod]
		],
		content: encryptedMnemonic
	}

	// Sign with extension
	logger.info('[Spark] Signing backup event...')
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

	logger.info('[Spark] Publishing backup to Nostr relays...')
	await ndkEvent.publish()

	logger.info('[Spark] Wallet backed up to Nostr successfully')
	return signedEvent
}

/**
 * Restore wallet from Nostr backup.
 * Fetches NIP-78 event and decrypts with NIP-44 or NIP-04 (based on encryption tag).
 * @param pubkey The user's Nostr public key.
 * @param apiKey The Breez API key.
 * @returns The decrypted mnemonic if found, null otherwise.
 */
export async function restoreWalletFromNostr(
	pubkey: string,
	apiKey: string
): Promise<string | null> {
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

	logger.info('[Spark] Searching for Nostr backup...')

	// Query for the backup event
	const filter = {
		kinds: [BACKUP_EVENT_KIND],
		authors: [pubkey],
		'#d': [BACKUP_D_TAG]
	}

	// Fetch with timeout
	const events = await ndkInstance.fetchEvents(filter, { closeOnEose: true })

	if (!events || events.size === 0) {
		logger.info('[Spark] No backup found on Nostr relays')
		return null
	}

	// Get the most recent backup (replaceable events should only have one, but just in case)
	let latestEvent: any = null
	for (const event of events) {
		if (!latestEvent || event.created_at! > latestEvent.created_at!) {
			latestEvent = event
		}
	}

	if (!latestEvent || !latestEvent.content) {
		logger.warn('[Spark] Backup event found but has no content')
		return null
	}

	// Determine encryption method from event tags (default to nip44 for older backups)
	const encryptionTag = latestEvent.tags?.find((t: string[]) => t[0] === 'encryption')
	const encryptionMethod = encryptionTag?.[1] || 'nip44'
	logger.info('[Spark] Found backup, decrypting with', encryptionMethod, '...')

	// Decrypt the mnemonic using the appropriate method
	let mnemonic: string

	if (encryptionMethod === 'nip04') {
		if (!nostr.nip04?.decrypt) {
			throw new Error('This backup was encrypted with NIP-04 but your extension does not support it.')
		}
		mnemonic = await nostr.nip04.decrypt(pubkey, latestEvent.content)
	} else {
		// Default to NIP-44
		if (!nostr.nip44?.decrypt) {
			throw new Error('This backup was encrypted with NIP-44 but your extension does not support it.')
		}
		mnemonic = await nostr.nip44.decrypt(pubkey, latestEvent.content)
	}

	if (!mnemonic) {
		throw new Error('Failed to decrypt backup. Make sure you are using the same Nostr key.')
	}

	// Validate mnemonic
	const words = mnemonic.trim().split(/\s+/)
	if (![12, 15, 18, 21, 24].includes(words.length)) {
		throw new Error('Decrypted backup contains invalid mnemonic')
	}

	// Save mnemonic and initialize SDK
	await saveMnemonic(pubkey, mnemonic.trim())

	logger.info('[Spark] Initializing wallet from Nostr backup...')
	const success = await initializeSdk(pubkey, mnemonic.trim(), apiKey)

	if (!success) {
		deleteMnemonic(pubkey)
		throw new Error('Failed to initialize wallet from backup')
	}

	// Explicitly fetch the lightning address for this wallet
	try {
		const addr = await getLightningAddress()
		logger.info('[Spark] Wallet lightning address:', addr || 'none')
	} catch (e) {
		logger.warn('[Spark] Could not fetch lightning address after restore:', String(e))
	}

	logger.info('[Spark] Wallet restored from Nostr backup successfully')
	return mnemonic.trim()
}

/**
 * Check if a lud16 address matches the Spark wallet's lightning address.
 * Useful for determining if the user's profile lud16 is their Spark wallet.
 * @param lud16 The lightning address to check (e.g., from user's Nostr profile)
 * @returns True if the lud16 matches the Spark wallet's address
 */
export function isSparkLightningAddress(lud16: string | null | undefined): boolean {
	if (!lud16) return false

	const sparkAddr = get(lightningAddress)
	if (!sparkAddr) return false

	// Normalize both addresses for comparison (lowercase, trim)
	const normalizedLud16 = lud16.toLowerCase().trim()
	const normalizedSparkAddr = sparkAddr.toLowerCase().trim()

	return normalizedLud16 === normalizedSparkAddr
}

/**
 * Get the current Spark lightning address value (non-reactive).
 */
export function getSparkLightningAddress(): string | null {
	return get(lightningAddress)
}

// Export storage utilities
export { clearAllSparkWallets, deleteMnemonic, loadMnemonic }
