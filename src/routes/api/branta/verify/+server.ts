/**
 * Branta Payment Verification Endpoint
 *
 * POST /api/branta/verify
 *   body: { payment?: string, qr?: string, secret?: string }
 *
 * Checks if a payment address/invoice is registered with Branta Guardrail.
 * Uses POST so the (sensitive) Branta secret is not placed in URL query
 * params, where it can leak via logs, proxies, and referrers.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPaymentInfo, getPaymentInfoByQRCode, isBrantaConfigured } from '$lib/brantaService.server';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	if (!isBrantaConfigured(platform)) {
		return json({ verified: false, error: 'Branta not configured' }, { status: 503 });
	}

	// Per-IP cap. These proxy to Branta's API on our API key, so an
	// unbounded caller spends our quota (and could be used to probe
	// addresses through us). Tighter than /api/shorten because legitimate
	// use is a few payments per session, not bulk.
	let ip = '127.0.0.1';
	try {
		ip = getClientAddress();
	} catch {
		// No client address available — use the loopback bucket rather
		// than failing the request.
	}
	const rate = await checkPerIpRateLimit(platform?.env?.NOURISH_FLAGS, {
		ip,
		scope: 'branta-verify',
		perHour: 5,
		perDay: 20
	});
	if (rate.limited) {
		return json({ verified: false, ...rate.body }, { status: 429 });
	}

	let body: { payment?: unknown; qr?: unknown; secret?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ verified: false, error: 'invalid JSON body' }, { status: 400 });
	}

	const qrText = typeof body.qr === 'string' && body.qr.trim() ? body.qr : undefined;
	const paymentString =
		typeof body.payment === 'string' && body.payment.trim() ? body.payment : undefined;

	if (!qrText && !paymentString) {
		return json(
			{ verified: false, error: 'payment or qr field is required' },
			{ status: 400 }
		);
	}

	const rawSecret = typeof body.secret === 'string' ? body.secret : undefined;
	const encryptionKey = rawSecret?.trim() ? rawSecret : undefined;

	try {
		const payment = qrText
			? await getPaymentInfoByQRCode(qrText, platform)
			: await getPaymentInfo(paymentString!, encryptionKey, platform);

		return json({ verified: payment !== null, payment: payment ?? undefined });
	} catch (error) {
		console.error('[Branta API] Verification error:', error);
		return json(
			{ verified: false, error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
