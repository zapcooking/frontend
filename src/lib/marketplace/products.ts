/**
 * Marketplace Products Library
 * Functions to create, fetch, and parse product events (NIP-99 kind 30402)
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent, NDKRelaySet, type NDKFilter } from '@nostr-dev-kit/ndk';
import { browser } from '$app/environment';
import {
	PRODUCT_KIND,
	PRODUCT_KIND_LEGACY,
	PRODUCT_CATEGORIES,
	MARKETPLACE_LISTING_MAX_AGE_DAYS,
	RELIST_COOLDOWN_DAYS,
	type Product,
	type ProductCategory,
	type ProductFormData,
	type ProductStatus
} from './types';
import { addClientTagToEvent } from '$lib/nip89';

// Relays that index marketplace events
export const MARKETPLACE_RELAYS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band'
];

// --- In-memory cache for product listings ---
const PRODUCT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const productCache = new Map<string, { data: Product[]; staleCount: number; timestamp: number }>();

function getProductCacheKey(options: { category?: ProductCategory; author?: string }): string {
	return `${options.author || 'all'}:${options.category || 'all'}`;
}

/** Clear the product cache (call after publishing/deleting a product) */
export function invalidateProductCache(): void {
	productCache.clear();
}

/** Compute the Unix-second cutoff for stale listings */
function getListingAgeCutoff(): number {
	return Math.floor(Date.now() / 1000) - 60 * 60 * 24 * MARKETPLACE_LISTING_MAX_AGE_DAYS;
}

/**
 * Filter out listings whose created_at is older than MARKETPLACE_LISTING_MAX_AGE_DAYS.
 * Returns the filtered list and the count of removed stale items.
 */
export function filterStaleListings(products: Product[]): { fresh: Product[]; staleCount: number } {
	const cutoff = getListingAgeCutoff();
	const fresh: Product[] = [];
	let staleCount = 0;
	for (const p of products) {
		if (p.createdAt < cutoff) {
			staleCount++;
		} else {
			fresh.push(p);
		}
	}
	return { fresh, staleCount };
}

/**
 * Fetch products and return both the filtered results and how many stale
 * listings were hidden. Reads stale count from the per-key cache entry
 * populated by fetchProducts().
 */
export async function fetchProductsWithStaleCount(
	ndk: NDK,
	options: Parameters<typeof fetchProducts>[1] = {}
): Promise<{ products: Product[]; staleCount: number }> {
	const products = await fetchProducts(ndk, options);
	const cacheKey = getProductCacheKey(options);
	const cached = productCache.get(cacheKey);
	return { products, staleCount: cached?.staleCount ?? 0 };
}

/**
 * Parse an NDKEvent into a Product object
 */
export function parseProductEvent(event: NDKEvent): Product | null {
	try {
		const getTag = (name: string): string | undefined =>
			event.tags.find((t) => t[0] === name)?.[1];

		const id = getTag('d');
		if (!id) return null;

		const title = getTag('title') || '';
		const summary = getTag('summary') || '';
		const priceTag = event.tags.find((t) => t[0] === 'price');
		const priceSats = priceTag ? parseInt(priceTag[1], 10) : 0;

		// Get all image tags
		const images = event.tags.filter((t) => t[0] === 'image').map((t) => t[1]);

		// Category from 't' tag
		const categoryTag = getTag('t');
		const category: ProductCategory = PRODUCT_CATEGORIES.includes(
			categoryTag as ProductCategory
		)
			? (categoryTag as ProductCategory)
			: 'ingredients';

		const status: ProductStatus = (getTag('status') as ProductStatus) || 'active';
		const lightningAddress = getTag('lightning') || '';
		const shippingTag = getTag('shipping');
		const requiresShipping = shippingTag !== 'false'; // Default to true if not specified
		const location = getTag('location');
		const publishedAt = parseInt(getTag('published_at') || '0', 10);

		return {
			id,
			pubkey: event.pubkey,
			title,
			summary,
			description: event.content,
			priceSats,
			images,
			category,
			status,
			lightningAddress,
			requiresShipping,
			location,
			publishedAt: publishedAt || event.created_at || 0,
			createdAt: event.created_at || 0,
			event
		};
	} catch (error) {
		console.error('[Marketplace] Failed to parse product event:', error);
		return null;
	}
}

/**
 * Create a product event from form data
 */
export function createProductEvent(
	ndk: NDK,
	data: ProductFormData,
	existingId?: string
): NDKEvent {
	const event = new NDKEvent(ndk);
	event.kind = PRODUCT_KIND;
	event.content = data.description;

	// Use existing ID for updates, or generate new one
	const productId = existingId || crypto.randomUUID();

	event.tags = [
		['d', productId],
		['title', data.title],
		['summary', data.summary],
		['price', data.priceSats.toString(), 'SAT'],
		['t', data.category],
		['published_at', Math.floor(Date.now() / 1000).toString()],
		['lightning', data.lightningAddress],
		['shipping', data.requiresShipping ? 'true' : 'false'],
		['status', 'active']
	];

	// Add image tags
	for (const imageUrl of data.images) {
		if (imageUrl) {
			event.tags.push(['image', imageUrl]);
		}
	}

	// Add optional location
	if (data.location) {
		event.tags.push(['location', data.location]);
	}

	// Add client tag (NIP-89)
	addClientTagToEvent(event);

	return event;
}

/**
 * Fetch all products from relays
 * Fetches both NIP-99 kind 30402 and legacy kind 30018 for backwards compatibility
 * 
 * Note: Parameterized replaceable events (30xxx) often require author filter on most relays.
 * For public marketplace, we use relays that support kind-based queries.
 */
export async function fetchProducts(
	ndk: NDK,
	options: {
		category?: ProductCategory;
		author?: string;
		limit?: number;
		timeoutMs?: number;
	} = {}
): Promise<Product[]> {
	// Check cache first
	const cacheKey = getProductCacheKey(options);
	const cached = productCache.get(cacheKey);
	if (cached && Date.now() - cached.timestamp < PRODUCT_CACHE_TTL_MS) {
		return cached.data;
	}

	// Fetch both standard NIP-99 kind and legacy kind
	const filter: NDKFilter = {
		kinds: [PRODUCT_KIND, PRODUCT_KIND_LEGACY] as number[],
		limit: options.limit || 100
	};

	if (options.author) {
		filter.authors = [options.author];
	}

	if (options.category) {
		filter['#t'] = [options.category];
	}

	const timeoutMs = options.timeoutMs || 6000;

	// Wait briefly if no relays are connected yet
	const connectedRelays = ndk.pool?.relays ?
		Array.from(ndk.pool.relays.values()).filter(r => r.status === 1).length : 0;

	if (connectedRelays === 0) {
		await new Promise(resolve => setTimeout(resolve, 2000));
	}

	try {
		// Use marketplace relays for all product queries
		let relaySet: NDKRelaySet | undefined;
		try {
			relaySet = NDKRelaySet.fromRelayUrls(MARKETPLACE_RELAYS, ndk);
		} catch (e) {
			console.warn('[Marketplace] Could not create relay set:', e);
		}

		// Use subscription-based fetch for better relay compatibility
		const allEvents = new Set<any>();
		let timeoutId: ReturnType<typeof setTimeout>;

		const fetchPromise = new Promise<Set<any>>((resolve) => {
			const sub = ndk.subscribe(filter, { closeOnEose: true }, relaySet);

			sub.on('event', (event: any) => {
				allEvents.add(event);
			});

			sub.on('eose', () => {
				clearTimeout(timeoutId);
				resolve(allEvents);
			});

			sub.on('close', () => {
				clearTimeout(timeoutId);
				resolve(allEvents);
			});
		});

		const timeoutPromise = new Promise<Set<any>>((resolve) => {
			timeoutId = setTimeout(() => {
				console.warn('[Marketplace] Fetch timed out after', timeoutMs, 'ms, returning', allEvents.size, 'events');
				resolve(allEvents);
			}, timeoutMs);
		});

		const events = await Promise.race([fetchPromise, timeoutPromise]);

		const products: Product[] = [];

		// Deduplicate by d-tag + pubkey (parameterized replaceable events).
		// Keep the newest event when the same product appears from multiple relays.
		const seen = new Map<string, Product>();
		for (const event of events) {
			const product = parseProductEvent(event);
			if (product && product.status === 'active' && product.priceSats > 0 && product.images.length > 0) {
				const key = `${product.pubkey}:${product.id}`;
				const existing = seen.get(key);
				if (!existing || product.createdAt > existing.createdAt) {
					seen.set(key, product);
				}
			}
		}
		products.push(...seen.values());

		// Filter out stale listings older than MARKETPLACE_LISTING_MAX_AGE_DAYS
		const { fresh, staleCount } = filterStaleListings(products);

		// Sort by published date, newest first
		fresh.sort((a, b) => b.publishedAt - a.publishedAt);

		// Cache the result (including stale count for fetchProductsWithStaleCount)
		productCache.set(cacheKey, { data: fresh, staleCount, timestamp: Date.now() });

		return fresh;
	} catch (error) {
		console.error('[Marketplace] Failed to fetch products:', error);
		return [];
	}
}

/**
 * Fetch products by a specific seller
 */
export async function fetchSellerProducts(
	ndk: NDK,
	pubkey: string
): Promise<Product[]> {
	return fetchProducts(ndk, { author: pubkey });
}

/**
 * Publish a product event to relays
 * Also publishes to marketplace-specific relays for better discoverability
 */
export async function publishProduct(
	ndk: NDK,
	data: ProductFormData,
	existingId?: string
): Promise<{ success: boolean; event?: NDKEvent; error?: string }> {
	try {
		const event = createProductEvent(ndk, data, existingId);
		await event.sign();
		
		// Publish to default relays
		await event.publish();
		
		// Also publish to marketplace relays for discoverability
		try {
			const marketplaceRelaySet = NDKRelaySet.fromRelayUrls(MARKETPLACE_RELAYS, ndk);
			await event.publish(marketplaceRelaySet);
			console.log('[Marketplace] Published to marketplace relays:', MARKETPLACE_RELAYS);
		} catch (e) {
			console.warn('[Marketplace] Could not publish to marketplace relays:', e);
		}

		invalidateProductCache();
		return { success: true, event };
	} catch (error) {
		console.error('[Marketplace] Failed to publish product:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to publish product'
		};
	}
}

/**
 * Delete a product by publishing a deletion event (kind 5)
 * For parameterized replaceable events, we use the 'a' tag format
 */
export async function deleteProduct(
	ndk: NDK,
	product: Product
): Promise<{ success: boolean; error?: string }> {
	try {
		const event = new NDKEvent(ndk);
		event.kind = 5; // Deletion event
		event.content = 'Product deleted by owner';
		
		// Reference the product using 'a' tag for parameterized replaceable events
		// Format: <kind>:<pubkey>:<d-tag>
		event.tags = [
			['a', `${PRODUCT_KIND}:${product.pubkey}:${product.id}`],
			['k', PRODUCT_KIND.toString()]
		];
		
		// Also add 'a' tag for legacy kind if the original event used it
		if (product.event?.kind === PRODUCT_KIND_LEGACY) {
			event.tags.push(['a', `${PRODUCT_KIND_LEGACY}:${product.pubkey}:${product.id}`]);
			event.tags.push(['k', PRODUCT_KIND_LEGACY.toString()]);
		}
		
		await event.sign();
		await event.publish();
		
		// Also publish to marketplace relays
		try {
			const marketplaceRelaySet = NDKRelaySet.fromRelayUrls(MARKETPLACE_RELAYS, ndk);
			await event.publish(marketplaceRelaySet);
			console.log('[Marketplace] Deletion published to marketplace relays');
		} catch (e) {
			console.warn('[Marketplace] Could not publish deletion to marketplace relays:', e);
		}
		
		invalidateProductCache();
		return { success: true };
	} catch (error) {
		console.error('[Marketplace] Failed to delete product:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to delete product'
		};
	}
}

// --- Relist cooldown (localStorage) ---
const RELIST_STORAGE_KEY = 'zc_relist_cooldowns';

function getRelistCooldowns(): Record<string, number> {
	if (!browser) return {};
	try {
		return JSON.parse(localStorage.getItem(RELIST_STORAGE_KEY) || '{}');
	} catch {
		return {};
	}
}

function setRelistCooldown(productDTag: string): void {
	if (!browser) return;
	const cooldowns = getRelistCooldowns();
	cooldowns[productDTag] = Date.now();
	localStorage.setItem(RELIST_STORAGE_KEY, JSON.stringify(cooldowns));
}

/** Returns the remaining cooldown in ms, or 0 if relist is allowed. */
export function getRelistCooldownRemaining(productDTag: string): number {
	const cooldowns = getRelistCooldowns();
	const lastRelist = cooldowns[productDTag];
	if (!lastRelist) return 0;
	const cooldownMs = RELIST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
	const remaining = lastRelist + cooldownMs - Date.now();
	return Math.max(0, remaining);
}

/**
 * Relist a product: publish a fresh event with updated timestamps,
 * then delete the old event via NIP-09.
 */
export async function relistProduct(
	ndk: NDK,
	product: Product
): Promise<{ success: boolean; event?: NDKEvent; error?: string }> {
	// Check cooldown
	const remaining = getRelistCooldownRemaining(product.id);
	if (remaining > 0) {
		const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
		return { success: false, error: `You can relist this item again in ${days} day${days === 1 ? '' : 's'}` };
	}

	try {
		// Build a new event from the existing product's data, keeping the same d-tag
		const newEvent = new NDKEvent(ndk);
		newEvent.kind = PRODUCT_KIND;
		newEvent.content = product.description;

		const now = Math.floor(Date.now() / 1000).toString();
		newEvent.tags = [
			['d', product.id],
			['title', product.title],
			['summary', product.summary],
			['price', product.priceSats.toString(), 'SAT'],
			['t', product.category],
			['published_at', now],
			['lightning', product.lightningAddress],
			['shipping', product.requiresShipping ? 'true' : 'false'],
			['status', 'active']
		];

		for (const imageUrl of product.images) {
			if (imageUrl) newEvent.tags.push(['image', imageUrl]);
		}
		if (product.location) {
			newEvent.tags.push(['location', product.location]);
		}

		addClientTagToEvent(newEvent);

		await newEvent.sign();
		await newEvent.publish();

		// Also publish to marketplace relays
		try {
			const marketplaceRelaySet = NDKRelaySet.fromRelayUrls(MARKETPLACE_RELAYS, ndk);
			await newEvent.publish(marketplaceRelaySet);
		} catch {
			// non-critical
		}

		// Delete the old event via NIP-09
		try {
			await deleteProduct(ndk, product);
		} catch {
			// Old event deletion is best-effort; the new event replaces it via d-tag anyway
			console.warn('[Marketplace] Old event deletion failed (non-critical)');
		}

		// Record cooldown
		setRelistCooldown(product.id);
		invalidateProductCache();

		return { success: true, event: newEvent };
	} catch (error) {
		console.error('[Marketplace] Failed to relist product:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to relist product'
		};
	}
}

/**
 * Format price in sats with optional locale formatting
 */
export function formatSatsPrice(sats: number): string {
	return sats.toLocaleString() + ' sats';
}

/**
 * Convert a lightning address to LNURL endpoint URL
 */
export function getLnurlFromAddress(address: string): string {
	if (!address.includes('@')) {
		throw new Error('Invalid lightning address format');
	}
	const [username, domain] = address.split('@');
	return `https://${domain}/.well-known/lnurlp/${username}`;
}

/**
 * Fetch LNURL pay request data from a Lightning address
 */
export async function fetchLnurlPayRequest(lightningAddress: string): Promise<{
	callback: string;
	minSendable: number;
	maxSendable: number;
	metadata: string;
}> {
	const lnurl = getLnurlFromAddress(lightningAddress);
	const response = await fetch(lnurl);
	
	if (!response.ok) {
		throw new Error(`Failed to fetch LNURL: ${response.status}`);
	}
	
	const data = await response.json();
	
	if (data.status === 'ERROR') {
		throw new Error(data.reason || 'LNURL error');
	}
	
	return {
		callback: data.callback,
		minSendable: data.minSendable || 1000,
		maxSendable: data.maxSendable || 1000000000,
		metadata: data.metadata
	};
}

/**
 * Get a Lightning invoice for a specific amount from a Lightning address
 */
export async function getInvoiceFromLightningAddress(
	lightningAddress: string,
	amountSats: number
): Promise<{ invoice: string; verify?: string }> {
	const payRequest = await fetchLnurlPayRequest(lightningAddress);
	const amountMsat = amountSats * 1000;
	
	if (amountMsat < payRequest.minSendable || amountMsat > payRequest.maxSendable) {
		throw new Error(
			`Amount must be between ${payRequest.minSendable / 1000} and ${payRequest.maxSendable / 1000} sats`
		);
	}
	
	const callbackUrl = new URL(payRequest.callback);
	callbackUrl.searchParams.set('amount', amountMsat.toString());
	
	const response = await fetch(callbackUrl.toString());
	
	if (!response.ok) {
		throw new Error(`Failed to get invoice: ${response.status}`);
	}
	
	const data = await response.json();
	
	if (data.status === 'ERROR') {
		throw new Error(data.reason || 'Failed to generate invoice');
	}
	
	if (!data.pr) {
		throw new Error('No invoice returned');
	}
	
	return {
		invoice: data.pr,
		verify: data.verify
	};
}
