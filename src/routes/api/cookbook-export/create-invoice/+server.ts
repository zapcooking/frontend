/**
 * Create Lightning invoice for a one-shot cookbook export.
 *
 * POST /api/cookbook-export/create-invoice
 *
 * Body:
 *   {
 *     buyerPubkey: string,   // hex pubkey of buyer (signed-in user)
 *     packNaddr: string,     // naddr1... — the pack being exported
 *     packTitle?: string     // optional, used in invoice description
 *   }
 *
 * Returns:
 *   200 {
 *     exportId: string,
 *     invoice: string,           // BOLT11
 *     paymentHash: string,
 *     receiveRequestId: string,
 *     invoiceExpiresAt: number,  // unix seconds
 *     amountSats: number
 *   }
 *
 * Mirrors /api/boost/create-invoice. Same Strike API + GATED_CONTENT
 * KV binding, different key prefix.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createInvoice as createStrikeInvoice } from '$lib/strikeService.server';
import {
	storeExport,
	type CookbookExportRecord
} from '$lib/cookbookExportStore.server';

const HEX64_RE = /^[0-9a-fA-F]{64}$/;
const COOKBOOK_EXPORT_SATS = 2100;

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const body = await request.json();
		const { buyerPubkey, packNaddr, packTitle } = body ?? {};

		if (!buyerPubkey || typeof buyerPubkey !== 'string' || !HEX64_RE.test(buyerPubkey)) {
			return json({ error: 'Invalid buyerPubkey format' }, { status: 400 });
		}
		if (!packNaddr || typeof packNaddr !== 'string' || !packNaddr.startsWith('naddr1')) {
			return json({ error: 'A valid packNaddr is required' }, { status: 400 });
		}

		const safeTitle =
			typeof packTitle === 'string' && packTitle.trim()
				? packTitle.trim().slice(0, 80)
				: 'Recipe Pack';
		const description = `zap.cooking · Cookbook export: "${safeTitle}"`;
		const amountSats = COOKBOOK_EXPORT_SATS;
		const btcAmount = (amountSats / 100_000_000).toFixed(8);

		const strikeResponse = await createStrikeInvoice(btcAmount, 'BTC', description, platform);
		const bolt11Data = (strikeResponse as any).bolt11;
		const invoice = bolt11Data?.invoice || strikeResponse.invoice;
		if (!invoice) {
			throw new Error('Strike API did not return a BOLT11 invoice');
		}

		const paymentHash = bolt11Data?.paymentHash || strikeResponse.paymentHash || '';
		const receiveRequestId = strikeResponse.receiveRequestId;

		let invoiceExpiresAt: number;
		const expiresString = bolt11Data?.expires || strikeResponse.expires;
		if (expiresString) {
			invoiceExpiresAt = Math.floor(new Date(expiresString).getTime() / 1000);
		} else {
			invoiceExpiresAt = Math.floor(Date.now() / 1000) + 3600;
		}

		const exportId = crypto.randomUUID();
		const kv = platform?.env?.GATED_CONTENT ?? null;
		if (!kv && env.NODE_ENV === 'production') {
			console.error('[cookbook-export] GATED_CONTENT KV binding missing in production');
			return json({ error: 'Service temporarily unavailable' }, { status: 503 });
		}

		const record: CookbookExportRecord = {
			id: exportId,
			buyerPubkey,
			packNaddr,
			packTitle: safeTitle,
			amountSats,
			receiveRequestId,
			paymentHash,
			status: 'pending',
			createdAt: Date.now(),
			paidAt: null
		};
		await storeExport(kv, record);

		return json({
			exportId,
			invoice,
			paymentHash,
			receiveRequestId,
			invoiceExpiresAt,
			amountSats
		});
	} catch (error: any) {
		console.error('[cookbook-export] create-invoice error:', error);
		let errorMessage = 'Failed to create Lightning invoice';
		if (error.message?.includes('STRIKE_API_KEY')) {
			errorMessage = 'Lightning payment service is not configured.';
		} else if (error.message?.includes('Strike API error')) {
			errorMessage = 'Lightning payment service error. Please try again.';
		} else if (error.message) {
			errorMessage = error.message;
		}
		return json({ error: errorMessage }, { status: 500 });
	}
};
