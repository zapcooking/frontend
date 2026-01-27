import type { PageServerLoad } from './$types';
import { nip19 } from 'nostr-tools';
import { redirect } from '@sveltejs/kit';
import { ARTICLE_TAG } from '$lib/articleEditor';

// Tracking parameters to strip
const TRACKING_PARAMS = [
	'fbclid', 'gclid', 'msclkid',
	'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
	'ref', 'source'
];

interface ArticleMetadata {
	title: string;
	description: string;
	image: string;
}

const RELAYS = [
	'wss://relay.primal.net',
	'wss://relay.damus.io',
	'wss://nos.lol'
];

async function fetchFromRelay(relayUrl: string, identifier: string, pubkey: string, kind: number = 30023): Promise<ArticleMetadata | null> {
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

		const safeResolve = (value: ArticleMetadata | null) => {
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
					
					// Verify it's an article (has zapreads tag)
					const tags = evt.tags || [];
					const hasZapreadsTag = tags.some((t: string[]) => t[0] === 't' && t[1] === ARTICLE_TAG);
					if (!hasZapreadsTag) {
						clearTimeout(timeout);
						safeResolve(null);
						return;
					}
					
					const title = tags.find((t: string[]) => t[0] === 'title')?.[1] ||
					              tags.find((t: string[]) => t[0] === 'd')?.[1] || 'Article';
					const image = tags.find((t: string[]) => t[0] === 'image')?.[1] || '';
					
					// Extract description: prefer summary tag, then clean content
					let description = tags.find((t: string[]) => t[0] === 'summary')?.[1];
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
						description = `An article shared on zap.cooking`;
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

async function fetchArticleMetadata(identifier: string, pubkey: string, kind: number = 30023): Promise<ArticleMetadata | null> {
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
		throw redirect(301, `/reads/${naddr}`);
	}

	// Validate naddr format
	if (!naddr?.startsWith('naddr1')) {
		throw redirect(302, '/reads');
	}

	// Skip if WebSocket is not available (e.g., some Node.js environments)
	if (typeof WebSocket === 'undefined') {
		return {
			ogMeta: {
				title: 'Article - zap.cooking',
				description: 'An article shared on zap.cooking',
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
					title: 'Article - zap.cooking',
					description: 'An article shared on zap.cooking',
					image: 'https://zap.cooking/social-share.png'
				},
				naddr
			};
		}

		const { identifier, pubkey, kind } = decoded.data;
		
		// Articles are always kind 30023
		const articleKind = 30023;
		
		// Add timeout to prevent hanging
		const metadataPromise = fetchArticleMetadata(identifier, pubkey, articleKind);
		const timeoutPromise = new Promise<null>((resolve) => 
			setTimeout(() => resolve(null), 5000)
		);
		
		const metadata = await Promise.race([metadataPromise, timeoutPromise]);

		if (metadata) {
			return {
				ogMeta: {
					title: `${metadata.title} - zap.cooking`,
					description: metadata.description || 'An article shared on zap.cooking',
					image: metadata.image || 'https://zap.cooking/social-share.png'
				},
				naddr
			};
		}
		
		// Even if metadata fetch failed, provide basic fallback
		return {
			ogMeta: {
				title: 'Article - zap.cooking',
				description: 'An article shared on zap.cooking',
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
			title: 'Article - zap.cooking',
			description: 'An article shared on zap.cooking',
			image: 'https://zap.cooking/social-share.png'
		},
		naddr 
	};
};
