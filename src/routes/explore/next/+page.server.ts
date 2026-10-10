import type { PageServerLoad } from './$types';
import { getLandingData } from '$lib/landing/landingData.server';
import { getLandingPaid } from '$lib/landing/landingPaid.server';
import { loadReadsModerationLists } from '$lib/reads/moderation.server';
import { LANDING_CACHE_CONTROL } from '$lib/landing/route';

// Server-rendered, no client JS: no hydration, no __data.json, no NDK.
export const csr = false;
export const prerender = false;

export const load: PageServerLoad = async ({ platform, setHeaders }) => {
	const kv = (platform?.env?.GATED_CONTENT ?? null) as Parameters<typeof getLandingPaid>[0];
	const cache =
		typeof caches !== 'undefined' ? ((caches as unknown as { default?: Cache }).default ?? null) : null;
	const ctx = platform?.ctx;
	const waitUntil = ctx ? (p: Promise<unknown>) => ctx.waitUntil(p) : undefined;

	const [moderation, paid] = await Promise.all([
		loadReadsModerationLists(kv as Parameters<typeof loadReadsModerationLists>[0]).catch(() => null),
		getLandingPaid(kv)
	]);
	const landing = await getLandingData({ cache, waitUntil, moderation });

	setHeaders({
		'cache-control': LANDING_CACHE_CONTROL,
		// Not indexed until the cutover replaces /explore.
		'x-robots-tag': 'noindex'
	});
	return { landing, paid };
};
