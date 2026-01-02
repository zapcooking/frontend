/**
 * NWC (Nostr Wallet Connect) Integration
 *
 * Implements NIP-47 using NDK for relay connections.
 * This avoids the Alby SDK's SimplePool WebSocket issues.
 */

import { browser } from '$app/environment'
import { ndk, ndkReady } from '$lib/nostr'
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

// Connection mutex to prevent concurrent connection attempts (Safari iOS fix)
let connectionInProgress: Promise<boolean> | null = null

/**
 * Parse NWC connection URL
 * Format: nostr+walletconnect://pubkey?relay=wss://...&secret=...&lud16=user@domain.com
 */
export function parseNwcUrl(url: string): { pubkey: string; relay: string; secret: string; lud16?: string } | null {
	try {
		// CRITICAL: Trim whitespace, newlines, and any invisible characters
		// Without this, pasted URLs with trailing newlines cause relay connection timeouts
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
		const lud16 = params.get('lud16')?.trim() || undefined

		if (!relay || !secret) {
			return null
		}

		return { pubkey: pubkey.trim(), relay, secret, lud16 }
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

	// Ensure NDK is ready before connecting
	await ndkReady

	// Already connected to this URL (INLINED to avoid TDZ - isNwcConnectedTo is defined later)
	if (currentConnectionUrl === connectionUrl && nwcSecret !== null && nwcWalletPubkey !== null && nwcRelay?.status === 1) {
		return true
	}

	// If a connection is already in progress, wait for it
	// This prevents "WebSocket is closed before connection established" on Safari iOS
	if (connectionInProgress) {
		console.log('[NWC] Connection already in progress, waiting...')
		return connectionInProgress
	}

	// Start the connection with mutex
	connectionInProgress = (async () => {
		try {
			const parsed = parseNwcUrl(connectionUrl)
			if (!parsed) {
				throw new Error('Invalid NWC connection URL')
			}

			// Store connection details
			nwcSecret = parsed.secret
			nwcWalletPubkey = parsed.pubkey
			currentConnectionUrl = connectionUrl

			let relayUrl = parsed.relay
			if (!relayUrl.endsWith('/')) relayUrl = relayUrl + '/'

			const { NDKRelay } = await import('@nostr-dev-kit/ndk')
			const ndkInstance = getNdk()

			// Remove any existing relay with this URL from pool
			for (const relay of ndkInstance.pool.relays.values()) {
				if (relay.url === relayUrl) {
					try { relay.disconnect() } catch {}
					ndkInstance.pool.removeRelay(relayUrl)
					await new Promise((r) => setTimeout(r, 100))
					break
				}
			}

			// Create independent relay connection (not in pool)
			nwcRelay = new NDKRelay(relayUrl, undefined, ndkInstance)
			await waitForRelayConnection(nwcRelay, 15000)
			return true
		} catch (e) {
			console.error('[NWC] Connection failed:', e)
			nwcRelay = null
			nwcSecret = null
			nwcWalletPubkey = null
			currentConnectionUrl = null
			throw e
		} finally {
			connectionInProgress = null
		}
	})()

	return connectionInProgress
}

async function waitForRelayConnection(relay: NDKRelay, timeoutMs: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(connectTimeout)
			relay.off('connect', onConnect)
			relay.off('disconnect', onDisconnect)
		}

		const connectTimeout = setTimeout(() => {
			cleanup()
			reject(new Error('Relay connection timeout'))
		}, timeoutMs)

		if (relay.status === 1) {
			cleanup()
			resolve()
			return
		}

		const onConnect = () => {
			cleanup()
			resolve()
		}

		const onDisconnect = () => {
			// Safari iOS can disconnect before connection is established
			cleanup()
			reject(new Error('Relay disconnected before connection established'))
		}

		relay.on('connect', onConnect)
		relay.on('disconnect', onDisconnect)
		relay.connect()
	})
}

export async function disconnectNwc(): Promise<void> {
	if (nwcRelay) {
		const ndkInstance = getNdk()
		const relayUrl = nwcRelay.url
		try { nwcRelay.disconnect() } catch {}
		try { ndkInstance.pool.removeRelay(relayUrl) } catch {}
	}
	nwcRelay = null
	nwcSecret = null
	nwcWalletPubkey = null
	currentConnectionUrl = null
}

/**
 * Check if NWC is connected
 */
export function isNwcConnected(): boolean {
	return nwcSecret !== null && nwcWalletPubkey !== null && nwcRelay?.status === 1
}

/**
 * Check if NWC is connected to a specific wallet URL
 * NOTE: Inlined to avoid TDZ bundler errors - do not call isNwcConnected() here
 */
export function isNwcConnectedTo(connectionUrl: string): boolean {
	return currentConnectionUrl === connectionUrl && nwcSecret !== null && nwcWalletPubkey !== null && nwcRelay?.status === 1
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

	await new Promise((r) => setTimeout(r, 100))
	await event.publish(relaySet)
	return responsePromise
}

export async function getNwcBalance(retries = 3): Promise<number> {
	if (!isNwcConnected()) throw new Error('NWC not connected')
	if (pendingBalanceRequest) return pendingBalanceRequest

	const fetchBalance = async (): Promise<number> => {
		let lastError: Error | null = null
		for (let attempt = 1; attempt <= retries; attempt++) {
			try {
				const result = await executeNip47Request('get_balance')
				return Math.floor((result.balance || 0) / 1000)
			} catch (e) {
				lastError = e instanceof Error ? e : new Error(String(e))
				if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * attempt))
			}
		}
		throw lastError || new Error('Failed to get NWC balance')
	}

	pendingBalanceRequest = fetchBalance()
	try {
		return await pendingBalanceRequest
	} finally {
		pendingBalanceRequest = null
	}
}

export async function payNwcInvoice(invoice: string): Promise<{ preimage: string }> {
	if (!isNwcConnected()) throw new Error('NWC not connected')
	const result = await executeNip47Request('pay_invoice', { invoice })
	return { preimage: result.preimage }
}

export async function createNwcInvoice(
	amountSats: number,
	description?: string
): Promise<{ invoice: string; paymentHash: string }> {
	if (!isNwcConnected()) throw new Error('NWC not connected')
	const result = await executeNip47Request('make_invoice', {
		amount: amountSats * 1000,
		description: description || 'zap.cooking payment'
	})
	return { invoice: result.invoice, paymentHash: result.payment_hash }
}

export async function lookupNwcInvoice(
	paymentHash: string
): Promise<{ paid: boolean; preimage?: string; settled_at?: number }> {
	if (!isNwcConnected()) throw new Error('NWC not connected')
	const result = await executeNip47Request('lookup_invoice', { payment_hash: paymentHash })
	const paid = typeof result.settled_at === 'number' && result.settled_at > 0
	return { paid, preimage: result.preimage, settled_at: result.settled_at }
}

export async function getNwcInfo(): Promise<{ alias?: string; methods: string[] }> {
	if (!isNwcConnected()) throw new Error('NWC not connected')
	const result = await executeNip47Request('get_info')
	return { alias: result.alias, methods: result.methods || [] }
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

export async function listNwcTransactions(
	options: { from?: number; until?: number; limit?: number; offset?: number; type?: 'incoming' | 'outgoing' } = {}
): Promise<{ transactions: NwcTransaction[]; hasMore: boolean }> {
	if (!isNwcConnected()) throw new Error('NWC not connected')

	const params: Record<string, any> = {}
	if (options.from) params.from = options.from
	if (options.until) params.until = options.until
	if (options.limit) params.limit = options.limit
	if (options.offset) params.offset = options.offset
	if (options.type) params.type = options.type

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
	return { transactions, hasMore: transactions.length === (options.limit || 10) }
}

export function getNwcDisplayName(connectionUrl: string): string {
	const parsed = parseNwcUrl(connectionUrl)
	if (!parsed) return 'NWC Wallet'
	return `NWC (${parsed.pubkey.slice(0, 8)}...)`
}

export function getNwcLud16(connectionUrl: string): string | null {
	const parsed = parseNwcUrl(connectionUrl)
	return parsed?.lud16 || null
}

export function isLightningAddress(input: string): boolean {
	return /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(input.trim())
}

async function resolveLightningAddress(
	address: string
): Promise<{ callback: string; minSendable: number; maxSendable: number; commentAllowed?: number }> {
	const [username, domain] = address.trim().toLowerCase().split('@')
	const response = await fetch(`https://${domain}/.well-known/lnurlp/${username}`)
	if (!response.ok) throw new Error(`Failed to resolve Lightning address: ${response.status}`)
	const data = await response.json()
	if (data.status === 'ERROR') throw new Error(data.reason || 'Lightning address resolution failed')
	return {
		callback: data.callback,
		minSendable: data.minSendable || 1000,
		maxSendable: data.maxSendable || 100000000000,
		commentAllowed: data.commentAllowed
	}
}

async function fetchLnurlInvoice(callback: string, amountMsats: number, comment?: string): Promise<string> {
	let url = `${callback}?amount=${amountMsats}`
	if (comment) url += `&comment=${encodeURIComponent(comment)}`
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Failed to fetch LNURL invoice: ${response.status}`)
	const data = await response.json()
	if (data.status === 'ERROR') throw new Error(data.reason || 'Failed to get invoice from Lightning address')
	if (!data.pr) throw new Error('No invoice returned from Lightning address')
	return data.pr
}

export async function payNwcLightningAddress(
	address: string,
	amountSats: number,
	comment?: string
): Promise<{ preimage: string }> {
	if (!isNwcConnected()) throw new Error('NWC not connected')
	if (!amountSats || amountSats <= 0) throw new Error('Amount is required for Lightning address payments')

	const lnurlInfo = await resolveLightningAddress(address)
	const amountMsats = amountSats * 1000

	if (amountMsats < lnurlInfo.minSendable) {
		throw new Error(`Amount too small. Minimum: ${Math.ceil(lnurlInfo.minSendable / 1000)} sats`)
	}
	if (amountMsats > lnurlInfo.maxSendable) {
		throw new Error(`Amount too large. Maximum: ${Math.floor(lnurlInfo.maxSendable / 1000)} sats`)
	}

	let finalComment = comment
	if (comment && lnurlInfo.commentAllowed && comment.length > lnurlInfo.commentAllowed) {
		finalComment = comment.substring(0, lnurlInfo.commentAllowed)
	} else if (comment && !lnurlInfo.commentAllowed) {
		finalComment = undefined
	}

	const invoice = await fetchLnurlInvoice(lnurlInfo.callback, amountMsats, finalComment)
	return await payNwcInvoice(invoice)
}
