/**
 * Marketplace Products Library
 * Functions to create, fetch, and parse product events (NIP-99 kind 30402)
 */

import { NDKEvent, NDKRelaySet, type NDK, type NDKFilter } from '@nostr-dev-kit/ndk';
import {
	PRODUCT_KIND,
	PRODUCT_KIND_LEGACY,
	PRODUCT_CATEGORIES,
	type Product,
	type ProductCategory,
	type ProductFormData,
	type ProductStatus
} from './types';
import { addClientTagToEvent } from '$lib/nip89';

// Relays that index marketplace events
const MARKETPLACE_RELAYS = [
	'wss://kitchen.zap.cooking',
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band'
];

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

	const timeoutMs = options.timeoutMs || 15000; // 15 second default timeout

	console.log('[Marketplace] Fetching products with filter:', {
		kinds: filter.kinds,
		authors: filter.authors,
		limit: filter.limit,
		category: options.category,
		timeoutMs
	});

	// Check if NDK has connected relays
	const connectedRelays = ndk.pool?.relays ? 
		Array.from(ndk.pool.relays.values()).filter(r => r.status === 1).length : 0;
	console.log('[Marketplace] Connected relays:', connectedRelays);

	if (connectedRelays === 0) {
		console.warn('[Marketplace] No connected relays, waiting for connection...');
		await new Promise(resolve => setTimeout(resolve, 3000));
		const newConnectedRelays = ndk.pool?.relays ? 
			Array.from(ndk.pool.relays.values()).filter(r => r.status === 1).length : 0;
		console.log('[Marketplace] Connected relays after wait:', newConnectedRelays);
	}

	try {
		// For public marketplace queries (no author filter), use specific relays
		// that are known to index all events by kind
		let relaySet: NDKRelaySet | undefined;
		
		if (!options.author) {
			// Create relay set with marketplace-friendly relays
			console.log('[Marketplace] No author filter, using marketplace relays:', MARKETPLACE_RELAYS);
			try {
				relaySet = NDKRelaySet.fromRelayUrls(MARKETPLACE_RELAYS, ndk);
			} catch (e) {
				console.warn('[Marketplace] Could not create relay set:', e);
			}
		}

		// Use subscription-based fetch for better relay compatibility
		const allEvents = new Set<any>();
		
		const fetchPromise = new Promise<Set<any>>((resolve) => {
			const sub = ndk.subscribe(filter, { closeOnEose: true, relaySet });
			
			sub.on('event', (event: any) => {
				allEvents.add(event);
			});
			
			sub.on('eose', () => {
				console.log('[Marketplace] EOSE received, events so far:', allEvents.size);
				resolve(allEvents);
			});
			
			// Also resolve on close
			sub.on('close', () => {
				resolve(allEvents);
			});
		});

		const timeoutPromise = new Promise<Set<any>>((resolve) => 
			setTimeout(() => {
				console.warn('[Marketplace] Fetch timed out after', timeoutMs, 'ms, returning', allEvents.size, 'events');
				resolve(allEvents);
			}, timeoutMs)
		);

		const events = await Promise.race([fetchPromise, timeoutPromise]);

		console.log('[Marketplace] Fetched', events.size, 'events from relays');
		
		const products: Product[] = [];

		for (const event of events) {
			console.log('[Marketplace] Processing event:', {
				id: event.id?.substring(0, 16),
				kind: event.kind,
				pubkey: event.pubkey?.substring(0, 16)
			});
			const product = parseProductEvent(event);
			if (product && product.status === 'active') {
				products.push(product);
			}
		}

		console.log('[Marketplace] Parsed', products.length, 'active products');

		// Sort by published date, newest first
		products.sort((a, b) => b.publishedAt - a.publishedAt);

		return products;
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
		
		console.log('[Marketplace] Product deleted:', product.id);
		return { success: true };
	} catch (error) {
		console.error('[Marketplace] Failed to delete product:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to delete product'
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
