import type { PageServerLoad } from './$types';
import { nip19 } from 'nostr-tools';
import { redirect } from '@sveltejs/kit';
import { fetchPackMetadata } from '$lib/recipePackOg.server';

const TRACKING_PARAMS = [
	'fbclid',
	'gclid',
	'msclkid',
	'utm_source',
	'utm_medium',
	'utm_campaign',
	'utm_term',
	'utm_content',
	'ref',
	'source'
];

const FALLBACK_TITLE = 'Recipe Pack on Zap Cooking';
const FALLBACK_DESCRIPTION = 'A zappable recipe collection curated on Zap Cooking.';
const FALLBACK_IMAGE = 'https://zap.cooking/social-share.png';

interface PackOgMeta {
	title: string;
	description: string;
	image: string;
	url: string;
}

function safeFallback(naddr: string, baseUrl: string): { ogMeta: PackOgMeta; naddr: string } {
	return {
		ogMeta: {
			title: FALLBACK_TITLE,
			description: FALLBACK_DESCRIPTION,
			image: `${baseUrl}/api/og/recipe-pack/${naddr}`,
			url: `${baseUrl}/pack/${naddr}`
		},
		naddr
	};
}

export const load: PageServerLoad = async ({ params, url }) => {
	const naddr = params.naddr;

	// Drop tracking params for clean canonical URLs
	const hasTrackingParams = TRACKING_PARAMS.some((p) => url.searchParams.has(p));
	if (hasTrackingParams) throw redirect(301, `/pack/${naddr}`);

	const baseUrl = url.origin;

	if (!naddr?.startsWith('naddr1')) {
		// Page itself will render a 'not found' state; still emit safe OG.
		return safeFallback(naddr, baseUrl);
	}

	let pointer: nip19.AddressPointer | null = null;
	try {
		const decoded = nip19.decode(naddr);
		if (decoded.type === 'naddr') {
			pointer = decoded.data as nip19.AddressPointer;
		}
	} catch {
		/* fall through to fallback */
	}
	if (!pointer) return safeFallback(naddr, baseUrl);

	try {
		const meta = await fetchPackMetadata(pointer.pubkey, pointer.identifier, pointer.kind);
		if (!meta) return safeFallback(naddr, baseUrl);

		const title = meta.title || FALLBACK_TITLE;
		const recipeWord = meta.recipeCount === 1 ? 'recipe' : 'recipes';
		const description = meta.description
			? meta.description.length > 200
				? meta.description.slice(0, 197) + '…'
				: meta.description
			: meta.recipeCount > 0
				? `A zappable Recipe Pack with ${meta.recipeCount} ${recipeWord}, curated on Zap Cooking.`
				: FALLBACK_DESCRIPTION;

		// Always use the dynamic OG endpoint as og:image — it composes the
		// branded card and falls back to the pack's cover or static image
		// internally. This way social platforms always get consistent
		// branding rather than a raw recipe photo.
		const ogImage = `${baseUrl}/api/og/recipe-pack/${naddr}`;

		return {
			ogMeta: {
				title:
					meta.title && meta.title !== FALLBACK_TITLE
						? `${title} — Recipe Pack on Zap Cooking`
						: FALLBACK_TITLE,
				description,
				image: ogImage,
				url: `${baseUrl}/pack/${naddr}`
			},
			naddr
		};
	} catch (e) {
		console.error('[pack OG] error', e);
		return safeFallback(naddr, baseUrl);
	}
};

