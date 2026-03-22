/**
 * Commerce State System
 *
 * Defines the possible purchase states for marketplace listings.
 * Only shows a numeric sats price when instant checkout is actually available.
 * All other states use descriptive labels to set clear buyer expectations.
 *
 * Why this improves trust and conversion:
 * - Showing a fixed sats price on every listing (even when instant checkout isn't
 *   available) trains users to distrust the price display. A buyer who clicks
 *   "Pay 14 sats" and then learns they need to message the seller first feels
 *   misled. That friction kills repeat visits.
 * - Clear commerce states let buyers self-select: instant-buy users see a price
 *   and pay immediately; custom-order users know to message first. Both paths
 *   feel intentional, not broken.
 * - Specific shipping language ("Shipping calculated at checkout" vs. the vague
 *   "Requires shipping") reduces pre-purchase anxiety.
 *
 * Default fallback:
 * If a seller has not configured pricing correctly (e.g., priceSats is 0, no
 * lightning address, or missing checkout info), the system falls back to
 * `message_to_order`. This is the safest default because it never promises
 * instant checkout that doesn't exist, and it always gives the buyer a clear
 * next step.
 *
 * Edge cases to account for:
 * - Seller has a lightning address but price is 0 → message_to_order
 * - Seller has a price but no lightning address → message_to_order
 * - Product with variants/sizes where base price differs → starting_at
 * - Digital products (requiresShipping=false) → can be any state; shipping
 *   text is replaced with "Instant delivery"
 * - Sold/inactive products → commerce state is moot; show "Sold" badge instead
 * - External store links (Shopify, etc.) → external_checkout
 */

import type { Product } from './types';

// ── Commerce State Enum ─────────────────────────────────────────────

export const COMMERCE_STATES = [
	'instant_buy',
	'starting_at',
	'price_varies',
	'message_to_order',
	'custom_quote',
	'external_checkout'
] as const;

export type CommerceState = (typeof COMMERCE_STATES)[number];

// ── Per-State Display Configuration ─────────────────────────────────

export interface CommerceStateConfig {
	/** Top label shown where the price used to be */
	label: string | ((priceSats: number) => string);
	/** Whether to display a numeric sats amount in the label */
	showPrice: boolean;
	/** Optional supporting subtext beneath the label */
	subtext?: string;
	/** Primary call-to-action button text */
	primaryCta: string;
	/** Optional secondary CTA (e.g., "Message seller" alongside "Pay now") */
	secondaryCta?: string;
	/** Whether to show shipping info inline */
	showShipping: boolean;
	/** Accent color class for the state badge */
	accentClass: string;
}

export const COMMERCE_STATE_CONFIG: Record<CommerceState, CommerceStateConfig> = {
	instant_buy: {
		label: (sats: number) => `${sats.toLocaleString()} sats`,
		showPrice: true,
		subtext: 'Shipping calculated at checkout',
		primaryCta: 'Pay now',
		secondaryCta: 'Message seller',
		showShipping: true,
		accentClass: 'text-orange-500'
	},
	starting_at: {
		label: (sats: number) => `From ${sats.toLocaleString()} sats`,
		showPrice: true,
		subtext: 'Final price depends on options',
		primaryCta: 'Choose options',
		showShipping: true,
		accentClass: 'text-orange-400'
	},
	price_varies: {
		label: 'Price varies',
		showPrice: false,
		subtext: 'Seller sets price based on your request',
		primaryCta: 'Message seller',
		showShipping: false,
		accentClass: 'text-amber-400'
	},
	message_to_order: {
		label: 'Message to order',
		showPrice: false,
		subtext: 'Shipping and availability confirmed by seller',
		primaryCta: 'Message seller',
		showShipping: false,
		accentClass: 'text-blue-400'
	},
	custom_quote: {
		label: 'Custom quote',
		showPrice: false,
		subtext: 'Seller will provide a personalized price',
		primaryCta: 'Request quote',
		showShipping: false,
		accentClass: 'text-violet-400'
	},
	external_checkout: {
		label: 'External checkout',
		showPrice: false,
		subtext: 'Purchase on the seller\u2019s website',
		primaryCta: 'View product',
		showShipping: false,
		accentClass: 'text-sky-400'
	}
};

// ── Helpers ─────────────────────────────────────────────────────────

/** Get the resolved label string for a commerce state + price */
export function getCommerceLabel(state: CommerceState, priceSats: number): string {
	const cfg = COMMERCE_STATE_CONFIG[state];
	return typeof cfg.label === 'function' ? cfg.label(priceSats) : cfg.label;
}

/** Get the full config for a commerce state */
export function getCommerceConfig(state: CommerceState): CommerceStateConfig {
	return COMMERCE_STATE_CONFIG[state];
}

/**
 * Resolve the commerce state for a product.
 *
 * If the product carries an explicit `commerceState` tag, use it — but only
 * when the product satisfies the invariants for that state. For example,
 * `instant_buy` requires both a price and a lightning address; if either is
 * missing the explicit tag is ignored and the state is inferred instead.
 *
 * Inference rules:
 *   - Has lightning address + price > 0 → instant_buy
 *   - Has price > 0 but no lightning address → message_to_order
 *   - Price is 0 → message_to_order (safest fallback)
 */
export function resolveCommerceState(product: Product): CommerceState {
	const hasPrice = product.priceSats > 0;
	const hasLightning = !!product.lightningAddress;

	// Explicit tag wins, but only when its invariants are met
	if (product.commerceState && COMMERCE_STATES.includes(product.commerceState)) {
		if (product.commerceState === 'instant_buy') {
			// Only honor instant_buy when checkout is actually possible
			if (hasPrice && hasLightning) {
				return 'instant_buy';
			}
			// Fall through to inferred state
		} else {
			return product.commerceState;
		}
	}

	// Infer from available data
	if (hasPrice && hasLightning) {
		return 'instant_buy';
	}

	// Fallback: always safe, never misleading
	return 'message_to_order';
}

/**
 * Get contextual shipping text based on product data.
 * Replaces the generic "Requires shipping" with specific copy.
 */
export function getShippingText(product: Product): string {
	if (!product.requiresShipping) {
		return 'Instant delivery';
	}
	if (product.location) {
		return `Ships from ${product.location}`;
	}
	return 'Shipping calculated separately';
}

/**
 * Whether a given commerce state supports instant payment flow.
 */
export function isInstantCheckout(state: CommerceState): boolean {
	return state === 'instant_buy';
}

/**
 * Whether a given commerce state's primary CTA opens the DM form.
 */
export function isMessageFlow(state: CommerceState): boolean {
	return state === 'message_to_order' || state === 'price_varies' || state === 'custom_quote';
}
