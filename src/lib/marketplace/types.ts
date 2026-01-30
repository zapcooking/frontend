/**
 * Marketplace Types
 * Using NIP-99 Classified Listings (kind 30402) for product events
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';

// NIP-99 Classified Listings kind
export const PRODUCT_KIND = 30402;
// Legacy kind for backwards compatibility
export const PRODUCT_KIND_LEGACY = 30018;

export const PRODUCT_CATEGORIES = [
	'ingredients',
	'tools',
	'knowledge',
	'merch'
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
	ingredients: 'Ingredients',
	tools: 'Tools & Gear',
	knowledge: 'Knowledge',
	merch: 'Merch'
};

export const CATEGORY_EMOJIS: Record<ProductCategory, string> = {
	ingredients: '🌶️',
	tools: '🔪',
	knowledge: '📚',
	merch: '🎁'
};

export type ProductStatus = 'active' | 'sold';

export interface Product {
	id: string; // d tag value
	pubkey: string;
	title: string;
	summary: string;
	description: string; // markdown content
	priceSats: number;
	images: string[];
	category: ProductCategory;
	status: ProductStatus;
	lightningAddress: string;
	requiresShipping: boolean;
	location?: string;
	publishedAt: number;
	createdAt: number;
	event: NDKEvent;
}

export interface ProductFormData {
	title: string;
	summary: string;
	description: string;
	priceSats: number;
	images: string[];
	category: ProductCategory;
	lightningAddress: string;
	requiresShipping: boolean;
	location?: string;
}

/**
 * Validate a Lightning address format
 * Accepts: user@domain.com or LNURL format
 */
export function isValidLightningAddress(address: string): boolean {
	if (!address) return false;

	// Lightning address format: user@domain.com
	const lnAddressRegex = /^[\w.-]+@[\w.-]+\.\w+$/;
	if (lnAddressRegex.test(address)) return true;

	// LNURL format (bech32)
	const lnurlRegex = /^(lnurl|LNURL)[0-9a-z]+$/i;
	if (lnurlRegex.test(address)) return true;

	return false;
}
