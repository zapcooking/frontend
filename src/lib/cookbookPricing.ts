/**
 * Cookbook export pricing — shared by client UI and server endpoints
 * so labels, invoice amounts, and promo math all stay in lockstep.
 */

export const COOKBOOK_EXPORT_SATS = 2100;

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
