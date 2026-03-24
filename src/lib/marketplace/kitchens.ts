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
	MARKETPLACE_LISTING_MAX_AGE_DAYS,
	type Kitchen,
	type KitchenFormData,
	type ImplicitKitchen,
	type KitchenDisplay
} from './types';
import { MARKETPLACE_RELAYS } from './products';
import { addClientTagToEvent } from '$lib/nip89';
import { profileCacheManager } from '$lib/profileCache';
import { getMembership } from '$lib/stores/membershipStatus';
import type { MembershipTier } from '$lib/membershipStore';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '$lib/currencyStore';

// NIP-85 Trusted Assertions — service relay for trust rank lookups
const NIP85_RELAY = 'wss://nip85.nostr.band';
const NIP85_KIND_USER = 30382;
const NIP85_KIND_PROVIDER_DECLARATION = 10040;

// --- In-memory cache for kitchen displays ---
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let kitchenDisplayCache: { data: KitchenDisplay[]; timestamp: number; userPubkey?: string } | null = null;

// Cache for user's trust provider declaration (Kind 10040)
let providerCache: { userPubkey: string; provider: TrustProvider | null; timestamp: number } | null = null;
const PROVIDER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Parsed NIP-85 trust provider from a Kind 10040 event */
export interface TrustProvider {
	servicePubkey: string;
	relayHint?: string;
}

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
 * Membership tier priority boost values
 * Members get a significant quality score boost so their stores appear first
 */
const MEMBER_TIER_BOOST: Record<string, number> = {
	founders: 50,
	pro_kitchen: 40,
	cook_plus: 30,
	member: 25
};

/**
 * Compute a quality score for a store display (0-150)
 * Used for sorting — higher score = better store
 * Members get a boost so their stores are prioritized
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

	// Membership tier boost (+25 to +50 depending on tier)
	if (kitchen.memberTier) {
		score += MEMBER_TIER_BOOST[kitchen.memberTier] || 0;
	}

	return score;
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

		// Read default currency from content JSON or tag.
		// Normalize legacy 'SAT' → 'SATS'.
		const rawCurrency = (contentData as any).currency || getTag('currency') || '';
		const normalizedCurrency = rawCurrency.toUpperCase() === 'SAT' ? 'SATS' : rawCurrency.toUpperCase();
		const defaultCurrency: CurrencyCode | undefined =
			SUPPORTED_CURRENCIES.some((c) => c.code === normalizedCurrency)
				? (normalizedCurrency as CurrencyCode)
				: undefined;

		return {
			id,
			pubkey: event.pubkey,
			name,
			description,
			banner,
			avatar,
			location,
			lightningAddress,
			defaultCurrency,
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
		currency: data.defaultCurrency || 'SATS',
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

	const timeoutMs = options.timeoutMs || 6000;

	try {
		// Wait briefly if no relays are connected yet
		const connectedRelays = ndk.pool?.relays ?
			Array.from(ndk.pool.relays.values()).filter(r => r.status === 1).length : 0;
		if (connectedRelays === 0) {
			await new Promise(resolve => setTimeout(resolve, 2000));
		}

		let relaySet: NDKRelaySet | undefined;
		try {
			relaySet = NDKRelaySet.fromRelayUrls(MARKETPLACE_RELAYS, ndk);
		} catch (e) {
			console.warn('[Kitchens] Could not create relay set:', e);
		}

		const allEvents = new Set<NDKEvent>();
		let timeoutId: ReturnType<typeof setTimeout>;

		const fetchPromise = new Promise<Set<NDKEvent>>((resolve) => {
			const sub = ndk.subscribe(filter, { closeOnEose: true }, relaySet);

			sub.on('event', (event: NDKEvent) => {
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

		const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) => {
			timeoutId = setTimeout(() => resolve(allEvents), timeoutMs);
		}
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
 * Fetch the signed-in user's NIP-85 trust provider declaration (Kind 10040)
 * Looks for a `30382:rank` tag to find their declared trust assertion service
 * Returns null if user has no declaration or is not signed in
 */
export async function fetchUserTrustProvider(
	ndk: NDK,
	userPubkey: string
): Promise<TrustProvider | null> {
	// Check cache first
	if (providerCache && providerCache.userPubkey === userPubkey && Date.now() - providerCache.timestamp < PROVIDER_CACHE_TTL_MS) {
		return providerCache.provider;
	}

	try {
		const filter: NDKFilter = {
			kinds: [NIP85_KIND_PROVIDER_DECLARATION] as number[],
			authors: [userPubkey]
		};

		let providerEvent: NDKEvent | null = null;
		let sub: ReturnType<typeof ndk.subscribe> | null = null;

		const fetchPromise = new Promise<void>((resolve) => {
			sub = ndk.subscribe(filter, { closeOnEose: true });

			sub.on('event', (event: NDKEvent) => {
				if (!providerEvent || (event.created_at || 0) > (providerEvent.created_at || 0)) {
					providerEvent = event;
				}
			});

			sub.on('eose', () => resolve());
			sub.on('close', () => resolve());
		});

		const timeout = new Promise<void>((resolve) =>
			setTimeout(() => {
				if (sub && typeof sub.stop === 'function') {
					try { sub.stop(); } catch { /* ignore cleanup errors */ }
				}
				resolve();
			}, 4000)
		);
		await Promise.race([fetchPromise, timeout]);

		if (sub && typeof (sub as any).stop === 'function') {
			try { (sub as any).stop(); } catch { /* ignore cleanup errors */ }
		}

		if (!providerEvent) {
			providerCache = { userPubkey, provider: null, timestamp: Date.now() };
			return null;
		}

		// Parse 30382:rank tag: ["30382:rank", "<service_pubkey>", "<relay_hint>"]
		const rankProviderTag = (providerEvent as NDKEvent).tags.find(
			(t) => t[0] === '30382:rank'
		);

		if (!rankProviderTag || !rankProviderTag[1]) {
			providerCache = { userPubkey, provider: null, timestamp: Date.now() };
			return null;
		}

		const provider: TrustProvider = {
			servicePubkey: rankProviderTag[1],
			relayHint: rankProviderTag[2] || undefined
		};

		providerCache = { userPubkey, provider, timestamp: Date.now() };
		console.log(`[Kitchens] Found NIP-85 trust provider for user: ${provider.servicePubkey.slice(0, 8)}...`);
		return provider;
	} catch (e) {
		console.warn('[Kitchens] Failed to fetch user trust provider (non-critical):', e);
		providerCache = { userPubkey, provider: null, timestamp: Date.now() };
		return null;
	}
}

/**
 * Publish a Kind 10040 trust provider declaration for the signed-in user.
 * This tells clients which NIP-85 service to use for personalized scores.
 */
export async function publishTrustProvider(
	ndk: NDK,
	provider: TrustProvider
): Promise<{ success: boolean; error?: string }> {
	try {
		if (!ndk.signer) {
			return { success: false, error: 'Not signed in' };
		}

		const event = new NDKEvent(ndk);
		event.kind = NIP85_KIND_PROVIDER_DECLARATION;
		event.content = '';
		event.tags = [
			['30382:rank', provider.servicePubkey, provider.relayHint || '']
		];

		addClientTagToEvent(event);
		await event.sign();
		await event.publish();

		// Invalidate provider cache so next fetch picks up the change
		providerCache = null;
		// Invalidate kitchen display cache so scores refresh with new provider
		kitchenDisplayCache = null;

		console.log(`[Kitchens] Published NIP-85 trust provider: ${provider.servicePubkey.slice(0, 8)}...`);
		return { success: true };
	} catch (e) {
		console.error('[Kitchens] Failed to publish trust provider:', e);
		return {
			success: false,
			error: e instanceof Error ? e.message : 'Failed to publish trust provider'
		};
	}
}

/**
 * Clear the user's trust provider declaration (publish empty Kind 10040).
 * This reverts to using the global default provider.
 */
export async function clearTrustProvider(
	ndk: NDK
): Promise<{ success: boolean; error?: string }> {
	try {
		if (!ndk.signer) {
			return { success: false, error: 'Not signed in' };
		}

		const event = new NDKEvent(ndk);
		event.kind = NIP85_KIND_PROVIDER_DECLARATION;
		event.content = '';
		event.tags = [];

		addClientTagToEvent(event);
		await event.sign();
		await event.publish();

		// Invalidate caches
		providerCache = null;
		kitchenDisplayCache = null;

		console.log('[Kitchens] Cleared NIP-85 trust provider (reverted to global)');
		return { success: true };
	} catch (e) {
		console.error('[Kitchens] Failed to clear trust provider:', e);
		return {
			success: false,
			error: e instanceof Error ? e.message : 'Failed to clear trust provider'
		};
	}
}

/** Result from fetchTrustRanks including whether scores are personalized */
export interface TrustRankResult {
	ranks: Map<string, number>;
	personalized: boolean;
}

/**
 * Fetch NIP-85 trust ranks for a list of pubkeys
 * If userPubkey is provided, looks up their Kind 10040 declaration first
 * to fetch personalized scores from their declared provider.
 * Falls back to global wss://nip85.nostr.band if no provider declared.
 * Returns ranks map + whether the result is personalized.
 */
export async function fetchTrustRanks(
	ndk: NDK,
	pubkeys: string[],
	userPubkey?: string
): Promise<TrustRankResult> {
	const ranks = new Map<string, number>();
	if (pubkeys.length === 0) return { ranks, personalized: false };

	let personalized = false;
	let serviceRelay = NIP85_RELAY;
	let authorsFilter: string[] | undefined;

	// If user is signed in, try to find their declared trust provider
	if (userPubkey) {
		try {
			const provider = await fetchUserTrustProvider(ndk, userPubkey);
			if (provider) {
				// Use the provider's relay if specified, otherwise try the default
				if (provider.relayHint) {
					serviceRelay = provider.relayHint;
				}
				// Filter to only this provider's assertions
				authorsFilter = [provider.servicePubkey];
				personalized = true;
			}
		} catch (e) {
			console.warn('[Kitchens] Provider lookup failed, falling back to global:', e);
		}
	}

	try {
		const relayUrls = serviceRelay === NIP85_RELAY ? [NIP85_RELAY] : [serviceRelay, NIP85_RELAY];
		const relaySet = NDKRelaySet.fromRelayUrls(relayUrls, ndk);
		const filter: NDKFilter = {
			kinds: [NIP85_KIND_USER] as number[],
			'#d': pubkeys,
			limit: pubkeys.length
		};

		// When personalized, filter by the declared service author
		if (authorsFilter) {
			filter.authors = authorsFilter;
		}

		const events = new Set<NDKEvent>();

		const fetchPromise = new Promise<void>((resolve) => {
			const sub = ndk.subscribe(filter, { closeOnEose: true }, relaySet);

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
			console.log(`[Kitchens] Fetched NIP-85 trust ranks for ${ranks.size}/${pubkeys.length} sellers (${personalized ? 'personalized' : 'global'})`);
		}
	} catch (e) {
		// Silently fail — trust rank is an enhancement
		console.warn('[Kitchens] NIP-85 trust rank fetch failed (non-critical):', e);
	}

	return { ranks, personalized };
}

/**
 * Fetch all kitchen displays — merges explicit stalls + implicit kitchens from sellers with products
 * Applies profile quality filters and quality scoring
 */
export async function fetchAllKitchenDisplays(
	ndk: NDK,
	options: {
		timeoutMs?: number;
		skipCache?: boolean;
		userPubkey?: string;
		onTrustRanksReady?: (ranks: Map<string, number>, personalized: boolean) => void;
		onMembershipReady?: () => void;
	} = {}
): Promise<KitchenDisplay[]> {
	// Return cached data if fresh and for the same user
	if (!options.skipCache && kitchenDisplayCache && Date.now() - kitchenDisplayCache.timestamp < CACHE_TTL_MS && kitchenDisplayCache.userPubkey === (options.userPubkey || undefined)) {
		return kitchenDisplayCache.data;
	}

	const timeoutMs = options.timeoutMs || 6000;

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
	const qualifiedDisplays = displays.filter((d) => {
		const hasPfp = hasValidProfileImage(d.avatar);
		const hasName = hasValidDisplayName(d.name);
		return hasPfp && hasName;
	});

	// --- Fetch membership status for all sellers ---
	const allSellerPubkeys = qualifiedDisplays.map((d) => d.pubkey);
	try {
		const membershipStatuses = await getMembership(allSellerPubkeys);
		const validTiers: MembershipTier[] = ['member', 'cook_plus', 'pro_kitchen', 'founders'];
		for (const d of qualifiedDisplays) {
			const status = membershipStatuses[d.pubkey];
			if (status?.active && validTiers.includes(status.tier as MembershipTier)) {
				d.memberTier = status.tier as MembershipTier;
			}
		}
	} catch (e) {
		console.warn('[Kitchens] Membership lookup failed (non-critical):', e);
	}

	// --- Quality scoring + sort ---
	const scored = qualifiedDisplays.map((d) => ({
		display: d,
		score: computeQualityScore(d)
	}));

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return (b.display.productCount || 0) - (a.display.productCount || 0);
	});

	// Final safety dedup by pubkey
	const finalPubkeys = new Set<string>();
	const result = scored
		.map((s) => s.display)
		.filter((d) => {
			if (finalPubkeys.has(d.pubkey)) return false;
			finalPubkeys.add(d.pubkey);
			return true;
		});

	// Cache the result
	kitchenDisplayCache = { data: result, timestamp: Date.now(), userPubkey: options.userPubkey || undefined };

	// --- NIP-85 trust ranks (non-blocking background fetch) ---
	const allPubkeys = result.map((d) => d.pubkey);
	fetchTrustRanks(ndk, allPubkeys, options.userPubkey).then(({ ranks, personalized }) => {
		// Attach trust ranks to cached display objects
		for (const d of result) {
			const rank = ranks.get(d.pubkey);
			if (rank !== undefined) {
				d.trustRank = rank;
			}
		}
		// Re-sort with trust ranks now available
		result.sort((a, b) => {
			const scoreA = computeQualityScore(a, a.trustRank);
			const scoreB = computeQualityScore(b, b.trustRank);
			if (scoreB !== scoreA) return scoreB - scoreA;
			return (b.productCount || 0) - (a.productCount || 0);
		});
		// Update cache with trust ranks
		kitchenDisplayCache = { data: result, timestamp: Date.now(), userPubkey: options.userPubkey || undefined };
		// Notify caller so UI can re-render with trust badges
		options.onTrustRanksReady?.(ranks, personalized);
	});

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

	const timeoutMs = options.timeoutMs || 6000;

	try {
		let relaySet: NDKRelaySet | undefined;
		try {
			relaySet = NDKRelaySet.fromRelayUrls(MARKETPLACE_RELAYS, ndk);
		} catch {
			// fallback to default relays
		}

		const allEvents = new Set<NDKEvent>();
		let timeoutId: ReturnType<typeof setTimeout>;

		const fetchPromise = new Promise<Set<NDKEvent>>((resolve) => {
			const sub = ndk.subscribe(filter, { closeOnEose: true }, relaySet);

			sub.on('event', (event: NDKEvent) => {
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

		const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) => {
			timeoutId = setTimeout(() => resolve(allEvents), timeoutMs);
		});

		const events = await Promise.race([fetchPromise, timeoutPromise]);

		// Dedup events by id, then filter to only active products with price, images, and age
		const seenIds = new Set<string>();
		const validEvents: NDKEvent[] = [];
		const ageCutoff = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * MARKETPLACE_LISTING_MAX_AGE_DAYS;
		for (const event of events) {
			if (seenIds.has(event.id)) continue;
			seenIds.add(event.id);

			// Skip stale listings
			if ((event.created_at || 0) < ageCutoff) continue;

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
