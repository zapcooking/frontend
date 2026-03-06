/**
 * Branta Payment Verification Endpoint
 *
 * GET /api/branta/verify?payment=<paymentString>
 * Checks if a payment address/invoice is registered with Branta Guardrail
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyPayment, isBrantaConfigured, getBrantaConfig } from '$lib/brantaService.server';

export const GET: RequestHandler = async ({ url, platform }) => {
	// Check if Branta is configured
	if (!isBrantaConfigured(platform)) {
		return json({ verified: false, error: 'Branta not configured' }, { status: 503 });
	}

	const paymentString = url.searchParams.get('payment');

	if (!paymentString) {
		return json({ verified: false, error: 'payment query parameter is required' }, { status: 400 });
	}

	try {
		const result = await verifyPayment(paymentString, platform);

		const response: Record<string, unknown> = {
			verified: result.verified,
			registeredAt: result.registeredAt,
			description: result.description
		};

		const config = getBrantaConfig(platform);
		response.verifyLink = config!.baseUrl + '/v2/verify/' + encodeURIComponent(paymentString);

		return json(response);
	} catch (error) {
		console.error('[Branta API] Verification error:', error);
		return json(
			{ verified: false, error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
