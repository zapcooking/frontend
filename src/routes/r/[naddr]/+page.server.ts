import type { PageServerLoad } from './$types';
import { nip19 } from 'nostr-tools';
import { redirect } from '@sveltejs/kit';

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

async function fetchFromRelay(relayUrl: string, identifier: string, pubkey: string): Promise<RecipeMetadata | null> {
	// Check if WebSocket is available (may not be in Node.js dev environment)
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

		const subId = `og-${Date.now()}`;

		ws.onopen = () => {
			if (!ws || resolved) return;
			try {
				const req = JSON.stringify([
					'REQ',
					subId,
					{
						kinds: [30023],
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
					              evt.tags?.find((t: string[]) => t[0] === 'd')?.[1] || 'Recipe';
					const image = evt.tags?.find((t: string[]) => t[0] === 'image')?.[1] || '';
					const summary = evt.tags?.find((t: string[]) => t[0] === 'summary')?.[1] ||
					               (evt.content ? evt.content.slice(0, 200) + '...' : '');

					clearTimeout(timeout);
					safeResolve({ title, description: summary, image });
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

async function fetchRecipeMetadata(identifier: string, pubkey: string): Promise<RecipeMetadata | null> {
	// Try relays in parallel, return first successful result
	const results = await Promise.all(
		RELAYS.map(relay => fetchFromRelay(relay, identifier, pubkey))
	);

	return results.find(r => r !== null) || null;
}

export const load: PageServerLoad = async ({ params, url }) => {
	const naddr = params.naddr;

	// Strip tracking parameters - redirect to clean URL if present
	const hasTrackingParams = TRACKING_PARAMS.some(param => url.searchParams.has(param));
	if (hasTrackingParams) {
		throw redirect(301, `/r/${naddr}`);
	}

	// Validate naddr format
	if (!naddr?.startsWith('naddr1')) {
		throw redirect(302, '/recent');
	}

	// Skip if WebSocket is not available (e.g., some Node.js environments)
	if (typeof WebSocket === 'undefined') {
		return { ogMeta: null, naddr };
	}

	try {
		const decoded = nip19.decode(naddr);
		if (decoded.type !== 'naddr') {
			return { ogMeta: null, naddr };
		}

		const { identifier, pubkey } = decoded.data;
		
		// Add timeout to prevent hanging
		const metadataPromise = fetchRecipeMetadata(identifier, pubkey);
		const timeoutPromise = new Promise<null>((resolve) => 
			setTimeout(() => resolve(null), 5000)
		);
		
		const metadata = await Promise.race([metadataPromise, timeoutPromise]);

		if (metadata) {
			return {
				ogMeta: {
					title: `${metadata.title} - zap.cooking`,
					description: metadata.description || 'A delicious recipe on zap.cooking',
					image: metadata.image || 'https://zap.cooking/social-share.png'
				},
				naddr
			};
		}
	} catch (e) {
		// Log error but don't throw - return null to use fallback meta tags
		console.error('[OG Meta] Error:', e);
	}

	return { ogMeta: null, naddr };
};
