/**
 * Create Lightning invoice for a one-shot cookbook export.
 *
 * POST /api/cookbook-export/create-invoice
 *
 * Body:
 *   {
 *     buyerPubkey: string,   // hex pubkey of buyer (signed-in user)
 *     packNaddr: string,     // naddr1... — the pack being exported
 *     packTitle?: string,    // optional, used in invoice description
 *     promoCode?: string     // optional discount code (server-validated)
 *   }
 *
 * Returns:
 *   200 (paid path) {
 *     exportId: string,
 *     invoice: string,           // BOLT11
 *     paymentHash: string,
 *     receiveRequestId: string,
 *     invoiceExpiresAt: number,  // unix seconds
 *     amountSats: number,
 *     promo?: { code, label, originalSats, finalSats }
 *   }
 *   200 (free-promo path) {
 *     exportId: string,
 *     free: true,                // client should treat as paid
 *     amountSats: 0,
 *     promo: { code, label, originalSats: COOKBOOK_EXPORT_SATS, finalSats: 0 }
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
	markExportPaid,
	type CookbookExportRecord
} from '$lib/cookbookExportStore.server';
import { COOKBOOK_EXPORT_SATS } from '$lib/cookbookPricing';
import { applyPromo } from '$lib/cookbookPromo.server';

const HEX64_RE = /^[0-9a-fA-F]{64}$/;

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const body = await request.json();
		const { buyerPubkey, packNaddr, packTitle, promoCode } = body ?? {};

		if (!buyerPubkey || typeof buyerPubkey !== 'string' || !HEX64_RE.test(buyerPubkey)) {
			return json({ error: 'Invalid buyerPubkey format' }, { status: 400 });
		}
		if (!packNaddr || typeof packNaddr !== 'string' || !packNaddr.startsWith('naddr1')) {
			return json({ error: 'A valid packNaddr is required' }, { status: 400 });
		}

		// Server-side promo validation. The client may send a code string,
		// but only this validation determines the actual price.
		let amountSats = COOKBOOK_EXPORT_SATS;
		let promo: {
			code: string;
			label: string;
			originalSats: number;
			finalSats: number;
		} | null = null;

		const kv = platform?.env?.GATED_CONTENT ?? null;

		if (typeof promoCode === 'string' && promoCode.trim()) {
			const lookup = await applyPromo(kv, promoCode, COOKBOOK_EXPORT_SATS);
			if (!lookup.ok || !lookup.applied) {
				return json(
					{ error: 'Promo code not valid', promoError: lookup.error || 'unknown_code' },
					{ status: 400 }
				);
			}
			amountSats = lookup.applied.finalSats;
			promo = {
				code: lookup.applied.code,
				label: lookup.applied.label,
				originalSats: lookup.applied.originalSats,
				finalSats: lookup.applied.finalSats
			};
		}

		const safeTitle =
			typeof packTitle === 'string' && packTitle.trim()
				? packTitle.trim().slice(0, 80)
				: 'Recipe Pack';

		const exportId = crypto.randomUUID();
		if (!kv && env.NODE_ENV === 'production') {
			console.error('[cookbook-export] GATED_CONTENT KV binding missing in production');
			return json({ error: 'Service temporarily unavailable' }, { status: 503 });
		}

		// 100%-off promo path: skip Strike, write a paid record directly,
		// return free=true. The verify-payment endpoint will idempotently
		// see status='paid' if the client double-checks.
		if (amountSats === 0) {
			const record: CookbookExportRecord = {
				id: exportId,
				buyerPubkey,
				packNaddr,
				packTitle: safeTitle,
				amountSats: 0,
				receiveRequestId: `promo:${exportId}`,
				paymentHash: '',
				status: 'paid',
				createdAt: Date.now(),
				paidAt: Date.now()
			};
			await storeExport(kv, record);
			// Note: no need to call markExportPaid — record is created paid.
			void markExportPaid; // tree-shake hint kept for symmetry with verify path

			return json({
				exportId,
				free: true,
				amountSats: 0,
				promo
			});
		}

		// Paid path — create the Strike invoice.
		const description = `zap.cooking · Cookbook export: "${safeTitle}"`;
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
			amountSats,
			promo
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
