import {
	BreezSDK,
	Environment,
	SdkLiquid,
	SdkServices,
	connect,
	defaultConfig,
	seedFromMnemonic,
	disconnect,
	Payment,
	LightningAddressData,
	prepareSendPayment,
	sendPayment,
	lnurlPay,
	parseInput,
	PaymentType,
	LNURLPayRequest
} from '@breeztech/breez-sdk-spark'
import { generateMnemonic, validateMnemonic } from 'bip39'
import { writable } from 'svelte/store'
import {
	saveMnemonic,
	loadMnemonic,
	hasMnemonic,
	deleteMnemonic,
	clearAllSparkWallets
} from './storage'
import { getNdkInstance } from '$lib/nostr'
import NDK, { NDKEvent, NDKKind, NDKPrivateKeySigner, NDKFilter, NDKUser } from '@nostr-dev-kit/ndk'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { AuthManager } from '$lib/authManager'
import { logger } from '$lib/logger'

const NOSTR_WALLET_BACKUP_KIND = 30078 // NIP-33 event for generic parameters

// --- Writable Stores for Reactivity ---
export const breezSdk = writable<BreezSDK | null>(null)
export const lightningAddress = writable<string | null>(null)
export const walletBalance = writable<bigint | null>(null)
export const walletInitialized = writable<boolean>(false)

// --- Internal State ---
let _currentPubkey: string | null = null
let _ndk: NDK | null = null
let _authManager: AuthManager | null = null

// --- Helper for NDK Instance ---
function getNDK(): NDK {
	if (!_ndk) {
		_ndk = getNdkInstance()
		if (!_ndk) {
			throw new Error('NDK instance not available. Ensure Nostr is connected.')
		}
	}
	return _ndk
}

function getAuthManager(): AuthManager {
	if (!_authManager) {
		_authManager = new AuthManager(getNDK())
	}
	return _authManager
}

// --- Breez SDK Listeners ---
function startBreezSDKListeners(sdk: BreezSDK) {
	sdk.nodeInfoNotifications().subscribe({
		next: (nodeState) => {
			if (nodeState.blockHeight && nodeState.channelsBalanceMsat) {
				walletBalance.set(nodeState.channelsBalanceMsat / BigInt(1000))
				logger.debug('Breez SDK: Node info updated', nodeState)
			}
		},
		error: (e) => logger.error('Breez SDK: Node info error', e),
		complete: () => logger.info('Breez SDK: Node info subscription completed')
	})

	sdk.paymentsNotifications().subscribe({
		next: (payment) => {
			logger.info('Breez SDK: New payment received/sent', payment)
			// TODO: Handle zap receipt publishing here if it's an incoming zap
		},
		error: (e) => logger.error('Breez SDK: Payments notification error', e),
		complete: () => logger.info('Breez SDK: Payments subscription completed')
	})
}

/**
 * Initializes the Breez SDK and connects the wallet.
 * @param pubkey The user's Nostr public key (hex string).
 * @param password The user-provided password for decrypting the mnemonic.
 * @param mnemonic The BIP39 mnemonic phrase.
 * @param apiKey The Breez API key.
 * @returns True if initialization was successful, false otherwise.
 */
export async function initializeSdk(
	pubkey: string,
	password: string,
	mnemonic: string,
	apiKey: string
): Promise<boolean> {
	if (_currentPubkey === pubkey && (await breezSdk.get())) {
		logger.info('Breez SDK already initialized for this pubkey.')
		return true
	}

	logger.info('Initializing Breez SDK...')
	try {
		await disconnectWallet() // Ensure any previous SDK instance is disconnected

		_currentPubkey = pubkey

		const config = await defaultConfig(Environment.PRODUCTION)
		config.apiKey = apiKey
		config.workingDir = `/${pubkey}-breez-sdk` // Unique working directory per user

		const seed = seedFromMnemonic(mnemonic)

		const sdk = await connect({ config, seed })
		breezSdk.set(sdk)

		startBreezSDKListeners(sdk)

		// Fetch initial balance
		const nodeInfo = await sdk.nodeInfo()
		walletBalance.set(nodeInfo.channelsBalanceMsat / BigInt(1000))

		// Handle Lightning Address registration/fetching and profile sync
		await registerOrFetchLightningAddressAndSync(sdk, pubkey)

		walletInitialized.set(true)
		logger.info('Breez SDK initialized successfully.')
		return true
	} catch (error) {
		logger.error('Failed to initialize Breez SDK:', error)
		breezSdk.set(null)
		walletInitialized.set(false)
		return false
	}
}

/**
 * Creates a new BIP39 mnemonic, saves it securely, and connects the wallet.
 * @param pubkey The user's Nostr public key (hex string).
 * @param password The user-provided password for encrypting the mnemonic.
 * @param apiKey The Breez API key.
 * @returns The newly generated mnemonic phrase.
 * @throws Error if wallet creation or connection fails.
 */
export async function createAndConnectWallet(
	pubkey: string,
	password: string,
	apiKey: string
): Promise<string> {
	if (!validateMnemonic(password)) {
		throw new Error('Password must be a valid BIP39 mnemonic.')
	}
	const newMnemonic = generateMnemonic(128) // 12 words, 128-bit entropy
	await saveMnemonic(pubkey, password, newMnemonic)
	const connected = await initializeSdk(pubkey, password, newMnemonic, apiKey)
	if (!connected) {
		deleteMnemonic(pubkey) // Clean up if connection fails
		throw new Error('Failed to connect new wallet after creation.')
	}
	return newMnemonic
}

/**
 * Loads a securely stored mnemonic and connects the wallet.
 * @param pubkey The user's Nostr public key (hex string).
 * @param password The user-provided password for decrypting the mnemonic.
 * @param apiKey The Breez API key.
 * @returns True if the wallet was successfully connected, false otherwise.
 */
export async function connectWallet(pubkey: string, password: string, apiKey: string): Promise<boolean> {
	_currentPubkey = pubkey
	const mnemonic = await loadMnemonic(pubkey, password)
	if (!mnemonic) {
		logger.warn('No mnemonic found in local storage for this pubkey.')
		return false
	}
	if (!validateMnemonic(mnemonic)) {
		logger.error('Loaded mnemonic is invalid.')
		deleteMnemonic(pubkey) // Delete corrupted mnemonic
		return false
	}
	return initializeSdk(pubkey, password, mnemonic, apiKey)
}

/**
 * Disconnects the Breez SDK.
 */
export async function disconnectWallet(): Promise<void> {
	try {
		const sdk = await breezSdk.get()
		if (sdk) {
			await disconnect()
			logger.info('Breez SDK disconnected.')
		}
	} catch (error) {
		logger.error('Error disconnecting Breez SDK:', error)
	} finally {
		breezSdk.set(null)
		lightningAddress.set(null)
		walletBalance.set(null)
		walletInitialized.set(false)
		_currentPubkey = null
	}
}

/**
 * Sends a zap payment via the Breez SDK.
 * @param recipientInput The LNURL or Lightning Address of the recipient.
 * @param amountSats The amount in satoshis to send.
 * @param comment An optional comment for the payment.
 * @returns The payment object if successful.
 * @throws Error if SDK is not initialized or payment fails.
 */
export async function sendZap(
	recipientInput: string,
	amountSats: number,
	comment: string
): Promise<Payment> {
	const sdk = await breezSdk.get()
	if (!sdk) {
		throw new Error('Breez SDK is not initialized.')
	}

	try {
		const parsed = await parseInput(recipientInput)

		let payment: Payment

		if (parsed.type === PaymentType.LNURL_PAY) {
			const lnurlPayRequest = parsed.data as LNURLPayRequest

			// Ensure amount is within min/max limits
			const minSendable = Number(lnurlPayRequest.minSendable) / 1000;
			const maxSendable = Number(lnurlPayRequest.maxSendable) / 1000;

			if (amountSats < minSendable || amountSats > maxSendable) {
				throw new Error(`Amount must be between ${minSendable} and ${maxSendable} sats for this LNURL.`)
			}

			// Breez SDK expects amount in millisats
			const amountMsat = BigInt(amountSats) * BigInt(1000)

			const prepay = await prepareSendPayment({
				amountMsat,
				lnurlPayRequest,
				comment
			})
			payment = await lnurlPay(prepay)
		} else {
			// Fallback for Bolt11 invoices or other types if supported
			const amountMsat = BigInt(amountSats) * BigInt(1000)
			const prepay = await prepareSendPayment({
				amountMsat,
				destination: recipientInput,
				comment
			})
			payment = await sendPayment(prepay)
		}

		logger.info('Zap sent successfully:', payment)
		return payment
	} catch (error) {
		logger.error('Failed to send zap:', error)
		throw error
	}
}

/**
 * Backs up the encrypted wallet mnemonic to Nostr relays as a NIP-33 event.
 * The event content is the hex-encoded encrypted mnemonic.
 * @param pubkey The user's Nostr public key (hex string).
 * @param password The user-provided password used for encryption.
 * @returns The NDKEvent that was published.
 * @throws Error if mnemonic cannot be loaded or publishing fails.
 */
export async function backupWalletToNostr(pubkey: string, password: string): Promise<NDKEvent> {
	const mnemonic = await loadMnemonic(pubkey, password)
	if (!mnemonic) {
		throw new Error('Mnemonic not found in local storage. Cannot backup.')
	}

	// Mnemonic is already encrypted and stored locally. We'll store this same encrypted string.
	// This ensures the backup on Nostr requires the same password to decrypt.
	const encryptedMnemonicHex = localStorage.getItem(`spark_wallet_${pubkey}`)
	if (!encryptedMnemonicHex) {
		throw new Error('Encrypted mnemonic not found in local storage.')
	}

	const ndk = getNDK()
	const signer = getAuthManager().signer
	if (!signer) {
		throw new Error('No NDK signer available. Please log in.')
	}

	const event = new NDKEvent(ndk, {
		kind: NOSTR_WALLET_BACKUP_KIND,
		pubkey: pubkey,
		content: encryptedMnemonicHex, // Store the hex-encoded encrypted mnemonic
		tags: [
			['d', 'spark-wallet-backup'], // Identifier for this backup
			['t', 'breez-sdk-spark']
		]
	})

	event.signer = signer
	await event.sign()
	await event.publish()

	logger.info('Spark wallet backup published to Nostr relays:', event.rawEvent())
	return event
}

/**
 * Restores a wallet from a NIP-33 event on Nostr relays.
 * @param pubkey The user's Nostr public key (hex string).
 * @param password The user-provided password to decrypt the mnemonic.
 * @param apiKey The Breez API key.
 * @returns The decrypted mnemonic string if successful, or null if not found or decryption fails.
 * @throws Error if NDK signer is not available or restore fails.
 */
export async function restoreWalletFromNostr(
	pubkey: string,
	password: string,
	apiKey: string
): Promise<string | null> {
	const ndk = getNDK()
	const signer = getAuthManager().signer
	if (!signer) {
		throw new Error('No NDK signer available. Please log in.')
	}

	logger.info(`Attempting to restore Spark wallet for ${pubkey} from Nostr...`)

	const filter: NDKFilter = {
		kinds: [NOSTR_WALLET_BACKUP_KIND],
		authors: [pubkey],
		'#d': ['spark-wallet-backup'],
		limit: 1 // Get the latest backup
	}

	const event = await ndk.fetchEvent(filter)

	if (!event) {
		logger.warn('No Spark wallet backup event found on Nostr for this pubkey.')
		return null
	}

	try {
		// The event content is the hex-encoded encrypted mnemonic
		const encryptedMnemonicHex = event.content
		if (!encryptedMnemonicHex) {
			throw new Error('Nostr backup event content is empty.')
		}

		// To use loadMnemonic, we temporarily store the fetched encrypted hex string
		// as if it came from localStorage, then attempt to load it.
		// This re-uses the existing decryption logic.
		localStorage.setItem(`spark_wallet_${pubkey}`, encryptedMnemonicHex)
		const mnemonic = await loadMnemonic(pubkey, password)
		localStorage.removeItem(`spark_wallet_${pubkey}`) // Clean up temporary item

		if (mnemonic && validateMnemonic(mnemonic)) {
			await saveMnemonic(pubkey, password, mnemonic) // Save to local storage permanently
			await initializeSdk(pubkey, password, mnemonic, apiKey)
			logger.info('Spark wallet restored and connected from Nostr.')
			return mnemonic
		} else {
			throw new Error('Decrypted mnemonic is invalid or password incorrect.')
		}
	} catch (error) {
		logger.error('Failed to restore wallet from Nostr:', error)
		return null
	}
}

/**
 * Registers or fetches the Lightning Address and optionally syncs it to the Nostr profile.
 * @param sdk The initialized Breez SDK instance.
 * @param pubkey The user's Nostr public key.
 */
async function registerOrFetchLightningAddressAndSync(sdk: BreezSDK, pubkey: string): Promise<void> {
	try {
		let currentLnAddress = (await sdk.nodeInfo()).id // Node ID is often the LA for Spark

		if (currentLnAddress && currentLnAddress.includes('@')) {
			lightningAddress.set(currentLnAddress)
			logger.info('Breez Lightning Address:', currentLnAddress)

			// Attempt to sync to Nostr profile if not already set
			const ndk = getNDK()
			const currentUser = ndk.getUser({ hexpubkey: pubkey })
			await currentUser.fetchProfile()

			if (currentUser.profile && currentUser.profile.lud16 !== currentLnAddress) {
				logger.info(`Updating Nostr profile lud16 to ${currentLnAddress}...`)
				const authManager = getAuthManager()
				const signer = authManager.signer

				if (!signer) {
					logger.warn('Cannot update Nostr profile lud16: No NDK signer available.')
					return
				}

				// Create an event to update the profile
				const profileEvent = new NDKEvent(ndk, {
					kind: NDKKind.Profile,
					pubkey: pubkey,
					content: JSON.stringify({ ...currentUser.profile, lud16: currentLnAddress }),
					tags: []
				})
				profileEvent.signer = signer
				await profileEvent.sign()
				await profileEvent.publish()
				logger.info('Nostr profile lud16 updated successfully.')
				// Also update the local NDKUser profile
				currentUser.profile.lud16 = currentLnAddress
			}
		} else {
			logger.warn('Could not determine Lightning Address from Breez SDK node info.')
			lightningAddress.set(null)
		}
	} catch (error) {
		logger.error('Error in registerOrFetchLightningAddressAndSync:', error)
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

// Export the clearAllSparkWallets function from storage
export { clearAllSparkWallets }
