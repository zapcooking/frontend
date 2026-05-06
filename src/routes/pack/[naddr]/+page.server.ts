import type { PageServerLoad } from './$types';
import { nip19 } from 'nostr-tools';
import { redirect } from '@sveltejs/kit';
import { fetchPackMetadata, fetchRecipePreviews } from '$lib/recipePackOg.server';

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
// Static branded raster fallback. Used when a pack has no cover image
// AND no recipe in it has an image either. Real raster URL — works on
// every OG-supporting platform (Twitter/X, Facebook, LinkedIn, Signal,
// Slack, Discord, Telegram, iMessage).
const FALLBACK_IMAGE = '/social-share.png';

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
			image: `${baseUrl}${FALLBACK_IMAGE}`,
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

		// og:image needs to be a real raster image (PNG/JPG/WebP). Twitter/X,
		// Facebook, and LinkedIn don't render SVG og:image, so we point at:
		//   1. the pack's own cover image tag, if any
		//   2. otherwise, the first referenced recipe's image, if any
		//   3. otherwise, the static branded social-share.png
		// This matches the pattern that already works on /r/<naddr>.
		let imageUrl = meta.image || '';
		if (!imageUrl && meta.recipeATags.length > 0) {
			try {
				const previews = await fetchRecipePreviews(meta.recipeATags, 4);
				const firstWithImage = previews.find((r) => r.image);
				if (firstWithImage?.image) imageUrl = firstWithImage.image;
			} catch {
				/* tolerate failure — fall back to static */
			}
		}
		if (!imageUrl) imageUrl = `${baseUrl}${FALLBACK_IMAGE}`;

		return {
			ogMeta: {
				title:
					meta.title && meta.title !== FALLBACK_TITLE
						? `${title} — Recipe Pack on Zap Cooking`
						: FALLBACK_TITLE,
				description,
				image: imageUrl,
				url: `${baseUrl}/pack/${naddr}`
			},
			naddr
		};
	} catch (e) {
		console.error('[pack OG] error', e);
		return safeFallback(naddr, baseUrl);
	}
};
