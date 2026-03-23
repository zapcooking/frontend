/**
 * Marketplace Types
 * Using NIP-99 Classified Listings (kind 30402) for product events
 * Using NIP-15 Stalls (kind 30017) for kitchen/storefront events
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { MembershipTier } from '$lib/membershipStore';
import type { CommerceState } from './commerceState';
import type { CurrencyCode } from '$lib/currencyStore';

// Maximum age for marketplace listings (in days). Listings older than this are hidden.
export const MARKETPLACE_LISTING_MAX_AGE_DAYS = 180;

// Minimum days between relisting the same product.
export const RELIST_COOLDOWN_DAYS = 7;

// NIP-99 Classified Listings kind
export const PRODUCT_KIND = 30402;
// Legacy kind for backwards compatibility
export const PRODUCT_KIND_LEGACY = 30018;
// NIP-15 Stall kind (used for Kitchen storefronts)
export const STALL_KIND = 30017;

export const PRODUCT_CATEGORIES = [
	'bitcoin',
	'art',
	'clothing',
	'food',
	'kitchen',
	'books',
	'technology',
	'digital',
	'handmade',
	'health',
	'services',
	'merch',
	'other'
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
	bitcoin: 'Bitcoin',
	art: 'Art',
	clothing: 'Clothing',
	food: 'Food & Drink',
	kitchen: 'Kitchen & Home',
	books: 'Books & Education',
	technology: 'Technology',
	digital: 'Digital Goods',
	handmade: 'Handmade',
	health: 'Health & Beauty',
	services: 'Services',
	merch: 'Merch',
	other: 'Other'
};

export const CATEGORY_EMOJIS: Record<ProductCategory, string> = {
	bitcoin: '₿',
	art: '🎨',
	clothing: '👕',
	food: '🍽️',
	kitchen: '🔪',
	books: '📚',
	technology: '💻',
	digital: '💾',
	handmade: '🧶',
	health: '🌿',
	services: '🛠️',
	merch: '🎁',
	other: '📦'
};

/**
 * Map legacy category tag values to their modern equivalents.
 * Existing products with old tags will be normalized on parse.
 */
export const LEGACY_CATEGORY_MAP: Record<string, ProductCategory> = {
	ingredients: 'food',
	tools: 'kitchen',
	knowledge: 'books'
};

/** Normalize a category tag value, mapping legacy values to modern ones. */
export function normalizeCategory(raw: string): ProductCategory {
	const lower = raw.toLowerCase();
	if (LEGACY_CATEGORY_MAP[lower]) return LEGACY_CATEGORY_MAP[lower];
	if (PRODUCT_CATEGORIES.includes(lower as ProductCategory)) return lower as ProductCategory;
	return 'other';
}

export type ProductStatus = 'active' | 'sold';

export interface Product {
	id: string; // d tag value
	pubkey: string;
	title: string;
	summary: string;
	description: string; // markdown content
	price: number; // Source-of-truth price in native currency
	currency: CurrencyCode; // Native/original currency code (e.g. 'USD', 'EUR', 'SATS')
	priceSats: number; // Derived: equals price when currency is SATS, otherwise 0 (needs async conversion)
	images: string[];
	category: ProductCategory;
	status: ProductStatus;
	lightningAddress: string;
	requiresShipping: boolean;
	location?: string;
	commerceState?: CommerceState;
	publishedAt: number;
	createdAt: number;
	event: NDKEvent;
}

export interface ProductFormData {
	title: string;
	summary: string;
	description: string;
	price: number; // Price in native currency
	currency: CurrencyCode; // Native currency code
	images: string[];
	category: ProductCategory;
	lightningAddress: string;
	requiresShipping: boolean;
	location?: string;
	commerceState?: CommerceState;
}

// Kitchen / Storefront types (NIP-15 stall)

export interface Kitchen {
	id: string; // d tag value
	pubkey: string; // owner hex pubkey
	name: string;
	description: string;
	banner?: string;
	avatar?: string;
	location?: string;
	lightningAddress?: string;
	defaultCurrency?: CurrencyCode; // Default currency for new products in this store
	productCount?: number; // computed client-side
	trustRank?: number; // NIP-85 trust score 0-100 (computed)
	memberTier?: MembershipTier; // zap.cooking membership tier
	createdAt: number;
	event: NDKEvent;
}

export interface KitchenFormData {
	name: string;
	description: string;
	banner?: string;
	avatar?: string;
	location?: string;
	lightningAddress?: string;
	defaultCurrency?: CurrencyCode; // Default currency for new products
}

// Implicit kitchen = seller with products but no stall event (derived from kind:0)
export interface ImplicitKitchen {
	pubkey: string;
	name: string;
	description: string;
	banner?: string;
	avatar?: string;
	location?: string;
	lightningAddress?: string;
	defaultCurrency?: CurrencyCode;
	productCount: number;
	trustRank?: number; // NIP-85 trust score 0-100 (computed)
	memberTier?: MembershipTier; // zap.cooking membership tier
	isImplicit: true;
}

export type KitchenDisplay = (Kitchen & { isImplicit?: false }) | ImplicitKitchen;

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
