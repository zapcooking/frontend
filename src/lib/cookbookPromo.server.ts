/**
 * Cookbook export promo codes — server-side only.
 *
 * V1 lives as a static config map in this file. There's no admin UI
 * yet; rotating codes means a code change + redeploy. That's fine for
 * launch usage; the goal is to have the *enforcement* path validated
 * server-side so the client can never just claim a promo it didn't
 * earn.
 *
 * TODO(promo-admin): replace the static config with a KV-backed store
 * + admin endpoints once we want non-engineers to manage codes.
 */

import { applyPromoMath, type PromoApplied } from '$lib/cookbookPricing';

interface PromoConfig {
	/** Percent discount, 0-100. */
	percentOff: number;
	/** Flat sat discount applied AFTER the percent. */
	flatOff: number;
	/** Optional sunset; codes don't auto-expire if undefined. */
	expiresAt?: number; // unix ms
	/** Optional human-readable note for logs. */
	note?: string;
}

const PROMO_CONFIG: Record<string, PromoConfig> = {
	LAUNCH: {
		percentOff: 50,
		flatOff: 0,
		note: 'launch promo: 50% off cookbook export'
	},
	FREEPACK: {
		percentOff: 100,
		flatOff: 0,
		note: '100% off — free cookbook export (limited use)'
	}
};

export interface PromoLookup {
	ok: boolean;
	error?: 'unknown_code' | 'expired';
	applied?: PromoApplied;
}

export function applyPromo(rawCode: string, baseSats: number): PromoLookup {
	const code = String(rawCode || '')
		.trim()
		.toUpperCase();
	if (!code) return { ok: false, error: 'unknown_code' };

	const cfg = PROMO_CONFIG[code];
	if (!cfg) return { ok: false, error: 'unknown_code' };
	if (cfg.expiresAt && Date.now() > cfg.expiresAt) {
		return { ok: false, error: 'expired' };
	}
	const applied = applyPromoMath(baseSats, cfg.percentOff, cfg.flatOff, code);
	return { ok: true, applied };
}

/** Sentinel value used by create-invoice to bypass Strike for free codes. */
export function isFreePromoApplied(applied: PromoApplied | null | undefined): boolean {
	return !!applied && applied.free;
}
