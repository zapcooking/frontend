import type { PageServerLoad } from './$types';
import { nip19 } from 'nostr-tools';

interface RecipeMetadata {
	title: string;
	description: string;
	image: string;
}

async function fetchRecipeFromRelay(identifier: string, pubkey: string): Promise<RecipeMetadata | null> {
	// Try fetching from Primal's cache API (HTTP-based, works server-side)
	try {
		const response = await fetch('https://primal.net/api', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([
				'REQ',
				'og-meta',
				{
					kinds: [30023],
					authors: [pubkey],
					'#d': [identifier],
					limit: 1
				}
			])
		});

		if (response.ok) {
			const data = await response.json();
			// Primal returns array of events
			if (Array.isArray(data)) {
				const event = data.find((item: any) => item?.kind === 30023);
				if (event) {
					const title = event.tags?.find((t: string[]) => t[0] === 'title')?.[1] ||
					              event.tags?.find((t: string[]) => t[0] === 'd')?.[1] || 'Recipe';
					const image = event.tags?.find((t: string[]) => t[0] === 'image')?.[1] || '';
					const summary = event.tags?.find((t: string[]) => t[0] === 'summary')?.[1] ||
					               (event.content ? event.content.slice(0, 200) + '...' : '');

					return { title, description: summary, image };
				}
			}
		}
	} catch (e) {
		console.error('[OG Meta] Primal API error:', e);
	}

	// Fallback: Try nostr.band API
	try {
		const naddrForApi = nip19.naddrEncode({ identifier, pubkey, kind: 30023 });
		const response = await fetch(`https://api.nostr.band/v0/event/${naddrForApi}`);

		if (response.ok) {
			const data = await response.json();
			if (data?.event) {
				const event = data.event;
				const title = event.tags?.find((t: string[]) => t[0] === 'title')?.[1] ||
				              event.tags?.find((t: string[]) => t[0] === 'd')?.[1] || 'Recipe';
				const image = event.tags?.find((t: string[]) => t[0] === 'image')?.[1] || '';
				const summary = event.tags?.find((t: string[]) => t[0] === 'summary')?.[1] ||
				               (event.content ? event.content.slice(0, 200) + '...' : '');

				return { title, description: summary, image };
			}
		}
	} catch (e) {
		console.error('[OG Meta] nostr.band API error:', e);
	}

	return null;
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
		const metadata = await fetchRecipeFromRelay(identifier, pubkey);

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
		console.error('[OG Meta] Error decoding naddr:', e);
	}

	return { ogMeta: null };
};
