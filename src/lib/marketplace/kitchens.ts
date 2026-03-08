/**
 * Marketplace Kitchens Library
 * Functions to create, fetch, and parse kitchen/stall events (NIP-15 kind 30017)
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent, NDKRelaySet, type NDKFilter } from '@nostr-dev-kit/ndk';
import {
	STALL_KIND,
	PRODUCT_KIND,
	PRODUCT_KIND_LEGACY,
	type Kitchen,
	type KitchenFormData,
	type ImplicitKitchen,
	type KitchenDisplay
} from './types';
import { MARKETPLACE_RELAYS } from './products';
import { addClientTagToEvent } from '$lib/nip89';
import { profileCacheManager } from '$lib/profileCache';

// NIP-85 Trusted Assertions — service relay for trust rank lookups
const NIP85_RELAY = 'wss://nip85.nostr.band';
const NIP85_KIND_USER = 30382;

// --- In-memory cache for kitchen displays ---
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let kitchenDisplayCache: { data: KitchenDisplay[]; timestamp: number } | null = null;

/** Clear the kitchen display cache (call after publishing/deleting a kitchen) */
export function invalidateKitchenCache(): void {
	kitchenDisplayCache = null;
}
// Known placeholder/default avatar patterns (same as exploreUtils.ts)
const INVALID_IMAGE_PATTERNS = [
	'placeholder',
	'default',
	'avatar-default',
	'no-image',
	'noimage',
	'blank',
	'empty',
	'null',
	'undefined',
	'robohash.org',
	'gravatar.com/avatar/0',
	'ui-avatars.com',
	'dicebear.com',
	'boring-avatars',
	'jazzicon',
	'blockies'
];

/**
 * Check if a profile image is a real, valid image URL
 * (mirrors hasValidProfileImage from exploreUtils.ts)
 */
function hasValidProfileImage(imageUrl: string | undefined | null): boolean {
	if (!imageUrl || typeof imageUrl !== 'string') return false;

	const trimmed = imageUrl.trim();
	if (trimmed.length < 20) return false;
	if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false;

	const lower = trimmed.toLowerCase();
	for (const pattern of INVALID_IMAGE_PATTERNS) {
		if (lower.includes(pattern)) return false;
	}

	return true;
}

/**
 * Check if a display name looks like a real name (not just pubkey/hex)
 */
function hasValidDisplayName(name: string | undefined | null): boolean {
	if (!name || typeof name !== 'string') return false;
	const trimmed = name.trim();
	if (trimmed.length === 0) return false;
	// Reject names that are just hex strings (pubkey fragments)
	if (/^[0-9a-f]{8,}$/i.test(trimmed)) return false;
	// Reject auto-generated "Chef xxxxxxxx" fallback names
	if (/^Chef [0-9a-f]{8}$/i.test(trimmed)) return false;
	return true;
}

/**
 * Compute a quality score for a store display (0-100)
 * Used for sorting — higher score = better store
 */
function computeQualityScore(kitchen: KitchenDisplay, trustRank?: number): number {
	let score = 0;

	// Profile picture (+20)
	const avatar = kitchen.avatar;
	if (hasValidProfileImage(avatar)) score += 20;

	// Display name (+15)
	if (hasValidDisplayName(kitchen.name)) score += 15;

	// Description (+10)
	if (kitchen.description && kitchen.description.trim().length > 10) score += 10;

	// Lightning address (+5)
	if (kitchen.lightningAddress) score += 5;

	// Location (+5)
	if (kitchen.location) score += 5;

	// Explicit stall (not implicit) (+10)
	if (!kitchen.isImplicit) score += 10;

	// Product count — up to +25 (scaled: 1 product = 5, caps at 5+)
	const products = kitchen.productCount || 0;
	score += Math.min(products * 5, 25);

	// NIP-85 trust rank boost (+10, scaled from 0-100 to 0-10)
	if (trustRank !== undefined && trustRank > 0) {
		score += Math.round((trustRank / 100) * 10);
	}

	return Math.min(score, 100);
}

/**
 * Parse an NDKEvent (kind 30017) into a Kitchen object
 */
export function parseKitchenEvent(event: NDKEvent): Kitchen | null {
	try {
		const getTag = (name: string): string | undefined =>
			event.tags.find((t) => t[0] === name)?.[1];

		const id = getTag('d');
		if (!id) return null;

		// Parse content JSON (NIP-15 stall format)
		let contentData: { id?: string; name?: string; description?: string } = {};
		try {
			contentData = JSON.parse(event.content);
		} catch {
			// Content may not be valid JSON
		}

		const name = contentData.name || getTag('name') || '';
		const description = contentData.description || getTag('description') || '';
		const banner = getTag('banner');
		const avatar = getTag('avatar');
		const location = getTag('location');
		const lightningAddress = getTag('lightning');

		return {
			id,
			pubkey: event.pubkey,
			name,
			description,
			banner,
			avatar,
			location,
			lightningAddress,
			createdAt: event.created_at || 0,
			event
		};
	} catch (error) {
		console.error('[Kitchens] Failed to parse kitchen event:', error);
		return null;
	}
}

/**
 * Create a kitchen event from form data
 */
export function createKitchenEvent(
	ndk: NDK,
	data: KitchenFormData,
	existingId?: string
): NDKEvent {
	const event = new NDKEvent(ndk);
	event.kind = STALL_KIND;

	const kitchenId = existingId || crypto.randomUUID();

	// NIP-15 stall content format
	event.content = JSON.stringify({
		id: kitchenId,
		name: data.name,
		description: data.description || '',
		currency: 'SAT',
		shipping: []
	});

	event.tags = [['d', kitchenId]];

	if (data.banner) {
		event.tags.push(['banner', data.banner]);
	}
	if (data.avatar) {
		event.tags.push(['avatar', data.avatar]);
	}
	if (data.location) {
		event.tags.push(['location', data.location]);
	}
	if (data.lightningAddress) {
		event.tags.push(['lightning', data.lightningAddress]);
	}

	addClientTagToEvent(event);

	return event;
}

/**
 * Fetch all kitchens (stall events) from relays
 */
export async function fetchKitchens(
	ndk: NDK,
	options: { author?: string; limit?: number; timeoutMs?: number } = {}
): Promise<Kitchen[]> {
	const filter: NDKFilter = {
		kinds: [STALL_KIND] as number[],
		limit: options.limit || 100
	};

	if (options.author) {
		filter.authors = [options.author];
	}

	const timeoutMs = options.timeoutMs || 15000;

	try {
		// Wait briefly if no relays are connected yet (same pattern as fetchProducts)
		const connectedRelays = ndk.pool?.relays ?
			Array.from(ndk.pool.relays.values()).filter(r => r.status === 1).length : 0;
		if (connectedRelays === 0) {
			await new Promise(resolve => setTimeout(resolve, 3000));
		}

		let relaySet: NDKRelaySet | undefined;
		if (!options.author) {
			try {
				relaySet = NDKRelaySet.fromRelayUrls(MARKETPLACE_RELAYS, ndk);
			} catch (e) {
				console.warn('[Kitchens] Could not create relay set:', e);
			}
		}

		const allEvents = new Set<NDKEvent>();

		const fetchPromise = new Promise<Set<NDKEvent>>((resolve) => {
			const sub = ndk.subscribe(filter, { closeOnEose: true, relaySet } as any);

			sub.on('event', (event: NDKEvent) => {
				allEvents.add(event);
			});

			sub.on('eose', () => {
				resolve(allEvents);
			});

			sub.on('close', () => {
				resolve(allEvents);
			});
		});

		const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) =>
			setTimeout(() => resolve(allEvents), timeoutMs)
		);

		const events = await Promise.race([fetchPromise, timeoutPromise]);

		// Dedup events by id (same event from multiple relays)
		const seenEventIds = new Set<string>();
		const kitchens: Kitchen[] = [];
		for (const event of events) {
			if (seenEventIds.has(event.id)) continue;
			seenEventIds.add(event.id);
			const kitchen = parseKitchenEvent(event);
			if (kitchen && kitchen.name) {
				kitchens.push(kitchen);
			}
		}

		// Sort by creation date, newest first
		kitchens.sort((a, b) => b.createdAt - a.createdAt);

		return kitchens;
	} catch (error) {
		console.error('[Kitchens] Failed to fetch kitchens:', error);
		return [];
	}
}

/**
 * Fetch a kitchen by owner pubkey
 */
export async function fetchKitchenByPubkey(
	ndk: NDK,
	pubkey: string
): Promise<Kitchen | null> {
	const kitchens = await fetchKitchens(ndk, { author: pubkey });
	return kitchens[0] || null;
}

/**
 * Publish a kitchen event to relays
 */
export async function publishKitchen(
	ndk: NDK,
	data: KitchenFormData,
	existingId?: string
): Promise<{ success: boolean; event?: NDKEvent; error?: string }> {
	try {
		const event = createKitchenEvent(ndk, data, existingId);
		await event.sign();
		await event.publish();

		// Also publish to marketplace relays
		try {
			const marketplaceRelaySet = NDKRelaySet.fromRelayUrls(MARKETPLACE_RELAYS, ndk);
			await event.publish(marketplaceRelaySet);
		} catch (e) {
			console.warn('[Kitchens] Could not publish to marketplace relays:', e);
		}

		invalidateKitchenCache();
		return { success: true, event };
	} catch (error) {
		console.error('[Kitchens] Failed to publish kitchen:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to publish kitchen'
		};
	}
}

/**
 * Delete a kitchen by publishing a deletion event (kind 5)
 */
export async function deleteKitchen(
	ndk: NDK,
	kitchen: Kitchen
): Promise<{ success: boolean; error?: string }> {
	try {
		const event = new NDKEvent(ndk);
		event.kind = 5;
		event.content = 'Kitchen deleted by owner';
		event.tags = [
			['a', `${STALL_KIND}:${kitchen.pubkey}:${kitchen.id}`],
			['k', STALL_KIND.toString()]
		];

		await event.sign();
		await event.publish();

		try {
			const marketplaceRelaySet = NDKRelaySet.fromRelayUrls(MARKETPLACE_RELAYS, ndk);
			await event.publish(marketplaceRelaySet);
		} catch (e) {
			console.warn('[Kitchens] Could not publish deletion to marketplace relays:', e);
		}

		invalidateKitchenCache();
		return { success: true };
	} catch (error) {
		console.error('[Kitchens] Failed to delete kitchen:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to delete kitchen'
		};
	}
}

/**
 * Build an ImplicitKitchen from a seller's kind:0 profile
 */
export async function buildImplicitKitchen(
	pubkey: string,
	productCount: number
): Promise<ImplicitKitchen> {
	const user = await profileCacheManager.getProfile(pubkey);
	const profile = user?.profile;

	return {
		pubkey,
		name: profile?.displayName || profile?.name || `Chef ${pubkey.slice(0, 8)}`,
		description: profile?.about || '',
		banner: profile?.banner || undefined,
		avatar: profile?.image || (profile as any)?.picture || undefined,
		location: undefined,
		lightningAddress: profile?.lud16 || undefined,
		productCount,
		isImplicit: true
	};
}

/**
 * Fetch NIP-85 trust ranks for a list of pubkeys from relay.nostr.band
 * Returns a map of pubkey → rank (0–100 integer, higher = more trusted)
 * Gracefully returns empty map on failure — this is an enhancement, not a requirement
 */
export async function fetchTrustRanks(
	ndk: NDK,
	pubkeys: string[]
): Promise<Map<string, number>> {
	const ranks = new Map<string, number>();
	if (pubkeys.length === 0) return ranks;

	try {
		const relaySet = NDKRelaySet.fromRelayUrls([NIP85_RELAY], ndk);
		const filter: NDKFilter = {
			kinds: [NIP85_KIND_USER] as number[],
			'#d': pubkeys,
			limit: pubkeys.length
		};

		const events = new Set<NDKEvent>();

		const fetchPromise = new Promise<void>((resolve) => {
			const sub = ndk.subscribe(filter, { closeOnEose: true, relaySet } as any);

			sub.on('event', (event: NDKEvent) => {
				events.add(event);
			});

			sub.on('eose', () => resolve());
			sub.on('close', () => resolve());
		});

		// Short timeout — trust rank is optional
		const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
		await Promise.race([fetchPromise, timeout]);

		for (const event of events) {
			const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
			const rankTag = event.tags.find((t) => t[0] === 'rank')?.[1];
			if (dTag && rankTag) {
				const rank = parseInt(rankTag, 10);
				// NIP-85 rank is int normalized 0-100
				if (!isNaN(rank) && rank >= 0) {
					ranks.set(dTag, Math.min(rank, 100));
				}
			}
		}

		if (ranks.size > 0) {
			console.log(`[Kitchens] Fetched NIP-85 trust ranks for ${ranks.size}/${pubkeys.length} sellers`);
		}
	} catch (e) {
		// Silently fail — trust rank is an enhancement
		console.warn('[Kitchens] NIP-85 trust rank fetch failed (non-critical):', e);
	}

	return ranks;
}

/**
 * Fetch all kitchen displays — merges explicit stalls + implicit kitchens from sellers with products
 * Applies profile quality filters and quality scoring
 */
export async function fetchAllKitchenDisplays(
	ndk: NDK,
	options: { timeoutMs?: number; skipCache?: boolean } = {}
): Promise<KitchenDisplay[]> {
	// Return cached data if fresh
	if (!options.skipCache && kitchenDisplayCache && Date.now() - kitchenDisplayCache.timestamp < CACHE_TTL_MS) {
		return kitchenDisplayCache.data;
	}

	const timeoutMs = options.timeoutMs || 15000;

	// Fetch stalls and products in parallel
	const [kitchens, productEvents] = await Promise.all([
		fetchKitchens(ndk, { timeoutMs }),
		fetchProductEvents(ndk, { timeoutMs })
	]);

	// Deduplicate products by d-tag + pubkey (same product from multiple relays)
	const seenProducts = new Set<string>();
	const uniqueProductEvents: NDKEvent[] = [];
	for (const event of productEvents) {
		const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
		const key = dTag ? `${event.pubkey}:${dTag}` : event.id;
		if (!seenProducts.has(key)) {
			seenProducts.add(key);
			uniqueProductEvents.push(event);
		}
	}

	// Count products per seller
	const sellerProductCounts = new Map<string, number>();
	for (const event of uniqueProductEvents) {
		const count = sellerProductCounts.get(event.pubkey) || 0;
		sellerProductCounts.set(event.pubkey, count + 1);
	}

	// Set product counts on explicit kitchens, deduplicate by pubkey (keep newest)
	const kitchenPubkeys = new Set<string>();
	const displays: KitchenDisplay[] = [];

	for (const kitchen of kitchens) {
		if (kitchenPubkeys.has(kitchen.pubkey)) continue;
		kitchenPubkeys.add(kitchen.pubkey);
		displays.push({
			...kitchen,
			productCount: sellerProductCounts.get(kitchen.pubkey) || 0,
			isImplicit: false as const
		});
	}

	// Build implicit kitchens for sellers without stall events
	const implicitPromises: Promise<ImplicitKitchen>[] = [];
	for (const [pubkey, count] of sellerProductCounts) {
		if (!kitchenPubkeys.has(pubkey)) {
			implicitPromises.push(buildImplicitKitchen(pubkey, count));
		}
	}

	const implicitKitchens = await Promise.all(implicitPromises);
	displays.push(...implicitKitchens);

	// --- Profile quality gate ---
	// Filter out stores whose owner has no valid profile picture or display name
	const qualifiedDisplays = displays.filter((d) => {
		// For explicit stalls: check stall avatar
		const avatarUrl = d.avatar;
		const hasPfp = hasValidProfileImage(avatarUrl);
		const hasName = hasValidDisplayName(d.name);

		// Must have BOTH a valid profile picture and a real display name
		return hasPfp && hasName;
	});

	// --- NIP-85 trust rank (async enhancement) ---
	const allPubkeys = qualifiedDisplays.map((d) => d.pubkey);
	const trustRanks = await fetchTrustRanks(ndk, allPubkeys);

	// Attach trust ranks to display objects
	for (const d of qualifiedDisplays) {
		const rank = trustRanks.get(d.pubkey);
		if (rank !== undefined) {
			d.trustRank = rank;
		}
	}

	// --- Quality scoring + sort ---
	const scored = qualifiedDisplays.map((d) => ({
		display: d,
		score: computeQualityScore(d, trustRanks.get(d.pubkey))
	}));

	// Sort by quality score descending, then product count as tiebreaker
	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return (b.display.productCount || 0) - (a.display.productCount || 0);
	});

	// Final safety dedup by pubkey (belt-and-suspenders for the keyed each block)
	const finalPubkeys = new Set<string>();
	const result = scored
		.map((s) => s.display)
		.filter((d) => {
			if (finalPubkeys.has(d.pubkey)) return false;
			finalPubkeys.add(d.pubkey);
			return true;
		});

	// Cache the result
	kitchenDisplayCache = { data: result, timestamp: Date.now() };

	return result;
}

/**
 * Fetch raw product events (for counting sellers)
 * Only returns active products with valid price and images
 */
async function fetchProductEvents(
	ndk: NDK,
	options: { timeoutMs?: number } = {}
): Promise<NDKEvent[]> {
	const filter: NDKFilter = {
		kinds: [PRODUCT_KIND, PRODUCT_KIND_LEGACY] as number[],
		limit: 200
	};

	const timeoutMs = options.timeoutMs || 15000;

	try {
		let relaySet: NDKRelaySet | undefined;
		try {
			relaySet = NDKRelaySet.fromRelayUrls(MARKETPLACE_RELAYS, ndk);
		} catch {
			// fallback to default relays
		}

		const allEvents = new Set<NDKEvent>();

		const fetchPromise = new Promise<Set<NDKEvent>>((resolve) => {
			const sub = ndk.subscribe(filter, { closeOnEose: true, relaySet } as any);

			sub.on('event', (event: NDKEvent) => {
				allEvents.add(event);
			});

			sub.on('eose', () => {
				resolve(allEvents);
			});

			sub.on('close', () => {
				resolve(allEvents);
			});
		});

		const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) =>
			setTimeout(() => resolve(allEvents), timeoutMs)
		);

		const events = await Promise.race([fetchPromise, timeoutPromise]);

		// Dedup events by id, then filter to only active products with price and images
		const seenIds = new Set<string>();
		const validEvents: NDKEvent[] = [];
		for (const event of events) {
			if (seenIds.has(event.id)) continue;
			seenIds.add(event.id);

			const statusTag = event.tags.find((t) => t[0] === 'status')?.[1];
			const priceTag = event.tags.find((t) => t[0] === 'price')?.[1];
			const hasImages = event.tags.some((t) => t[0] === 'image' && t[1]);
			const price = priceTag ? parseInt(priceTag, 10) : 0;

			if ((!statusTag || statusTag === 'active') && price > 0 && hasImages) {
				validEvents.push(event);
			}
		}

		return validEvents;
	} catch (error) {
		console.error('[Kitchens] Failed to fetch product events:', error);
		return [];
	}
}
