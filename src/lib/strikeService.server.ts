/**
 * Strike API Service
 * 
 * Integration with Strike API for Lightning Network payments.
 * 
 * IMPORTANT: Strike API credentials are expected via environment variables:
 * - STRIKE_API_KEY: Your Strike API key
 * - STRIKE_API_BASE_URL: Base URL for Strike API (defaults to https://api.strike.me)
 * - STRIKE_WEBHOOK_SECRET: Secret for webhook signature verification
 * 
 * The keys are intentionally NOT hardcoded and must be set in your environment.
 * Example in .env file:
 *   STRIKE_API_KEY=your_api_key_here
 *   STRIKE_API_BASE_URL=https://api.strike.me
 *   STRIKE_WEBHOOK_SECRET=your_webhook_secret_here
 * 
 * NOTE: This file is server-only and uses SvelteKit's $env system.
 * Using dynamic/private so build doesn't fail when keys aren't set.
 */

import { env } from '$env/dynamic/private';

// Types for Strike API
export interface StrikeAmount {
	amount: string;
	currency: 'BTC' | 'USD' | 'EUR' | 'USDT' | 'GBP' | 'AUD';
}

export interface StrikeInvoice {
	invoiceId: string;
	amount: StrikeAmount;
	currency: string;
	state: 'UNPAID' | 'PENDING' | 'PAID' | 'CANCELLED';
	created: string;
	description?: string;
	bolt11?: string;
}

export interface ReceiveRequest {
	receiveRequestId: string;
	created: string;
	targetCurrency?: string;
	bolt11?: {
		invoice: string;
		requestedAmount?: StrikeAmount;
		btcAmount?: string;
		description?: string;
		paymentHash?: string;
		expires?: string;
	};
}

export interface Receive {
	receiveId: string;
	state: 'PENDING' | 'COMPLETED' | 'FAILED';
	amount?: StrikeAmount;
	completed?: string;
}

export interface CreateInvoiceResponse {
	receiveRequestId: string;
	created: string;
	invoice?: string; // BOLT11 invoice (top-level when bolt11 is requested)
	paymentHash?: string; // Payment hash (top-level when bolt11 is requested)
	expires?: string; // Expiration time as date-time string (top-level when bolt11 is requested)
	requestedAmount?: StrikeAmount; // Requested amount details
	btcAmount?: string; // Amount converted to BTC
	description?: string; // Invoice description
	descriptionHash?: string; // Description hash if provided
}

export interface WebhookEvent {
	eventType: string;
	entityId: string;
	changes?: Array<{
		field: string;
		oldValue: any;
		newValue: any;
	}>;
	timestamp: string;
}

/**
 * Get Strike API configuration from environment variables
 */
function getStrikeConfig(platform?: any) {
	const apiKey = platform?.env?.STRIKE_API_KEY || env.STRIKE_API_KEY;
	const baseUrl = platform?.env?.STRIKE_API_BASE_URL || env.STRIKE_API_BASE_URL || 'https://api.strike.me';
	const webhookSecret = platform?.env?.STRIKE_WEBHOOK_SECRET || env.STRIKE_WEBHOOK_SECRET;

	if (!apiKey) {
		throw new Error(
			'STRIKE_API_KEY environment variable is not set. ' +
			'Please set it in your .env file or in your hosting provider\'s environment variables.'
		);
	}

	return { apiKey, baseUrl, webhookSecret };
}

/**
 * Make an authenticated request to Strike API
 */
async function strikeRequest(
	endpoint: string,
	options: RequestInit = {},
	platform?: any
): Promise<Response> {
	const { apiKey, baseUrl } = getStrikeConfig(platform);
	const url = `${baseUrl.replace(/\/$/, '')}${endpoint}`;

	const response = await fetch(url, {
		...options,
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			...options.headers,
		},
	});

	return response;
}

/**
 * Create a Lightning invoice
 * 
 * @param amount - Amount in the specified currency (as string, e.g., "10.50")
 * @param currency - Currency code (BTC, USD, EUR, USDT, GBP, AUD)
 * @param description - Invoice description (1-250 characters)
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Invoice details including BOLT11 invoice string
 */
export async function createInvoice(
	amount: string,
	currency: StrikeAmount['currency'],
	description: string,
	platform?: any
): Promise<CreateInvoiceResponse> {
	if (!description || description.length < 1 || description.length > 250) {
		throw new Error('Description must be between 1 and 250 characters');
	}

	const response = await strikeRequest(
		'/v1/receive-requests',
		{
			method: 'POST',
			body: JSON.stringify({
				bolt11: {
					amount: {
						amount: amount,
						currency: currency,
					},
					description: description,
				},
			}),
		},
		platform
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Strike API error: ${response.status} ${response.statusText}. ${errorText}`
		);
	}

	const data = await response.json();
	return data;
}

/**
 * Check invoice status (legacy - for outgoing invoices)
 *
 * @param invoiceId - The invoice ID (UUID)
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Invoice details including current state
 */
export async function checkInvoiceStatus(
	invoiceId: string,
	platform?: any
): Promise<StrikeInvoice> {
	if (!invoiceId) {
		throw new Error('Invoice ID is required');
	}

	const response = await strikeRequest(
		`/v1/invoices/${invoiceId}`,
		{
			method: 'GET',
		},
		platform
	);

	if (!response.ok) {
		if (response.status === 404) {
			throw new Error(`Invoice not found: ${invoiceId}`);
		}
		const errorText = await response.text();
		throw new Error(
			`Strike API error: ${response.status} ${response.statusText}. ${errorText}`
		);
	}

	return await response.json();
}

/**
 * Get a receive request by ID
 *
 * @param receiveRequestId - The receive request ID (UUID)
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Receive request details
 */
export async function getReceiveRequest(
	receiveRequestId: string,
	platform?: any
): Promise<ReceiveRequest> {
	if (!receiveRequestId) {
		throw new Error('Receive request ID is required');
	}

	const response = await strikeRequest(
		`/v1/receive-requests/${receiveRequestId}`,
		{ method: 'GET' },
		platform
	);

	if (!response.ok) {
		if (response.status === 404) {
			throw new Error(`Receive request not found: ${receiveRequestId}`);
		}
		const errorText = await response.text();
		throw new Error(
			`Strike API error: ${response.status} ${response.statusText}. ${errorText}`
		);
	}

	return await response.json();
}

/**
 * Get receives (payments) for a receive request
 *
 * @param receiveRequestId - The receive request ID (UUID)
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Array of receives for the request
 */
export async function getReceiveRequestReceives(
	receiveRequestId: string,
	platform?: any
): Promise<Receive[]> {
	if (!receiveRequestId) {
		throw new Error('Receive request ID is required');
	}

	const response = await strikeRequest(
		`/v1/receive-requests/${receiveRequestId}/receives`,
		{ method: 'GET' },
		platform
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Strike API error: ${response.status} ${response.statusText}. ${errorText}`
		);
	}

	const data = await response.json();
	return Array.isArray(data) ? data : data.items || [];
}

/**
 * Validate and process webhook
 * 
 * @param payload - Raw webhook payload (string or object)
 * @param signature - Webhook signature from headers
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Parsed webhook event if valid, throws error if invalid
 */
export async function handleWebhook(
	payload: string | object,
	signature: string,
	platform?: any
): Promise<WebhookEvent> {
	const { webhookSecret } = getStrikeConfig(platform);

	if (!webhookSecret) {
		throw new Error(
			'STRIKE_WEBHOOK_SECRET environment variable is not set. ' +
			'Webhook signature verification requires this secret.'
		);
	}

	if (!signature) {
		throw new Error('Webhook signature is required for verification');
	}

	// Parse payload if it's a string
	const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
	const payloadObject = typeof payload === 'object' ? payload : JSON.parse(payloadString);

	// Verify webhook signature
	// Note: Strike API uses HMAC-SHA256 for webhook signatures
	// The exact implementation may vary - consult Strike documentation for specifics
	const isValid = await verifyWebhookSignature(
		payloadString,
		signature,
		webhookSecret
	);

	if (!isValid) {
		throw new Error('Invalid webhook signature');
	}

	return payloadObject as WebhookEvent;
}

/**
 * Get current BTC/USD exchange rate from Strike API
 * 
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Current BTC price in USD
 */
export async function getBtcUsdRate(platform?: any): Promise<number> {
	const response = await strikeRequest(
		'/v1/rates/ticker',
		{
			method: 'GET',
		},
		platform
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Strike API error: ${response.status} ${response.statusText}. ${errorText}`
		);
	}

	const rates = await response.json();
	
	// Strike returns an array of rate objects
	// Find the BTC/USD pair
	const btcUsdRate = rates.find((rate: any) => 
		rate.sourceCurrency === 'BTC' && rate.targetCurrency === 'USD'
	);

	if (!btcUsdRate || !btcUsdRate.amount) {
		throw new Error('BTC/USD rate not found in Strike response');
	}

	return parseFloat(btcUsdRate.amount);
}

/**
 * Check if Strike API is configured
 * 
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns true if STRIKE_API_KEY is set
 */
export function isStrikeConfigured(platform?: any): boolean {
	const apiKey = platform?.env?.STRIKE_API_KEY || env.STRIKE_API_KEY;
	return !!apiKey;
}

/**
 * Verify webhook signature using HMAC-SHA256
 * 
 * @param payload - Raw payload string
 * @param signature - Signature from webhook headers
 * @param secret - Webhook secret
 * @returns true if signature is valid
 */
async function verifyWebhookSignature(
	payload: string,
	signature: string,
	secret: string
): Promise<boolean> {
	try {
		const encoder = new TextEncoder();
		const keyData = encoder.encode(secret);
		const payloadData = encoder.encode(payload);

		const cryptoKey = await crypto.subtle.importKey(
			'raw',
			keyData,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);

		const expectedSignature = await crypto.subtle.sign('HMAC', cryptoKey, payloadData);
		const expectedBytes = new Uint8Array(expectedSignature);

		// Convert expected to hex for comparison with Strike's X-Webhook-Signature header
		const expectedHex = Array.from(expectedBytes)
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		// Timing-safe comparison to prevent timing attacks
		const a = encoder.encode(expectedHex.toLowerCase());
		const b = encoder.encode(signature.toLowerCase());
		if (a.byteLength !== b.byteLength) return false;

		// Use subtle.verify as a timing-safe comparison (Web Crypto doesn't expose timingSafeEqual)
		// Compare byte-by-byte with constant-time XOR
		let result = 0;
		for (let i = 0; i < a.byteLength; i++) {
			result |= a[i] ^ b[i];
		}
		return result === 0;
	} catch (error) {
		console.error('Error verifying webhook signature:', error);
		return false;
	}
}
