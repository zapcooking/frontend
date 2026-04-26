/**
 * Verify a Lightning-paid cookbook export.
 *
 * POST /api/cookbook-export/verify-payment
 *
 * Body:
 *   { exportId: string, receiveRequestId: string }
 *
 * Returns:
 *   200 { success: true, paidAt: number }
 *   402 { error: 'Payment not yet completed', paid: false }
 *   404 { error: 'Export not found or expired' }
 *
 * Mirrors /api/boost/verify-payment. Same Strike API check.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getReceiveRequestReceives } from '$lib/strikeService.server';
import { getExport, markExportPaid } from '$lib/cookbookExportStore.server';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const body = await request.json();
		const { exportId, receiveRequestId } = body ?? {};

		if (!exportId) return json({ error: 'exportId is required' }, { status: 400 });
		if (!receiveRequestId)
			return json({ error: 'receiveRequestId is required' }, { status: 400 });

		const kv = platform?.env?.GATED_CONTENT ?? null;
		if (!kv && env.NODE_ENV === 'production') {
			console.error('[cookbook-export verify] GATED_CONTENT KV binding missing in production');
			return json({ error: 'Service unavailable' }, { status: 503 });
		}

		const rec = await getExport(kv, exportId);
		if (!rec) {
			return json(
				{ error: 'Export not found or expired. Please create a new invoice.' },
				{ status: 404 }
			);
		}

		// Idempotent — already paid is a success.
		if (rec.status === 'paid') {
			return json({ success: true, paidAt: rec.paidAt });
		}

		if (rec.receiveRequestId !== receiveRequestId) {
			return json({ error: 'receiveRequestId does not match' }, { status: 403 });
		}

		const receives = await getReceiveRequestReceives(receiveRequestId, platform);
		const completed = receives.find((r) => r.state === 'COMPLETED');
		if (!completed) {
			return json({ error: 'Payment not yet completed', paid: false }, { status: 402 });
		}

		const updated = await markExportPaid(kv, exportId);
		return json({ success: true, paidAt: updated?.paidAt ?? Date.now() });
	} catch (error: any) {
		console.error('[cookbook-export verify] error:', error);
		return json({ error: error.message || 'Failed to verify payment' }, { status: 500 });
	}
};
