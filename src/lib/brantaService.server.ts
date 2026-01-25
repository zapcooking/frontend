/**
 * Branta Guardrail Service
 *
 * Integration with Branta API for payment address/invoice verification.
 * Registers Lightning invoices and Bitcoin addresses so users can verify
 * they are paying the legitimate recipient.
 *
 * Environment variables:
 * - BRANTA_API_KEY: Your Branta API key
 * - BRANTA_API_BASE_URL: Base URL (defaults to https://guardrail.branta.pro/v1)
 *
 * NOTE: This file is server-only and uses SvelteKit's $env system.
 */

import { env } from '$env/dynamic/private';

interface BrantaConfig {
	apiKey: string;
	baseUrl: string;
}

export interface RegisterPaymentOptions {
	ttl?: number; // Time-to-live in seconds (default: 86400 = 24 hours)
	description?: string;
	metadata?: Record<string, string>;
}

export interface RegisterPaymentResult {
	success: boolean;
	paymentId?: string;
	error?: string;
}

export interface VerifyPaymentResult {
	verified: boolean;
	registeredAt?: string;
	description?: string;
	error?: string;
}

/**
 * Get Branta API configuration from environment variables
 * Returns null if not configured (allows graceful degradation)
 */
function getBrantaConfig(platform?: any): BrantaConfig | null {
	const apiKey = platform?.env?.BRANTA_API_KEY || env.BRANTA_API_KEY;

	if (!apiKey) {
		return null;
	}

	const baseUrl =
		platform?.env?.BRANTA_API_BASE_URL ||
		env.BRANTA_API_BASE_URL ||
		'https://guardrail.branta.pro/v1';

	return { apiKey, baseUrl };
}

/**
 * Check if Branta is configured
 */
export function isBrantaConfigured(platform?: any): boolean {
	return getBrantaConfig(platform) !== null;
}

/**
 * Make an authenticated request to Branta API
 */
async function brantaRequest(
	endpoint: string,
	options: RequestInit = {},
	platform?: any
): Promise<Response> {
	const config = getBrantaConfig(platform);

	if (!config) {
		throw new Error('Branta API is not configured');
	}

	const { apiKey, baseUrl } = config;
	const url = `${baseUrl.replace(/\/$/, '')}${endpoint}`;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				...options.headers
			}
		});

		return response;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Register a payment address/invoice with Branta
 *
 * @param paymentString - The Bitcoin address, Lightning invoice, or Lightning address
 * @param options - Optional configuration (ttl, description, metadata)
 * @param platform - Optional platform object for Cloudflare Workers
 */
export async function registerPayment(
	paymentString: string,
	options: RegisterPaymentOptions = {},
	platform?: any
): Promise<RegisterPaymentResult> {
	if (!isBrantaConfigured(platform)) {
		return { success: false, error: 'Branta not configured' };
	}

	if (!paymentString || paymentString.trim().length === 0) {
		return { success: false, error: 'Payment string is required' };
	}

	try {
		const body: Record<string, any> = {
			payment: paymentString.trim(),
			ttl: options.ttl || 86400 // Default 24 hours
		};

		if (options.description) {
			body.description = options.description;
		}

		if (options.metadata) {
			body.metadata = options.metadata;
		}

		const response = await brantaRequest(
			'/payments',
			{
				method: 'POST',
				body: JSON.stringify(body)
			},
			platform
		);

		if (response.ok) {
			const data = await response.json();
			return {
				success: true,
				paymentId: data.id || data.payment_id || data.paymentId
			};
		}

		// Handle error responses
		const errorText = await response.text();
		console.warn(`[Branta] Registration failed (${response.status}):`, errorText);

		return {
			success: false,
			error: `API error: ${response.status}`
		};
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			console.warn('[Branta] Registration request timed out');
			return { success: false, error: 'Request timed out' };
		}

		console.warn('[Branta] Registration failed:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

/**
 * Verify if a payment address/invoice is registered with Branta
 *
 * @param paymentString - The Bitcoin address, Lightning invoice, or Lightning address
 * @param platform - Optional platform object for Cloudflare Workers
 */
export async function verifyPayment(
	paymentString: string,
	platform?: any
): Promise<VerifyPaymentResult> {
	if (!isBrantaConfigured(platform)) {
		return { verified: false, error: 'Branta not configured' };
	}

	if (!paymentString || paymentString.trim().length === 0) {
		return { verified: false, error: 'Payment string is required' };
	}

	try {
		const encodedPayment = encodeURIComponent(paymentString.trim());
		const response = await brantaRequest(`/payments/${encodedPayment}`, { method: 'GET' }, platform);

		if (response.ok) {
			const data = await response.json();
			return {
				verified: true,
				registeredAt: data.created_at || data.createdAt || data.registered_at,
				description: data.description
			};
		}

		if (response.status === 404) {
			// Not found = not registered (not an error)
			return { verified: false };
		}

		// Other error
		const errorText = await response.text();
		console.warn(`[Branta] Verification failed (${response.status}):`, errorText);

		return { verified: false, error: `API error: ${response.status}` };
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			console.warn('[Branta] Verification request timed out');
			return { verified: false, error: 'Request timed out' };
		}

		console.warn('[Branta] Verification failed:', error);
		return {
			verified: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}
