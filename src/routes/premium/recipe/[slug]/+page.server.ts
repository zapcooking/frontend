import type { PageServerLoad } from './$types';
import { nip19 } from 'nostr-tools';
import { redirect } from '@sveltejs/kit';
import { GATED_RECIPE_KIND } from '$lib/consts';

// Tracking parameters to strip
const TRACKING_PARAMS = [
	'fbclid', 'gclid', 'msclkid',
	'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
	'ref', 'source'
];

interface RecipeMetadata {
	title: string;
	description: string;
	image: string;
}

const RELAYS = [
	'wss://relay.primal.net',
	'wss://relay.damus.io',
	'wss://nos.lol'
];

async function fetchFromRelay(relayUrl: string, identifier: string, pubkey: string, kind: number = GATED_RECIPE_KIND): Promise<RecipeMetadata | null> {
	if (typeof WebSocket === 'undefined') {
		return null;
	}

	return new Promise((resolve) => {
		let ws: WebSocket | null = null;
		let resolved = false;

		const cleanup = () => {
			if (ws && ws.readyState === WebSocket.OPEN) {
				try {
					ws.close();
				} catch {
					// Ignore close errors
				}
			}
		};

		const safeResolve = (value: RecipeMetadata | null) => {
			if (!resolved) {
				resolved = true;
				cleanup();
				resolve(value);
			}
		};

		const timeout = setTimeout(() => {
			safeResolve(null);
		}, 3000);

		try {
			ws = new WebSocket(relayUrl);
		} catch (error) {
			clearTimeout(timeout);
			safeResolve(null);
			return;
		}

		const subId = `og-premium-${Date.now()}`;

		ws.onopen = () => {
			if (!ws || resolved) return;
			try {
				const req = JSON.stringify([
					'REQ',
					subId,
					{
						kinds: [kind],
						authors: [pubkey],
						'#d': [identifier],
						limit: 1
					}
				]);
				ws.send(req);
			} catch (error) {
				clearTimeout(timeout);
				safeResolve(null);
			}
		};

		ws.onmessage = (event) => {
			if (!ws || resolved) return;
			try {
				const msg = JSON.parse(event.data);
				if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
					const evt = msg[2];
					const title = evt.tags?.find((t: string[]) => t[0] === 'title')?.[1] ||
					              evt.tags?.find((t: string[]) => t[0] === 'd')?.[1] || 'Premium Recipe';
					const image = evt.tags?.find((t: string[]) => t[0] === 'image')?.[1] || '';
					
					let description = evt.tags?.find((t: string[]) => t[0] === 'summary')?.[1];
					if (!description) {
						description = 'A premium Lightning-gated recipe on zap.cooking. Unlock with sats!';
					}

					clearTimeout(timeout);
					safeResolve({ title, description, image });
				} else if (msg[0] === 'EOSE' && msg[1] === subId) {
					clearTimeout(timeout);
					safeResolve(null);
				}
			} catch {
				// Parse error, ignore
			}
		};

		ws.onerror = () => {
			clearTimeout(timeout);
			safeResolve(null);
		};

		ws.onclose = () => {
			clearTimeout(timeout);
			if (!resolved) {
				safeResolve(null);
			}
		};
	});
}

async function fetchRecipeMetadata(identifier: string, pubkey: string, kind: number): Promise<RecipeMetadata | null> {
	const results = await Promise.all(
		RELAYS.map(relay => fetchFromRelay(relay, identifier, pubkey, kind))
	);

	return results.find(r => r !== null) || null;
}

export const load: PageServerLoad = async ({ params, url }) => {
	const slug = params.slug;

	// Strip tracking parameters
	const hasTrackingParams = TRACKING_PARAMS.some(param => url.searchParams.has(param));
	if (hasTrackingParams) {
		throw redirect(301, `/premium/recipe/${slug}`);
	}

	if (!slug?.startsWith('naddr1')) {
		return {
			ogMeta: {
				title: 'Premium Recipe - zap.cooking',
				description: 'A premium Lightning-gated recipe on zap.cooking',
				image: 'https://zap.cooking/social-share.png'
			}
		};
	}

	if (typeof WebSocket === 'undefined') {
		return {
			ogMeta: {
				title: 'Premium Recipe - zap.cooking',
				description: 'A premium Lightning-gated recipe on zap.cooking',
				image: 'https://zap.cooking/social-share.png'
			}
		};
	}

	try {
		const decoded = nip19.decode(slug);
		if (decoded.type !== 'naddr') {
			return {
				ogMeta: {
					title: 'Premium Recipe - zap.cooking',
					description: 'A premium Lightning-gated recipe on zap.cooking',
					image: 'https://zap.cooking/social-share.png'
				}
			};
		}

		const { identifier, pubkey, kind } = decoded.data;
		const recipeKind = kind === GATED_RECIPE_KIND ? GATED_RECIPE_KIND : 30023;
		
		const metadataPromise = fetchRecipeMetadata(identifier, pubkey, recipeKind);
		const timeoutPromise = new Promise<null>((resolve) => 
			setTimeout(() => resolve(null), 5000)
		);
		
		const metadata = await Promise.race([metadataPromise, timeoutPromise]);

		if (metadata) {
			return {
				ogMeta: {
					title: `${metadata.title} - Premium Recipe - zap.cooking`,
					description: metadata.description || 'A premium Lightning-gated recipe on zap.cooking',
					image: metadata.image || 'https://zap.cooking/social-share.png'
				}
			};
		}
		
		return {
			ogMeta: {
				title: 'Premium Recipe - zap.cooking',
				description: 'A premium Lightning-gated recipe on zap.cooking',
				image: 'https://zap.cooking/social-share.png'
			}
		};
	} catch (e) {
		console.error('[Premium OG Meta] Error:', e);
	}

	return {
		ogMeta: {
			title: 'Premium Recipe - zap.cooking',
			description: 'A premium Lightning-gated recipe on zap.cooking',
			image: 'https://zap.cooking/social-share.png'
		}
	};
};
