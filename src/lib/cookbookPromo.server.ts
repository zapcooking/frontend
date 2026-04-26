/**
 * Cookbook export promo codes — server-side validation.
 *
 * Source of truth: the KV-backed `cookbookPromoStore.server.ts`. When
 * KV is empty (first deploy, or never written by an admin) we fall
 * back to `DEFAULT_PROMO_CONFIG` below so the system keeps working
 * without an explicit migration. Once the admin saves any change via
 * `/admin/promos`, KV becomes the single source of truth.
 *
 * Override hierarchy (most aggressive first):
 *   1. env COOKBOOK_PROMOS_DISABLED=true   — break-glass, ignores KV
 *   2. KV `enabled: false`                 — soft disable from admin UI
 *   3. KV `codes` map                      — admin-curated codes
 *   4. DEFAULT_PROMO_CONFIG (this file)    — fallback for empty KV
 *
 * The goal is that the enforcement path is server-side so the client
 * can never claim a promo it didn't earn. The admin UI changes the
 * source data; the validation path is identical for both KV and
 * default-backed entries.
 */

import { env } from '$env/dynamic/private';
import { applyPromoMath, type PromoApplied } from '$lib/cookbookPricing';
import {
	loadPromoConfig,
	type PromoConfigState,
	type PromoEntry,
	type PromoKV
} from '$lib/cookbookPromoStore.server';

/**
 * Hardcoded default config — used when KV is empty. Admin writes via
 * /admin/promos persist to KV and override these. Editing this map
 * also re-seeds for any deployment whose KV happens to be empty.
 */
export const DEFAULT_PROMO_CONFIG: PromoConfigState = {
	enabled: true,
	codes: {
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
	}
};

export interface PromoLookup {
	ok: boolean;
	error?: 'unknown_code' | 'expired' | 'disabled';
	applied?: PromoApplied;
}

function envKillSwitch(): boolean {
	const flag = (env.COOKBOOK_PROMOS_DISABLED || '').trim().toLowerCase();
	return flag === '1' || flag === 'true' || flag === 'yes';
}

/**
 * Resolve the effective config: KV override if present, otherwise the
 * hardcoded defaults. Exposed so the admin endpoint can render a
 * "current state" snapshot without re-implementing the precedence.
 */
export async function resolvePromoConfig(kv: PromoKV): Promise<PromoConfigState> {
	const stored = await loadPromoConfig(kv);
	return stored ?? DEFAULT_PROMO_CONFIG;
}

/**
 * Validate a user-submitted code against the resolved config.
 *
 * Async because KV is the source of truth. Callers (the public
 * apply-promo + create-invoice endpoints) pass through `platform.env`'s
 * `GATED_CONTENT` binding.
 */
export async function applyPromo(
	kv: PromoKV,
	rawCode: string,
	baseSats: number
): Promise<PromoLookup> {
	// Break-glass env override wins over everything else.
	if (envKillSwitch()) return { ok: false, error: 'disabled' };

	const config = await resolvePromoConfig(kv);
	if (!config.enabled) return { ok: false, error: 'disabled' };

	const code = String(rawCode || '')
		.trim()
		.toUpperCase();
	if (!code) return { ok: false, error: 'unknown_code' };

	const cfg: PromoEntry | undefined = config.codes[code];
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
