/**
 * POST /api/membership/apply-promo
 *
 * Preview a promo code against a membership / founders price WITHOUT
 * creating an invoice. Mirrors /api/cookbook-export/apply-promo: the
 * client uses the response to show the discounted price + label inline,
 * but the authoritative price is still set server-side in the relevant
 * create-lightning-invoice endpoint (which re-validates the code). A
 * tampered client therefore can't self-grant a discount.
 *
 * Body:
 *   { code: string, tier: 'cook' | 'pro' | 'founders', period?: 'annual' | 'monthly' | 'lifetime' }
 *
 * Returns:
 *   200 { success: true, code, label, scope, originalUsd, finalUsd }
 *   200 { success: false, error: 'unknown_code' | 'expired' | 'disabled' | 'wrong_scope' | 'invalid_for_scope' }
 *
 * Promo math runs in integer USD cents (exact rounding) and is returned
 * as dollars. The 5% Bitcoin discount is NOT applied here — this previews
 * the promo-adjusted LIST price; the BTC discount + sat conversion happen
 * at invoice time.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { applyPromo, type PromoScope } from '$lib/promoEngine.server';

// Canonical membership list prices (USD). Mirrors the values in
// bitcoin-price-quote + the create-lightning-invoice endpoints; those
// remain the source of truth for the charged amount.
const PRICING_USD = {
	cook: { annual: 49, monthly: 4.99 },
	pro: { annual: 89, monthly: 8.99 },
	founders: { lifetime: 210 }
} as const;

export const POST: RequestHandler = async ({ request, platform }) => {
	// Mirror the membership feature-flag guard used by the sibling endpoints.
	const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
	if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	let body: { code?: string; tier?: string; period?: string };
	try {
		body = (await request.json()) as { code?: string; tier?: string; period?: string };
	} catch {
		return json({ success: false, error: 'unknown_code' });
	}

	const tier = body?.tier;
	const period = body?.period ?? (tier === 'founders' ? 'lifetime' : 'annual');

	// Resolve the list USD price + scope for the requested surface.
	let baseUsd: number | undefined;
	let scope: PromoScope;
	if (tier === 'founders') {
		baseUsd = PRICING_USD.founders.lifetime;
		scope = 'genesis';
	} else if (tier === 'cook' || tier === 'pro') {
		const tierPricing = PRICING_USD[tier];
		baseUsd = tierPricing[period as keyof typeof tierPricing];
		scope = 'membership';
	} else {
		return json({ error: 'Invalid tier' }, { status: 400 });
	}
	if (typeof baseUsd !== 'number') {
		return json({ error: 'Invalid period' }, { status: 400 });
	}

	const kv = platform?.env?.GATED_CONTENT ?? null;
	const result = await applyPromo(kv, body?.code || '', Math.round(baseUsd * 100), scope);
	if (!result.ok || !result.applied) {
		return json({ success: false, error: result.error || 'unknown_code' });
	}

	const a = result.applied;
	return json({
		success: true,
		code: a.code,
		label: a.label,
		scope,
		originalUsd: a.originalSats / 100, // field name is unit-agnostic; values are cents
		finalUsd: parseFloat((a.finalSats / 100).toFixed(2))
	});
};
