/**
 * The landing page's head: one set of OG/Twitter tags (the root layout
 * emits none for landing routes), JSON-LD, and dark tokens for readers
 * without JavaScript (the theme script can't run for them).
 */

import { optimizeImageUrl, imageRoute } from '$lib/imageOptimizer';
import type { LandingData } from './landingData.server';

export const SITE = 'https://zap.cooking';
export const LANDING_CANONICAL = `${SITE}/explore`;
const DEFAULT_IMAGE = `${SITE}/social-share.png`;

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
		description:
			'Cook from thousands of open recipes, follow the people who make them, and read the best food writing on Nostr.',
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
				logo: `${SITE}/favicon.svg`
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
 * Readers without JavaScript never get `html.dark`, so follow the OS.
 * Mirrors the dark tokens in app.css that the landing page uses; doubled
 * selectors because app.css loads after this and would win a tie.
 */
export const NOSCRIPT_DARK_STYLE =
	'<noscript><style>@media (prefers-color-scheme: dark){:root:root{' +
	'--color-primary:#ff5722;--color-input-border:#4b5563;--color-caption:#94a3b8;' +
	'--color-text-primary:#f3f4f6;--color-text-secondary:#d1d5db;--color-bg-primary:#111827;' +
	'--color-bg-secondary:#1f2937;--color-card-sunken:#0c111c}' +
	'html .landing.landing.landing{--landing-accent-text:#ff8a5c}' +
	'.logo-l{display:none!important}.logo-d{display:block!important}' +
	'body{background-color:#111827}}</style></noscript>';
