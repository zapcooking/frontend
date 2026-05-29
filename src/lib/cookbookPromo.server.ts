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
import {
	applyPromoMath,
	scopeAllows,
	type PromoApplied,
	type PromoScope
} from '$lib/cookbookPricing';
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
			scope: 'cookbook',
			note: 'launch promo: 50% off cookbook export'
		},
		FREEPACK: {
			percentOff: 100,
			flatOff: 0,
			scope: 'cookbook',
			note: '100% off — free cookbook export (limited use)'
		}
	}
};

export interface PromoLookup {
	ok: boolean;
	/**
	 * `wrong_scope` — code exists but isn't valid for the requested surface.
	 * `invalid_for_scope` — code's discount shape isn't permitted for the
	 *   requested surface (membership/genesis are percent-only and capped
	 *   below 100%, so every activation stays behind a verified payment).
	 */
	error?: 'unknown_code' | 'expired' | 'disabled' | 'wrong_scope' | 'invalid_for_scope';
	applied?: PromoApplied;
}

function isFlagOn(raw: string | undefined): boolean {
	const flag = (raw || '').trim().toLowerCase();
	return flag === '1' || flag === 'true' || flag === 'yes';
}

/** Generic break-glass: disables promos on EVERY scope. */
function genericKillSwitch(): boolean {
	return isFlagOn(env.PROMOS_DISABLED);
}

/** Legacy cookbook-only break-glass, kept for back-compat. */
function cookbookKillSwitch(): boolean {
	return isFlagOn(env.COOKBOOK_PROMOS_DISABLED);
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
 * Validate a user-submitted code against the resolved config, for a
 * specific surface (`scope`).
 *
 * Async because KV is the source of truth. Callers (the public
 * apply-promo + create-invoice endpoints) pass through `platform.env`'s
 * `GATED_CONTENT` binding.
 *
 * Unit-agnostic on `baseAmount`: cookbook passes sats, membership/genesis
 * pass USD cents (see `applyPromoMath`). The validation here only gates
 * *which* code may apply; the caller owns the units and downstream
 * conversion.
 */
export async function applyPromo(
	kv: PromoKV,
	rawCode: string,
	baseAmount: number,
	scope: PromoScope
): Promise<PromoLookup> {
	// Generic break-glass disables every scope; the legacy cookbook
	// switch additionally disables the cookbook scope.
	if (genericKillSwitch()) return { ok: false, error: 'disabled' };
	if (scope === 'cookbook' && cookbookKillSwitch()) return { ok: false, error: 'disabled' };

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

	// Scope gate — a code only applies to its surface (legacy codes with
	// no scope default to 'all', which covers cookbook + membership but
	// never genesis).
	if (!scopeAllows(cfg.scope, scope)) {
		return { ok: false, error: 'wrong_scope' };
	}

	// Membership + genesis are percent-only and capped below 100%, so a
	// paid Strike receive always gates activation (no free-grant path in
	// v1). flatOff is sats-denominated and meaningless against USD cents,
	// so it's rejected outright on these scopes too. Defence-in-depth:
	// the admin upsert endpoint enforces the same rules at write time.
	if (scope === 'membership' || scope === 'genesis') {
		if (cfg.flatOff > 0 || cfg.percentOff >= 100) {
			return { ok: false, error: 'invalid_for_scope' };
		}
	}

	const applied = applyPromoMath(baseAmount, cfg.percentOff, cfg.flatOff, code);
	return { ok: true, applied };
}

/** Sentinel value used by create-invoice to bypass Strike for free codes. */
export function isFreePromoApplied(applied: PromoApplied | null | undefined): boolean {
	return !!applied && applied.free;
}
