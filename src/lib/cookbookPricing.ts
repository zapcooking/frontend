/**
 * Cookbook export pricing — shared by client UI and server endpoints
 * so labels, invoice amounts, and promo math all stay in lockstep.
 */

export const COOKBOOK_EXPORT_SATS = 2100;

/**
 * Surfaces a promo code can apply to. The engine is scope-aware so a
 * single KV-backed code list can serve every checkout without one
 * surface's codes leaking into another.
 *
 * `'all'` is a convenience meaning "the general-purpose surfaces" —
 * deliberately **cookbook + membership only**. It does NOT cover
 * `'genesis'` (a lifetime founder discount must be opted into with an
 * explicit `'genesis'` code) and does NOT cover `'sponsor'` (not yet a
 * live surface). See `scopeAllows`.
 */
export type PromoScope = 'cookbook' | 'membership' | 'sponsor' | 'genesis' | 'all';

/** Surfaces that a `scope: 'all'` code is valid for. */
export const ALL_SCOPE_COVERS: readonly PromoScope[] = ['cookbook', 'membership'];

/**
 * Pure scope-match check. A code's stored scope (default `'all'` for
 * legacy entries) is valid for `requested` when it matches exactly, or
 * when it's `'all'` and `requested` is one of the general surfaces.
 * Client- and server-safe (no I/O).
 */
export function scopeAllows(entryScope: PromoScope | undefined, requested: PromoScope): boolean {
	const scope: PromoScope = entryScope ?? 'all';
	if (scope === requested) return true;
	if (scope === 'all') return ALL_SCOPE_COVERS.includes(requested);
	return false;
}

export interface PromoApplied {
	code: string; // canonicalized (uppercase)
	originalSats: number;
	discountSats: number;
	finalSats: number;
	free: boolean;
	label: string; // "50% off", "Free", "1000 sats off"
}

/**
 * Apply a promo to a base price.
 * Pure / sync / no I/O — safe on both client and server.
 *
 * Unit-agnostic: `baseSats` is just "the base amount" — cookbook passes
 * sats, membership/genesis pass USD **cents** (so the integer rounding
 * below stays exact). `flatOff` shares whatever unit the caller uses.
 * Membership/genesis codes are percent-only (see `applyPromo`), so the
 * sats-flavoured `flatOff` label branch never fires for them.
 *
 * Server **must** still validate the code via `getPromoConfig` before
 * trusting it, since this helper is happy to apply any percentage.
 */
export function applyPromoMath(
	baseSats: number,
	percentOff: number,
	flatOff: number,
	code: string
): PromoApplied {
	const discountSats = Math.min(
		baseSats,
		Math.round((baseSats * percentOff) / 100) + flatOff
	);
	const finalSats = Math.max(0, baseSats - discountSats);
	const free = finalSats === 0;
	let label: string;
	if (free) {
		label = 'Free';
	} else if (percentOff > 0 && flatOff === 0) {
		label = `${percentOff}% off`;
	} else if (flatOff > 0 && percentOff === 0) {
		label = `${flatOff} sats off`;
	} else {
		label = `${baseSats - finalSats} sats off`;
	}
	return {
		code: code.toUpperCase(),
		originalSats: baseSats,
		discountSats,
		finalSats,
		free,
		label
	};
}
