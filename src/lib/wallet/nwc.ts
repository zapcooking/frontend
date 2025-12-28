/**
 * NWC (Nostr Wallet Connect) Integration
 *
 * Implements NIP-47 using NDK for relay connections.
 * This avoids the Alby SDK's SimplePool WebSocket issues.
 */

import { browser } from '$app/environment'
import { ndk } from '$lib/nostr'
import { get } from 'svelte/store'
import { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import type { NDKRelay } from '@nostr-dev-kit/ndk'
import { nip04, nip19, getPublicKey as nostrGetPublicKey } from 'nostr-tools'

// Helper to get NDK instance from store
function getNdk() {
	return get(ndk)
}

// NWC state
let nwcRelay: NDKRelay | null = null
let nwcSecret: string | null = null
let nwcWalletPubkey: string | null = null
let currentConnectionUrl: string | null = null
let pendingBalanceRequest: Promise<number> | null = null

/**
 * Parse NWC connection URL
 * Format: nostr+walletconnect://pubkey?relay=wss://...&secret=...
 */
export function parseNwcUrl(url: string): { pubkey: string; relay: string; secret: string } | null {
	try {
		// Trim whitespace, newlines, and any invisible characters
		let cleaned = url.trim().replace(/[\r\n\t]/g, '')

		// Handle both formats: with and without //
		cleaned = cleaned
			.replace('nostr+walletconnect://', '')
			.replace('nostrwalletconnect://', '')
			.replace('nostr+walletconnect:', '')
			.replace('nostrwalletconnect:', '')

		const [pubkey, queryString] = cleaned.split('?')

		if (!pubkey || !queryString) {
			return null
		}

		const params = new URLSearchParams(queryString)
		const relay = params.get('relay')?.trim()
		const secret = params.get('secret')?.trim()

		if (!relay || !secret) {
			return null
		}

		return { pubkey: pubkey.trim(), relay, secret }
	} catch (e) {
		console.error('[NWC] Failed to parse connection URL:', e)
		return null
	}
}

/**
 * Validate NWC connection string
 */
export function isValidNwcUrl(url: string): boolean {
	return parseNwcUrl(url) !== null
}

/**
 * Normalize secret key to hex format
 * Handles both hex strings and nsec bech32 format
 */
function normalizeSecretKey(secret: string): string {
	// Trim whitespace and any trailing characters
	let cleaned = secret.trim()

	// If it starts with 'nsec', decode it
	if (cleaned.startsWith('nsec')) {
		const decoded = nip19.decode(cleaned)
		if (decoded.type === 'nsec') {
			// Convert Uint8Array to hex string
			const hex = Array.from(decoded.data as Uint8Array)
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('')
			return hex
		}
	}

	// Check if it's valid hex (64 chars for 32 bytes)
	if (/^[0-9a-fA-F]{64}$/.test(cleaned)) {
		return cleaned
	}

	// If 65 chars and starts with valid hex, truncate (trailing char from URL parsing)
	if (cleaned.length === 65 && /^[0-9a-fA-F]{64}/.test(cleaned)) {
		return cleaned.slice(0, 64)
	}

	// If longer, extract the first 64 hex chars
	const hexMatch = cleaned.match(/[0-9a-fA-F]{64}/)
	if (hexMatch) {
		return hexMatch[0]
	}

	return cleaned
}

/**
 * Get public key from secret key
 */
function getPublicKey(secret: string): string {
	const secretHex = normalizeSecretKey(secret)
	return nostrGetPublicKey(secretHex)
}

/**
 * Connect to NWC wallet using NDK
 */
export async function connectNwc(connectionUrl: string): Promise<boolean> {
	if (!browser) return false

	// Already connected to this URL
	if (currentConnectionUrl === connectionUrl && isNwcConnected()) {
		console.log('[NWC] Already connected to this wallet')
		return true
	}

	try {
		const parsed = parseNwcUrl(connectionUrl)
		if (!parsed) {
			throw new Error('Invalid NWC connection URL')
		}

		// Store connection details
		nwcSecret = parsed.secret
		nwcWalletPubkey = parsed.pubkey
		currentConnectionUrl = connectionUrl

		// Connect to the NWC relay using NDK
		const relayUrl = parsed.relay
		console.log('[NWC] Connecting to relay:', relayUrl)

		const { NDKRelay } = await import('@nostr-dev-kit/ndk')
		const ndkInstance = getNdk()

		// Check if relay already exists in NDK's pool
		let existingRelay: NDKRelay | undefined
		for (const relay of ndkInstance.pool.relays.values()) {
			if (relay.url === relayUrl || relay.url === relayUrl + '/') {
				existingRelay = relay
				break
			}
		}

		if (existingRelay && existingRelay.status === 1) {
			// Use existing connected relay
			nwcRelay = existingRelay
			console.log('[NWC] Using existing connected relay:', relayUrl)
		} else {
			// Create new relay and connect
			nwcRelay = new NDKRelay(relayUrl, undefined, ndkInstance)
			ndkInstance.pool.addRelay(nwcRelay)

			// Wait for relay to connect with timeout
			await new Promise<void>((resolve, reject) => {
				const connectTimeout = setTimeout(() => {
					reject(new Error('Relay connection timeout'))
				}, 10000)

				if (nwcRelay!.status === 1) {
					clearTimeout(connectTimeout)
					resolve()
					return
				}

				nwcRelay!.on('connect', () => {
					clearTimeout(connectTimeout)
					resolve()
				})

				nwcRelay!.on('disconnect', () => {
					clearTimeout(connectTimeout)
					reject(new Error('Relay disconnected'))
				})

				nwcRelay!.connect()
			})

			console.log('[NWC] Connected successfully to', relayUrl)
		}

		return true
	} catch (e) {
		console.error('[NWC] Connection failed:', e)
		nwcRelay = null
		nwcSecret = null
		nwcWalletPubkey = null
		currentConnectionUrl = null
		throw e
	}
}

/**
 * Disconnect NWC wallet
 */
export async function disconnectNwc(): Promise<void> {
	nwcRelay = null
	nwcSecret = null
	nwcWalletPubkey = null
	currentConnectionUrl = null
	console.log('[NWC] Disconnected')
}

/**
 * Check if NWC is connected
 */
export function isNwcConnected(): boolean {
	return nwcSecret !== null && nwcWalletPubkey !== null
}

/**
 * Execute a NIP-47 request
 */
async function executeNip47Request(method: string, params: Record<string, any> = {}): Promise<any> {
	if (!nwcSecret || !nwcWalletPubkey || !nwcRelay) {
		throw new Error('NWC not connected')
	}

	const ndkInstance = getNdk()
	const secretHex = normalizeSecretKey(nwcSecret)
	const clientPubkey = getPublicKey(nwcSecret)

	// Create the request content
	const content = JSON.stringify({
		method,
		params
	})

	// Encrypt content using NIP-04
	const encryptedContent = await nip04.encrypt(secretHex, nwcWalletPubkey, content)

	// Create the request event (kind 23194)
	const event = new NDKEvent(ndkInstance)
	event.kind = 23194
	event.content = encryptedContent
	event.tags = [['p', nwcWalletPubkey]]

	// Sign with the secret key
	const signer = new NDKPrivateKeySigner(secretHex)
	event.pubkey = clientPubkey
	await event.sign(signer)

	// Create a relay set using the existing connected relay
	const { NDKRelaySet } = await import('@nostr-dev-kit/ndk')
	const relaySet = new NDKRelaySet(new Set([nwcRelay]), ndkInstance)

	// Set up subscription for response before publishing
	const sub = ndkInstance.subscribe(
		{
			kinds: [23195],
			authors: [nwcWalletPubkey!],
			'#p': [clientPubkey],
			'#e': [event.id!]
		},
		{ closeOnEose: false },
		relaySet
	)

	const responsePromise = new Promise<any>((resolve, reject) => {
		// 10 second timeout (reduced from 30s for better UX)
		const timeout = setTimeout(() => {
			sub.stop()
			reject(new Error('NWC request timeout'))
		}, 10000)

		sub.on('event', async (responseEvent: NDKEvent) => {
			try {
				clearTimeout(timeout)
				sub.stop()

				// Decrypt the response
				const decryptedContent = await nip04.decrypt(
					secretHex,
					nwcWalletPubkey!,
					responseEvent.content
				)

				const response = JSON.parse(decryptedContent)

				if (response.error) {
					reject(new Error(response.error.message || 'NWC error'))
				} else {
					resolve(response.result)
				}
			} catch (e) {
				clearTimeout(timeout)
				sub.stop()
				reject(e)
			}
		})
	})

	// Small delay to ensure subscription is registered with relay
	await new Promise((r) => setTimeout(r, 100))

	// Publish the request to the NWC relay specifically
	console.log('[NWC] Publishing request:', method, 'to', nwcRelay.url)
	await event.publish(relaySet)

	// Wait for response
	return responsePromise
}

/**
 * Get NWC wallet balance
 */
export async function getNwcBalance(retries = 3): Promise<number> {
	if (!isNwcConnected()) {
		throw new Error('NWC not connected')
	}

	// Return existing request if one is in progress
	if (pendingBalanceRequest) {
		console.log('[NWC] Balance request already in progress, waiting...')
		return pendingBalanceRequest
	}

	const fetchBalance = async (): Promise<number> => {
		let lastError: Error | null = null

		for (let attempt = 1; attempt <= retries; attempt++) {
			try {
				const result = await executeNip47Request('get_balance')
				// Balance is returned in msats, convert to sats
				const balanceSats = Math.floor((result.balance || 0) / 1000)
				console.log('[NWC] Balance:', balanceSats, 'sats')
				return balanceSats
			} catch (e) {
				lastError = e instanceof Error ? e : new Error(String(e))
				console.warn(`[NWC] Balance fetch attempt ${attempt}/${retries} failed:`, lastError.message)

				if (attempt < retries) {
					// Short wait before retry (500ms, 1s)
					await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
				}
			}
		}

		console.error('[NWC] Failed to get balance after', retries, 'attempts:', lastError)
		throw lastError || new Error('Failed to get NWC balance')
	}

	pendingBalanceRequest = fetchBalance()
	try {
		return await pendingBalanceRequest
	} finally {
		pendingBalanceRequest = null
	}
}

/**
 * Pay a Lightning invoice via NWC
 */
export async function payNwcInvoice(invoice: string): Promise<{ preimage: string }> {
	if (!isNwcConnected()) {
		throw new Error('NWC not connected')
	}

	try {
		console.log('[NWC] Paying invoice...')
		const result = await executeNip47Request('pay_invoice', { invoice })
		console.log('[NWC] Payment successful, preimage:', result.preimage)
		return { preimage: result.preimage }
	} catch (e) {
		console.error('[NWC] Payment failed:', e)
		throw e
	}
}

/**
 * Create a Lightning invoice via NWC
 */
export async function createNwcInvoice(
	amountSats: number,
	description?: string
): Promise<{ invoice: string; paymentHash: string }> {
	if (!isNwcConnected()) {
		throw new Error('NWC not connected')
	}

	try {
		console.log('[NWC] Creating invoice for', amountSats, 'sats')
		const result = await executeNip47Request('make_invoice', {
			amount: amountSats * 1000, // Convert to msats
			description: description || 'zap.cooking payment'
		})
		console.log('[NWC] Invoice created')
		return {
			invoice: result.invoice,
			paymentHash: result.payment_hash
		}
	} catch (e) {
		console.error('[NWC] Failed to create invoice:', e)
		throw e
	}
}

/**
 * Get wallet info via NWC
 */
export async function getNwcInfo(): Promise<{ alias?: string; methods: string[] }> {
	if (!isNwcConnected()) {
		throw new Error('NWC not connected')
	}

	try {
		const result = await executeNip47Request('get_info')
		return {
			alias: result.alias,
			methods: result.methods || []
		}
	} catch (e) {
		console.error('[NWC] Failed to get info:', e)
		throw e
	}
}

/**
 * Transaction type from NWC
 */
export interface NwcTransaction {
	type: 'incoming' | 'outgoing'
	invoice?: string
	description?: string
	preimage?: string
	payment_hash: string
	amount: number // in msats
	fees_paid?: number // in msats
	created_at: number // unix timestamp
	settled_at?: number // unix timestamp
}

/**
 * List transactions via NWC (NIP-47 list_transactions)
 */
export async function listNwcTransactions(
	options: {
		from?: number // unix timestamp
		until?: number // unix timestamp
		limit?: number
		offset?: number
		type?: 'incoming' | 'outgoing'
	} = {}
): Promise<{ transactions: NwcTransaction[]; hasMore: boolean }> {
	if (!isNwcConnected()) {
		throw new Error('NWC not connected')
	}

	try {
		const params: Record<string, any> = {}
		if (options.from) params.from = options.from
		if (options.until) params.until = options.until
		if (options.limit) params.limit = options.limit
		if (options.offset) params.offset = options.offset
		if (options.type) params.type = options.type

		console.log('[NWC] Listing transactions...')
		const result = await executeNip47Request('list_transactions', params)

		const transactions: NwcTransaction[] = (result.transactions || []).map((tx: any) => ({
			type: tx.type,
			invoice: tx.invoice,
			description: tx.description,
			preimage: tx.preimage,
			payment_hash: tx.payment_hash,
			amount: tx.amount || 0,
			fees_paid: tx.fees_paid,
			created_at: tx.created_at,
			settled_at: tx.settled_at
		}))

		console.log('[NWC] Found', transactions.length, 'transactions')
		return {
			transactions,
			hasMore: transactions.length === (options.limit || 10)
		}
	} catch (e) {
		console.error('[NWC] Failed to list transactions:', e)
		throw e
	}
}

/**
 * Get a display name for the NWC connection
 */
export function getNwcDisplayName(connectionUrl: string): string {
	const parsed = parseNwcUrl(connectionUrl)
	if (!parsed) return 'NWC Wallet'

	// Use first 8 chars of pubkey as identifier
	return `NWC (${parsed.pubkey.slice(0, 8)}...)`
}
