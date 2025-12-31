import type { PageServerLoad } from './$types';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';

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
	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			ws.close();
			resolve(null);
		}, 3000); // 3 second timeout per relay

		const ws = new WebSocket(relayUrl);
		const subId = `og-${Date.now()}`;

		ws.on('open', () => {
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
		});

		ws.on('message', (data: Buffer) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
					const event = msg[2];
					const title = event.tags?.find((t: string[]) => t[0] === 'title')?.[1] ||
					              event.tags?.find((t: string[]) => t[0] === 'd')?.[1] || 'Recipe';
					const image = event.tags?.find((t: string[]) => t[0] === 'image')?.[1] || '';
					const summary = event.tags?.find((t: string[]) => t[0] === 'summary')?.[1] ||
					               (event.content ? event.content.slice(0, 200) + '...' : '');

					clearTimeout(timeout);
					ws.close();
					resolve({ title, description: summary, image });
				} else if (msg[0] === 'EOSE' && msg[1] === subId) {
					// End of stored events - no event found
					clearTimeout(timeout);
					ws.close();
					resolve(null);
				}
			} catch (e) {
				// Parse error, ignore
			}
		});

		ws.on('error', () => {
			clearTimeout(timeout);
			resolve(null);
		});

		ws.on('close', () => {
			clearTimeout(timeout);
		});
	});
}

async function fetchRecipeMetadata(identifier: string, pubkey: string): Promise<RecipeMetadata | null> {
	// Try relays in parallel, return first successful result
	const results = await Promise.all(
		RELAYS.map(relay => fetchFromRelay(relay, identifier, pubkey))
	);

	return results.find(r => r !== null) || null;
}

export const load: PageServerLoad = async ({ params }) => {
	const slug = params.slug;

	if (!slug?.startsWith('naddr1')) {
		return { ogMeta: null };
	}

	try {
		const decoded = nip19.decode(slug);
		if (decoded.type !== 'naddr') {
			return { ogMeta: null };
		}

		const { identifier, pubkey } = decoded.data;
		const metadata = await fetchRecipeMetadata(identifier, pubkey);

		if (metadata) {
			return {
				ogMeta: {
					title: `${metadata.title} - zap.cooking`,
					description: metadata.description || 'A delicious recipe on zap.cooking',
					image: metadata.image || 'https://zap.cooking/social-share.png'
				}
			};
		}
	} catch (e) {
		console.error('[OG Meta] Error:', e);
	}

	return { ogMeta: null };
};
