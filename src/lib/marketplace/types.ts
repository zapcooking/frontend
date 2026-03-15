/**
 * Marketplace Types
 * Using NIP-99 Classified Listings (kind 30402) for product events
 * Using NIP-15 Stalls (kind 30017) for kitchen/storefront events
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { MembershipTier } from '$lib/membershipStore';

// Maximum age for marketplace listings (in days). Listings older than this are hidden.
export const MARKETPLACE_LISTING_MAX_AGE_DAYS = 180;

// NIP-99 Classified Listings kind
export const PRODUCT_KIND = 30402;
// Legacy kind for backwards compatibility
export const PRODUCT_KIND_LEGACY = 30018;
// NIP-15 Stall kind (used for Kitchen storefronts)
export const STALL_KIND = 30017;

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
