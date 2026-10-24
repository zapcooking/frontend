/**
 * robots.txt and sitemap.xml (pure; prerendered by their routes).
 *
 * The sitemap lists the public pages and the curated tag pages. Recipe and
 * article URLs aren't in it yet: they live on relays, not in the build.
 */

import { CURATED_TAG_SECTIONS } from '$lib/consts';

export const SITE_ORIGIN = 'https://zap.cooking';

/** Public pages with server-rendered content worth indexing. */
export const SITEMAP_PATHS: readonly string[] = [
	'/explore',
	'/recipes',
	'/recent',
	'/feed',
	'/reads',
	'/packs',
	'/community',
	'/membership',
	'/about',
	'/founders',
	'/sponsors',
	'/sponsor-terms',
	'/support',
	'/pow',
	'/terms',
	'/privacy',
	'/child-safety',
	'/disclosure'
];

/** Signed-in, per-user, admin or tooling surfaces: never worth crawling. */
export const ROBOTS_DISALLOW: readonly string[] = [
	'/api/',
	'/admin',
	'/debug',
	'/dev',
	'/settings',
	'/wallet',
	'/messages',
	'/notifications',
	'/drafts',
	'/my-kitchen',
	'/my-store',
	'/delete-account',
	'/onboarding'
];

/** `/tag/<Tag>` for every curated tag, de-duplicated (some appear in two groups). */
export function curatedTagPaths(): string[] {
	const seen = new Set<string>();
	for (const section of CURATED_TAG_SECTIONS) {
		for (const tag of section.tags) seen.add(`/tag/${encodeURIComponent(tag)}`);
	}
	return [...seen];
}

const escapeXml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildSitemapXml(origin = SITE_ORIGIN, paths: readonly string[] = [...SITEMAP_PATHS, ...curatedTagPaths()]): string {
	const urls = paths.map((p) => `  <url><loc>${escapeXml(origin + p)}</loc></url>`).join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function buildRobotsTxt(origin = SITE_ORIGIN): string {
	return [
		'User-agent: *',
		'Allow: /',
		...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`),
		'',
		`Sitemap: ${origin}/sitemap.xml`,
		''
	].join('\n');
}
