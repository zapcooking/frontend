import type { PageServerLoad } from './$types';
import { getLandingData, moderateLandingData } from '$lib/landing/landingData.server';
import { getLandingPaid } from '$lib/landing/landingPaid.server';
import { formatCoordinate } from '$lib/coordinate';
import { decodeNaddr } from '$lib/reads/moderation';
import { loadReadsModerationLists } from '$lib/reads/moderation.server';
import { nextEditionHref, selectLandingEdition } from '$lib/landing/editions';
import { LANDING_CACHE_CONTROL } from '$lib/landing/route';

// Server-rendered without app hydration or NDK; isolated form enhancements are separate.
export const csr = false;
export const prerender = false;

export const load: PageServerLoad = async ({ platform, setHeaders, url }) => {
	const kv = (platform?.env?.GATED_CONTENT ?? null) as Parameters<typeof getLandingPaid>[0];
	const cache =
		typeof caches !== 'undefined' ? ((caches as unknown as { default?: Cache }).default ?? null) : null;
	const ctx = platform?.ctx;
	const waitUntil = ctx ? (p: Promise<unknown>) => ctx.waitUntil(p) : undefined;

	const [moderation, paid] = await Promise.all([
		loadReadsModerationLists(kv as Parameters<typeof loadReadsModerationLists>[0]).catch(() => null),
		getLandingPaid(kv)
	]);
	const pool = await getLandingData({ cache, waitUntil, moderation });
	const variant = url?.searchParams.get('edition');
	// Keep a paid placement in its disclosed section, never repeat it on the cover.
	// Decode addresses too: relay hints can spell the same recipe with another naddr.
	const paidCoordinates = new Set(paid.boosts.flatMap((boost) => {
		const address = decodeNaddr(boost.href.replace(/^\/recipe\//, '').replace(/[?#/].*$/, ''));
		return address ? [formatCoordinate(address)] : [];
	}));
	const paidHrefs = new Set(paid.boosts.map((boost) => boost.href.replace(/[?#].*$/, '').replace(/\/$/, '')));
	const moderated = moderateLandingData(pool, moderation);
	const editorial = {
		...moderated,
		coverPool: moderated.coverPool?.filter((card) =>
			!paidCoordinates.has(card.coordinate) && !paidHrefs.has(card.href.replace(/[?#].*$/, '').replace(/\/$/, ''))
		)
	};
	const landing = selectLandingEdition(editorial, Math.floor(Date.now() / 1000), variant);

	setHeaders({ 'cache-control': LANDING_CACHE_CONTROL });
	return { landing, paid, nextEditionHref: nextEditionHref(variant) };
};
