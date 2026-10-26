/**
 * The landing page's head: one set of OG/Twitter tags (the root layout
 * emits none for landing routes), JSON-LD, and dark tokens for readers
 * without JavaScript (the theme script can't run for them).
 */

import { optimizeImageUrl, imageRoute } from '$lib/imageOptimizer';
import type { LandingData } from './landingData.server';
import { EDITORIAL_SUPPORTING_LINE } from './editorialConfig';

export const SITE = 'https://zap.cooking';
export const LANDING_CANONICAL = `${SITE}/explore`;
const DEFAULT_IMAGE = `${SITE}/social-share.png`;

/** The Android app (there is no iOS App Store listing). */
export const ANDROID_APP_URL = 'https://play.google.com/store/apps/details?id=cooking.zap.app';

export interface LandingMeta {
	title: string;
	description: string;
	canonical: string;
	image: string;
}

const absolute = (u: string) => (u.startsWith('/') ? `${SITE}${u}` : u);

/** The cover photo at 1200 px (fast-resize hosts only), else the site card. */
export function ogImage(d: Pick<LandingData, 'cover'>): string {
	const img = d.cover?.image;
	if (!img) return DEFAULT_IMAGE;
	const route = imageRoute(img);
	if (route !== 'cloudflare' && route !== 'native') return DEFAULT_IMAGE;
	return absolute(optimizeImageUrl(img, { width: 1200 }));
}

export function landingMeta(d: Pick<LandingData, 'cover'>): LandingMeta {
	return {
		title: 'Zap Cooking: recipes, cooks and food stories',
		description: EDITORIAL_SUPPORTING_LINE,
		canonical: LANDING_CANONICAL,
		image: ogImage(d)
	};
}

/** JSON-LD for the page, safe to inline in a <script> (no `</`). */
export function landingJsonLd(d: Pick<LandingData, 'cover' | 'picks' | 'reads'>): string {
	const items = [d.cover, ...d.picks, ...d.reads].filter((c): c is NonNullable<typeof c> => !!c);
	const doc = {
		'@context': 'https://schema.org',
		'@graph': [
			{
				'@type': 'Organization',
				'@id': `${SITE}/#org`,
				name: 'Zap Cooking',
				url: SITE,
				logo: `${SITE}/favicon.svg`,
				sameAs: [ANDROID_APP_URL]
			},
			{
				'@type': 'CollectionPage',
				'@id': LANDING_CANONICAL,
				url: LANDING_CANONICAL,
				name: 'Explore Zap Cooking',
				publisher: { '@id': `${SITE}/#org` },
				mainEntity: {
					'@type': 'ItemList',
					itemListElement: items.map((c, i) => ({
						'@type': 'ListItem',
						position: i + 1,
						url: `${SITE}${c.href}`,
						name: c.title,
						image: c.image
					}))
				}
			}
		]
	};
	return JSON.stringify(doc).replace(/</g, '\\u003c');
}

/**
 * The shared palette follows the OS without JavaScript. Logo selection still
 * needs this fallback because the usual dark selectors depend on html.dark.
 */
export const NOSCRIPT_DARK_STYLE =
	'<noscript><style>@media screen and (prefers-color-scheme: dark){' +
	'.logo-l{display:none!important}.logo-d{display:block!important}' +
	'}</style></noscript>';
