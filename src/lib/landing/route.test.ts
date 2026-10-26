import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LANDING_CACHE_CONTROL, isLandingPath, isLandingRoute } from './route';
import { NOSCRIPT_DARK_STYLE, landingJsonLd, ogImage } from './meta';
import { emptyLandingData } from './landingData.server';

describe('landing routes', () => {
	it('/explore is the landing route; its old preview and sub-paths are not', () => {
		expect(isLandingRoute('/explore')).toBe(true);
		expect(isLandingRoute('/explore/next')).toBe(false);
		expect(isLandingRoute('/explore/all')).toBe(false);
		expect(isLandingRoute('/feed')).toBe(false);
		expect(isLandingRoute(null)).toBe(false);
		expect(isLandingPath('/explore')).toBe(true);
		expect(isLandingPath('/explore/')).toBe(true);
		expect(isLandingPath('/explore/__data.json')).toBe(false);
		expect(isLandingPath('/explore/next')).toBe(false);
		expect(isLandingPath('/api/explore')).toBe(false);
	});

	it('is edge-cacheable for everyone (shared, never private)', () => {
		expect(LANDING_CACHE_CONTROL).toMatch(/\bpublic\b/);
		expect(LANDING_CACHE_CONTROL).toMatch(/s-maxage=180\b/);
		expect(LANDING_CACHE_CONTROL).not.toMatch(/private|no-store|no-cache/);
	});

});

describe('landing meta', () => {
	const cover = (image: string) => ({
		...emptyLandingData(1),
		cover: {
			type: 'recipe' as const,
			coordinate: 'c',
			href: '/recipe/naddr1x',
			title: 'Pie </script><script>alert(1)</script>',
			image,
			author: { pubkey: 'a'.repeat(64) },
			publishedAt: 1
		}
	});

	it('keeps no-JS dark logos and uses the shared OS fallback without overriding explicit modes or print', () => {
		expect(NOSCRIPT_DARK_STYLE).toContain('@media screen and (prefers-color-scheme: dark)');
		expect(NOSCRIPT_DARK_STYLE).toContain('.logo-l{display:none!important}.logo-d{display:block!important}');
		const palettes = readFileSync('src/lib/themes/palettes.css', 'utf8');
		expect(palettes).toMatch(/@media screen and \(prefers-color-scheme: dark\)\s*\{\s*html:root:not\(\[data-color-mode\]\):not\(\.dark\)/);
	});

	it('JSON-LD can never close its <script> early', () => {
		const ld = landingJsonLd(cover('https://image.nostr.build/a.jpg'));
		expect(ld).not.toContain('</');
		expect(JSON.parse(ld)['@graph'][1].mainEntity.itemListElement[0].url).toBe('https://zap.cooking/recipe/naddr1x');
	});

	it('og:image is the cover at 1200 px on fast hosts, the site card otherwise', () => {
		expect(ogImage(cover('https://image.nostr.build/a.jpg'))).toMatch(/^https:\/\/image\.nostr\.build\/a\.jpg\?w=1280/);
		expect(ogImage(cover('https://example.org/slow.jpg'))).toBe('https://zap.cooking/social-share.png');
		expect(ogImage(emptyLandingData())).toBe('https://zap.cooking/social-share.png');
	});
});
