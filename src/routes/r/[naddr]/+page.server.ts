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

async function fetchFromRelay(relayUrl: string, identifier: string, pubkey: string, kind: number = 30023): Promise<RecipeMetadata | null> {
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
					              evt.tags?.find((t: string[]) => t[0] === 'd')?.[1] || 'Recipe';
					const image = evt.tags?.find((t: string[]) => t[0] === 'image')?.[1] || '';
					
					// Extract description: prefer summary tag, then clean content
					let description = evt.tags?.find((t: string[]) => t[0] === 'summary')?.[1];
					if (!description && evt.content) {
						// Clean markdown and get first meaningful text
						let text = evt.content
							.replace(/^#+\s+/gm, '') // Remove markdown headers
							.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Convert links to text
							.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '') // Remove images
							.replace(/\*\*([^\*]+)\*\*/g, '$1') // Remove bold
							.replace(/\*([^\*]+)\*/g, '$1') // Remove italic
							.replace(/`([^`]+)`/g, '$1') // Remove code
							.replace(/\n+/g, ' ') // Replace newlines with spaces
							.trim();
						
						// Get first 200 characters, but try to end at a sentence
						if (text.length > 200) {
							const truncated = text.slice(0, 200);
							const lastPeriod = truncated.lastIndexOf('.');
							const lastExclamation = truncated.lastIndexOf('!');
							const lastQuestion = truncated.lastIndexOf('?');
							const lastSentence = Math.max(lastPeriod, lastExclamation, lastQuestion);
							if (lastSentence > 100) {
								description = text.slice(0, lastSentence + 1);
							} else {
								description = truncated + '...';
							}
						} else {
							description = text;
						}
					}
					
					if (!description) {
						description = `A delicious recipe shared on zap.cooking`;
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

async function fetchRecipeMetadata(identifier: string, pubkey: string, kind: number = 30023): Promise<RecipeMetadata | null> {
	// Try relays in parallel, return first successful result
	const results = await Promise.all(
		RELAYS.map(relay => fetchFromRelay(relay, identifier, pubkey, kind))
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
		return {
			ogMeta: {
				title: 'Recipe - zap.cooking',
				description: 'A recipe shared on zap.cooking - Food. Friends. Freedom.',
				image: 'https://zap.cooking/social-share.png'
			},
			naddr
		};
	}

	try {
		const decoded = nip19.decode(naddr);
		if (decoded.type !== 'naddr') {
			// Invalid naddr format, return fallback
			return {
				ogMeta: {
					title: 'Recipe - zap.cooking',
					description: 'A recipe shared on zap.cooking - Food. Friends. Freedom.',
					image: 'https://zap.cooking/social-share.png'
				},
				naddr
			};
		}

		const { identifier, pubkey, kind } = decoded.data;
		
		// Support both regular recipes (30023) and premium recipes (35000)
		const recipeKind = kind === GATED_RECIPE_KIND ? GATED_RECIPE_KIND : 30023;
		
		// Add timeout to prevent hanging
		const metadataPromise = fetchRecipeMetadata(identifier, pubkey, recipeKind);
		const timeoutPromise = new Promise<null>((resolve) => 
			setTimeout(() => resolve(null), 5000)
		);
		
		const metadata = await Promise.race([metadataPromise, timeoutPromise]);

		if (metadata) {
			return {
				ogMeta: {
					title: `${metadata.title} - zap.cooking`,
					description: metadata.description || 'A delicious recipe shared on zap.cooking',
					image: metadata.image || 'https://zap.cooking/social-share.png'
				},
				naddr
			};
		}
		
		// Even if metadata fetch failed, provide basic fallback
		return {
			ogMeta: {
				title: 'Recipe - zap.cooking',
				description: 'A recipe shared on zap.cooking - Food. Friends. Freedom.',
				image: 'https://zap.cooking/social-share.png'
			},
			naddr
		};
	} catch (e) {
		// Log error but don't throw - return fallback meta tags
		console.error('[OG Meta] Error:', e);
	}

	// Final fallback - at least provide something useful
	return { 
		ogMeta: {
			title: 'Recipe - zap.cooking',
			description: 'A recipe shared on zap.cooking - Food. Friends. Freedom.',
			image: 'https://zap.cooking/social-share.png'
		},
		naddr 
	};
};
