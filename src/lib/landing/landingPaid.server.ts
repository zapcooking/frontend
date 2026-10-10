/**
 * Paid placements on the /explore landing page, read server-side from KV
 * (GATED_CONTENT) on every page render, independent of any relay: a paid
 * boost or sponsor never disappears because a relay fetch failed. With the
 * page's edge TTL, a placement starts and ends within ~3 minutes of its
 * KV state.
 */

import { getActiveBoosts, type BoostKV } from '$lib/boostStore.server';
import { getActiveSponsors, type SponsorKV } from '$lib/sponsorStore.server';

export interface BoostCard {
	id: string;
	href: string;
	title: string;
	image: string;
	authorPubkey: string;
	expiresAt: number | null;
}

export interface SponsorCard {
	id: string;
	title: string;
	description: string;
	imageUrl: string;
	linkUrl: string;
}

export interface LandingPaid {
	boosts: BoostCard[];
	sponsors: SponsorCard[];
}

/** http(s) URLs only (never javascript:/data:); '' otherwise. */
const webUrl = (u: string | undefined) => {
	try {
		const p = u ? new URL(u).protocol : '';
		return p === 'https:' || p === 'http:' ? u! : '';
	} catch {
		return '';
	}
};

export async function getLandingPaid(kv: (BoostKV & SponsorKV) | null): Promise<LandingPaid> {
	const [boosts, sponsors] = await Promise.all([
		getActiveBoosts(kv).catch((err) => {
			console.error('[landing] boosts read failed:', err);
			return [];
		}),
		getActiveSponsors(kv, 'headline').catch((err) => {
			console.error('[landing] sponsors read failed:', err);
			return [];
		})
	]);
	return {
		boosts: boosts
			.filter((b) => typeof b.naddr === 'string' && b.naddr.startsWith('naddr1'))
			.map((b) => ({
				id: b.id,
				href: `/recipe/${b.naddr}`,
				title: b.recipeTitle || 'Boosted recipe',
				image: webUrl(b.recipeImage),
				authorPubkey: b.authorPubkey,
				expiresAt: b.expiresAt
			})),
		sponsors: sponsors
			.filter((s) => webUrl(s.linkUrl))
			.map((s) => ({
				id: s.id,
				title: s.title,
				description: s.description,
				imageUrl: webUrl(s.imageUrl),
				linkUrl: s.linkUrl
			}))
	};
}
