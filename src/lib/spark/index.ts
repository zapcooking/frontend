/**
 * Spark Wallet Module
 *
 * Self-custodial Lightning wallet integration using Breez SDK Spark.
 * Uses the v0.6.3+ API with SdkBuilder pattern.
 */

import { browser } from '$app/environment'
import { writable, get } from 'svelte/store'
import { generateMnemonic, validateMnemonic } from 'bip39'
import {
	saveMnemonic,
	loadMnemonic,
	hasMnemonic,
	deleteMnemonic,
	clearAllSparkWallets
} from './storage'
import { logger } from '$lib/logger'

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
async function refreshBalanceInternal(): Promise<void> {
	if (!_sdkInstance) return

	try {
		const info = await _sdkInstance.getInfo({})
		// Balance is in sats
		const balance = BigInt(info.balanceSat || 0)
		walletBalance.set(balance)
		logger.debug('[Spark] Balance updated:', balance.toString(), 'sats')
	} catch (error) {
		logger.error('[Spark] Failed to get balance:', error)
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
			const address = addr.address || addr
			lightningAddress.set(address)
			logger.info('[Spark] Lightning address:', address)
		}
	} catch (error) {
		// Lightning address might not be available for all configurations
		logger.debug('[Spark] No lightning address available:', error)
	}
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

	try {
		sparkLoading.set(true)

		// Disconnect any existing connection
		await disconnectWallet()

		// Initialize WASM
		await initWasm()

		// Import SDK functions
		const { defaultConfig, SdkBuilder, initLogging } = await import(
			'@breeztech/breez-sdk-spark/web'
		)

		// Initialize logging
		try {
			await initLogging({
				log: (entry: any) => {
					const level = entry.level?.toLowerCase() || 'debug'
					if (level === 'error') {
						logger.error('[Spark SDK]', entry.line)
					} else if (level === 'warn') {
						logger.warn('[Spark SDK]', entry.line)
					} else {
						logger.debug('[Spark SDK]', entry.line)
					}
				}
			})
		} catch (e) {
			// Logging initialization might fail if already initialized
			logger.debug('[Spark] Logging already initialized or failed:', e)
		}

		// Create config for mainnet
		const config = defaultConfig('mainnet')
		config.apiKey = apiKey

		logger.info('[Spark] Building SDK with config...')

		// Build SDK with mnemonic
		let builder = SdkBuilder.new(config, {
			type: 'mnemonic',
			mnemonic: mnemonic
		})

		// Use a unique storage directory per user
		const storageDir = `/spark-${pubkey.slice(0, 8)}`
		builder = await builder.withDefaultStorage(storageDir)

		// Build the SDK
		_sdkInstance = await builder.build()
		breezSdk.set(_sdkInstance)
		_currentPubkey = pubkey

		// Add event listener
		const eventListener = new SparkEventListener()
		await _sdkInstance.addEventListener(eventListener)

		// Get initial balance and lightning address
		await refreshBalanceInternal()
		await fetchLightningAddress()

		walletInitialized.set(true)
		logger.info('[Spark] SDK initialized successfully')
		return true
	} catch (error) {
		logger.error('[Spark] Failed to initialize SDK:', error)
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
					logger.warn('[Spark] Disconnect error:', error)
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
		logger.error('[Spark] Payment failed:', error)
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
		logger.error('[Spark] Failed to create invoice:', error)
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
		return response.payments || []
	} catch (error) {
		logger.error('[Spark] Failed to list payments:', error)
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
		logger.error('[Spark] Sync failed:', error)
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
	await refreshBalanceInternal()
	return get(walletBalance)
}

/**
 * Backup wallet mnemonic to Nostr (stub - needs NDK integration).
 * @param pubkey The user's Nostr public key.
 */
export async function backupWalletToNostr(pubkey: string): Promise<any> {
	// TODO: Implement Nostr backup using NDK
	// This requires NIP-78 event publishing
	throw new Error('Nostr backup not yet implemented in v0.6.3 integration')
}

/**
 * Restore wallet from Nostr backup (stub - needs NDK integration).
 * @param pubkey The user's Nostr public key.
 * @param apiKey The Breez API key.
 */
export async function restoreWalletFromNostr(
	pubkey: string,
	apiKey: string
): Promise<string | null> {
	// TODO: Implement Nostr restore using NDK
	// This requires NIP-78 event fetching
	logger.warn('[Spark] Nostr restore not yet implemented in v0.6.3 integration')
	return null
}

// Export storage utilities
export { clearAllSparkWallets, deleteMnemonic }
