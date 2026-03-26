/**
 * Branta Payment Verification Endpoint
 *
 * GET /api/branta/verify?payment=<paymentString>
 * GET /api/branta/verify?qr=<rawQrText>
 * Checks if a payment address/invoice is registered with Branta Guardrail
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPaymentInfo, getPaymentInfoByQRCode, isBrantaConfigured } from '$lib/brantaService.server';

export const GET: RequestHandler = async ({ url, platform }) => {
	// Check if Branta is configured
	if (!isBrantaConfigured(platform)) {
		return json({ verified: false, error: 'Branta not configured' }, { status: 503 });
	}

	const qrText = url.searchParams.get('qr');
	const paymentString = url.searchParams.get('payment');

	if (!qrText && !paymentString) {
		return json({ verified: false, error: 'payment or qr query parameter is required' }, { status: 400 });
	}

	try {
		const payment = qrText
			? await getPaymentInfoByQRCode(qrText, platform)
			: await getPaymentInfo(paymentString!, platform);

		return json({ verified: payment !== null, payment: payment ?? undefined });
	} catch (error) {
		console.error('[Branta API] Verification error:', error);
		return json(
			{ verified: false, error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
