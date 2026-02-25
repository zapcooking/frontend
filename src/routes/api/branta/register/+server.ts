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
		const { paymentString, ttl, description, metadata, zk } = body;

		if (!paymentString || typeof paymentString !== 'string' || paymentString.trim().length === 0) {
			return json({ success: false, error: 'paymentString is required' }, { status: 400 });
		}

		const result = await registerPayment(
			paymentString,
			typeof ttl === 'number' ? ttl : undefined,
			typeof description === 'string' ? description : undefined,
			typeof metadata === 'object' ? metadata : undefined,
			typeof zk === 'boolean' ? zk : undefined, platform
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
