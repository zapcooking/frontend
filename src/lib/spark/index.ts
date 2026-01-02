/**
 * Spark Wallet Module
 *
 * Self-custodial Lightning wallet integration using Breez SDK Spark.
 * Rewritten following jumble-spark patterns for reliable event handling.
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

// Lightning address with localStorage persistence
const LIGHTNING_ADDRESS_KEY = 'spark_lightning_address'
function createPersistentLightningAddress() {
	// Load initial value from localStorage
	let initial: string | null = null
	if (browser) {
		try {
			const stored = localStorage.getItem(LIGHTNING_ADDRESS_KEY)
			if (stored) initial = stored
		} catch (e) {
			// Ignore localStorage errors
		}
	}

	const store = writable<string | null>(initial)

	// Subscribe to persist changes
	store.subscribe((value) => {
		if (browser) {
			try {
				if (value) {
					localStorage.setItem(LIGHTNING_ADDRESS_KEY, value)
				} else {
					localStorage.removeItem(LIGHTNING_ADDRESS_KEY)
				}
			} catch (e) {
				// Ignore localStorage errors
			}
		}
	})

	return store
}
export const lightningAddress = createPersistentLightningAddress()

export const walletBalance = writable<bigint | null>(null)
export const walletInitialized = writable<boolean>(false)
export const sparkLoading = writable<boolean>(false)

// Store for recently completed payments extracted from SDK events
// This provides immediate updates before listPayments() returns fresh data
export const recentSparkPayments = writable<any[]>([])

// --- Internal State (simplified from jumble-spark) ---
let _sdkInstance: any = null
let _wasmInitialized = false
let _currentPubkey: string | null = null
let _eventListenerId: string | null = null

// --- Event Callback System ---
type SparkEventCallback = (event: any) => void
const _eventCallbacks: SparkEventCallback[] = []

/**
 * Register a callback for SDK events (like jumble-spark pattern)
 * @returns Unsubscribe function
 */
export function onSparkEvent(callback: SparkEventCallback): () => void {
	_eventCallbacks.push(callback)
	return () => {
		const index = _eventCallbacks.indexOf(callback)
		if (index > -1) {
			_eventCallbacks.splice(index, 1)
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
 * Set up SDK event listener (following jumble-spark pattern exactly)
 * Must be called immediately after SDK connect
 */
async function setupEventListener(): Promise<void> {
	if (!_sdkInstance) return

	const listener = {
		onEvent: (event: any) => {
			if (event.type === 'paymentSucceeded' && event.payment) {
				recentSparkPayments.update((payments) => {
					if (!payments.find((p) => p.id === event.payment.id)) {
						return [event.payment, ...payments].slice(0, 20)
					}
					return payments
				})
				refreshBalanceInternal()
			}

			if (event.type === 'synced') {
				refreshBalanceInternal()
			}

			_eventCallbacks.forEach((callback) => {
				try { callback(event) } catch {}
			})
		}
	}

	_eventListenerId = await _sdkInstance.addEventListener(listener)
}

async function refreshBalanceInternal(): Promise<void> {
	if (!_sdkInstance) return
	try {
		const info = await _sdkInstance.getInfo({ ensureSynced: false })
		const balanceValue = info.balanceSats ?? info.balanceSat ?? info.balance_sats ?? info.balance ?? 0
		walletBalance.set(BigInt(balanceValue))
	} catch {}
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
 * Initializes the Breez SDK and connects the wallet.
 * Simplified following jumble-spark pattern.
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

	try {
		sparkLoading.set(true)

		// Disconnect any existing connection
		await disconnectWallet()

		// Initialize WASM
		await initWasm()

		// Import SDK functions
		const { defaultConfig, connect } = await import('@breeztech/breez-sdk-spark/web')

		const config = defaultConfig('mainnet')
		config.apiKey = apiKey
		config.privateEnabledDefault = true

		const cleanMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')

		_sdkInstance = await withTimeout(
			connect({
				config,
				seed: { type: 'mnemonic', mnemonic: cleanMnemonic },
				storageDir: 'zapcooking-spark'
			}),
			20000,
			'SDK connect'
		)

		breezSdk.set(_sdkInstance)
		_currentPubkey = pubkey

		await setupEventListener()

		// Get cached balance immediately (without waiting for sync)
		await refreshBalanceInternal()

		// Mark as initialized - UI can show now!
		walletInitialized.set(true)
		logger.info('[Spark] SDK initialized, starting background sync...')

		// Background sync - don't await, let it run async
		// Event listener will refresh balance when 'synced' event fires
		_sdkInstance.syncWallet({}).catch(() => {
			logger.warn('[Spark] Background sync failed, will retry on next action')
		})

		// Fetch lightning address in background - don't await
		fetchLightningAddress().catch(() => {})

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

export async function disconnectWallet(): Promise<void> {
	try {
		if (_sdkInstance) {
			if (_eventListenerId) {
				try { await _sdkInstance.removeEventListener(_eventListenerId) } catch {}
				_eventListenerId = null
			}
			try { await _sdkInstance.disconnect() } catch {}
		}
	} finally {
		breezSdk.set(null)
		lightningAddress.set(null)
		walletBalance.set(null)
		walletInitialized.set(false)
		_sdkInstance = null
		_currentPubkey = null
		_eventListenerId = null
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
	if (!_sdkInstance) throw new Error('Spark SDK is not initialized')

	try {
		sparkLoading.set(true)
		const parsedInput = await _sdkInstance.parse(destination)

		if (parsedInput.type === 'lightningAddress') {
			if (!amountSats) throw new Error('Amount is required for Lightning address payments')
			const payRequest = (parsedInput as any).payRequest
			const prepareResponse = await _sdkInstance.prepareLnurlPay({ payRequest, amountSats })
			const lnurlPayRequest: any = { prepareResponse }
			if (comment) lnurlPayRequest.comment = comment
			const payment = await _sdkInstance.lnurlPay(lnurlPayRequest)
			await refreshBalanceInternal()
			return payment
		}

		if (parsedInput.type === 'lnurlPay') {
			if (!amountSats) throw new Error('Amount is required for LNURL payments')
			const payRequest = (parsedInput as any).payRequest
			const prepareResponse = await _sdkInstance.prepareLnurlPay({ payRequest, amountSats })
			const lnurlPayRequest: any = { prepareResponse }
			if (comment) lnurlPayRequest.comment = comment
			const payment = await _sdkInstance.lnurlPay(lnurlPayRequest)
			await refreshBalanceInternal()
			return payment
		}

		const prepareRequest: any = { paymentRequest: destination }
		if (amountSats) prepareRequest.amountSat = amountSats
		const prepareResponse = await _sdkInstance.prepareSendPayment(prepareRequest)
		const payment = await _sdkInstance.sendPayment({ prepareResponse })
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
			paymentMethod: {
				type: 'bolt11Invoice',
				amountSats: amountSats,
				description: description || 'Payment via zap.cooking'
			}
		}

		const response = await _sdkInstance.receivePayment(request)

		logger.info('[Spark] Invoice created:', response)

		const invoice = response?.paymentRequest || response?.invoice || response?.bolt11
		if (!invoice) {
			throw new Error('Spark SDK did not return an invoice')
		}

		return {
			invoice,
			paymentHash: response?.paymentHash
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
export async function listPayments(offset = 0, limit = 100): Promise<any[]> {
	if (!_sdkInstance) {
		throw new Error('Spark SDK is not initialized')
	}

	try {
		const response = await _sdkInstance.listPayments({ offset, limit })
		return response.payments || response || []
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

export async function refreshBalance(sync = false): Promise<bigint | null> {
	if (sync && _sdkInstance) {
		try { await _sdkInstance.syncWallet({}) } catch {}
	}
	await refreshBalanceInternal()
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

	// Determine encryption method from event tags, or detect from ciphertext format
	const encryptionTag = latestEvent.tags?.find((t: string[]) => t[0] === 'encryption')
	let encryptionMethod: string
	if (encryptionTag?.[1]) {
		// Explicit encryption tag takes priority
		encryptionMethod = encryptionTag[1]
	} else if (latestEvent.content.includes('?iv=')) {
		// NIP-04 format has ?iv= separator in the ciphertext
		encryptionMethod = 'nip04'
	} else {
		// Default to NIP-44 for newer backups without explicit tag
		encryptionMethod = 'nip44'
	}
	logger.info('[Spark] Found backup, decrypting with', encryptionMethod, '...')

	// Helper to add timeout to decrypt operations
	const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) =>
				setTimeout(() => reject(new Error(message)), ms)
			)
		])
	}

	// Decrypt the mnemonic using the appropriate method (with 15s timeout)
	let mnemonic: string
	const DECRYPT_TIMEOUT = 15000

	if (encryptionMethod === 'nip04') {
		if (!nostr.nip04?.decrypt) {
			throw new Error('This backup was encrypted with NIP-04 but your extension does not support it.')
		}
		mnemonic = await withTimeout(
			nostr.nip04.decrypt(pubkey, latestEvent.content),
			DECRYPT_TIMEOUT,
			'Decryption timed out. Please approve the decryption request in your Nostr extension.'
		)
	} else {
		// Default to NIP-44
		if (!nostr.nip44?.decrypt) {
			throw new Error('This backup was encrypted with NIP-44 but your extension does not support it.')
		}
		mnemonic = await withTimeout(
			nostr.nip44.decrypt(pubkey, latestEvent.content),
			DECRYPT_TIMEOUT,
			'Decryption timed out. Please approve the decryption request in your Nostr extension.'
		)
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
 * Relay backup status result
 */
export interface RelayBackupStatus {
	relay: string
	hasBackup: boolean
	timestamp?: number
	error?: string
}

/**
 * Check which relays have a backup of the wallet.
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
	// This avoids showing random outbox/gossip relays
	const relaysToCheck: string[] = Array.isArray(relays)
		? relays.filter((r: unknown): r is string => typeof r === 'string')
		: standardRelays

	if (relaysToCheck.length === 0) {
		logger.warn('[Spark] No relays configured')
		return []
	}

	logger.info(`[Spark] Checking backup status on ${relaysToCheck.length} relays...`)

	const results: RelayBackupStatus[] = []

	// Query each relay individually in parallel
	const checkPromises = relaysToCheck.map(async (relayUrl): Promise<RelayBackupStatus> => {
		try {
			// Create a filter for the backup event
			const filter = {
				kinds: [BACKUP_EVENT_KIND],
				authors: [pubkey],
				'#d': [BACKUP_D_TAG]
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
			logger.warn(`[Spark] Failed to check backup on ${relayUrl}: ${String(error)}`)
			return {
				relay: relayUrl,
				hasBackup: false,
				error: 'Connection failed'
			}
		}
	})

	const resultsArray = await Promise.all(checkPromises)
	results.push(...resultsArray)

	const backupCount = results.filter(r => r.hasBackup).length
	logger.info(`[Spark] Backup check complete: ${backupCount}/${results.length} relays have backup`)

	return results
}

/**
 * Delete Spark wallet backup from Nostr relays.
 * Publishes an empty replaceable event to overwrite the backup (more reliable than NIP-09).
 * @param pubkey The user's Nostr public key (hex string).
 */
export async function deleteBackupFromNostr(pubkey: string): Promise<void> {
	if (!browser) throw new Error('Backup deletion can only be performed in browser')

	const nostr = getNostrExtension()

	const { ndk, ndkReady } = await import('$lib/nostr')
	const { NDKEvent } = await import('@nostr-dev-kit/ndk')
	const { get } = await import('svelte/store')

	await ndkReady
	const ndkInstance = get(ndk)

	logger.info('[Spark] Deleting backup by publishing empty replacement...')

	// Create an empty replaceable event with the same d-tag to overwrite the backup
	// This is more reliable than NIP-09 deletion since relays must replace the old event
	const emptyBackupEvent = {
		kind: BACKUP_EVENT_KIND,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['d', BACKUP_D_TAG],
			['deleted', 'true']
		],
		content: '' // Empty content - no backup data
	}

	// Sign with extension
	logger.info('[Spark] Signing empty backup event...')
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

	logger.info('[Spark] Publishing empty backup to overwrite existing...')
	await ndkEvent.publish()

	logger.info('[Spark] Backup deleted (replaced with empty event)')
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
