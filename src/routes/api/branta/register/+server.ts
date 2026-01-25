/**
 * Branta Payment Registration Endpoint
 *
 * POST /api/branta/register
 * Registers a payment address/invoice with Branta Guardrail
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { registerPayment, isBrantaConfigured } from '$lib/brantaService.server';

export const POST: RequestHandler = async ({ request, platform }) => {
	// Check if Branta is configured
	if (!isBrantaConfigured(platform)) {
		return json({ success: false, error: 'Branta not configured' }, { status: 503 });
	}

	try {
		const body = await request.json();
		const { paymentString, ttl, description, metadata } = body;

		if (!paymentString || typeof paymentString !== 'string') {
			return json({ success: false, error: 'paymentString is required' }, { status: 400 });
		}

		const result = await registerPayment(
			paymentString,
			{
				ttl: typeof ttl === 'number' ? ttl : undefined,
				description: typeof description === 'string' ? description : undefined,
				metadata: typeof metadata === 'object' ? metadata : undefined
			},
			platform
		);

		if (result.success) {
			return json({ success: true, paymentId: result.paymentId });
		}

		return json({ success: false, error: result.error }, { status: 500 });
	} catch (error) {
		console.error('[Branta API] Registration error:', error);
		return json(
			{ success: false, error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
