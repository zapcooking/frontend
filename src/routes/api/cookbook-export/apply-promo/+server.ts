/**
 * POST /api/cookbook-export/apply-promo
 *
 * Validates a promo code against the server-side config and returns
 * the resulting price for the cookbook export. The client uses the
 * response to update its CTA label; the actual price gate still
 * lives in /api/cookbook-export/create-invoice (which re-validates
 * the code), so a tampered client can't claim a free unlock.
 *
 * Body:
 *   { code: string }
 *
 * Returns:
 *   200 { success: true, finalSats, originalSats, discountSats, free, label, code }
 *   200 { success: false, error: 'unknown_code' | 'expired' }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { COOKBOOK_EXPORT_SATS } from '$lib/cookbookPricing';
import { applyPromo } from '$lib/cookbookPromo.server';

export const POST: RequestHandler = async ({ request }) => {
	let body: { code?: string };
	try {
		body = (await request.json()) as { code?: string };
	} catch {
		return json({ success: false, error: 'unknown_code' });
	}

	const result = applyPromo(body?.code || '', COOKBOOK_EXPORT_SATS);
	if (!result.ok || !result.applied) {
		return json({ success: false, error: result.error || 'unknown_code' });
	}

	const a = result.applied;
	return json({
		success: true,
		code: a.code,
		originalSats: a.originalSats,
		discountSats: a.discountSats,
		finalSats: a.finalSats,
		free: a.free,
		label: a.label
	});
};
