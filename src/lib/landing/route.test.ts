import { describe, expect, it } from 'vitest';
import { LANDING_CACHE_CONTROL, isLandingPath, isLandingRoute, stripFontPreload } from './route';
import { NOSCRIPT_DARK_STYLE, landingJsonLd, ogImage } from './meta';
import { emptyLandingData } from './landingData.server';

describe('landing routes', () => {
	it('only /explore/next is a landing route until the cutover', () => {
		expect(isLandingRoute('/explore/next')).toBe(true);
		expect(isLandingRoute('/explore')).toBe(false);
		expect(isLandingRoute('/feed')).toBe(false);
		expect(isLandingRoute(null)).toBe(false);
		expect(isLandingPath('/explore/next')).toBe(true);
		expect(isLandingPath('/explore/next/')).toBe(true);
		expect(isLandingPath('/explore/next/__data.json')).toBe(false);
		expect(isLandingPath('/api/explore/next')).toBe(false);
	});

	it('is edge-cacheable for everyone (shared, never private)', () => {
		expect(LANDING_CACHE_CONTROL).toMatch(/\bpublic\b/);
		expect(LANDING_CACHE_CONTROL).toMatch(/s-maxage=180\b/);
		expect(LANDING_CACHE_CONTROL).not.toMatch(/private|no-store|no-cache/);
	});

	it('drops the web-font preload and nothing else', () => {
		const head =
			'<link rel="icon" href="/favicon.svg" />\n' +
			'<link rel="preload" href="/fonts/albert-sans-var-latin.woff2" as="font" type="font/woff2" crossorigin />\n' +
			'<link rel="preload" as="image" href="https://x.test/a.jpg">';
		const out = stripFontPreload(head);
		expect(out).not.toContain('woff2');
		expect(out).toContain('rel="icon"');
		expect(out).toContain('as="image"');
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

	it('no-JS dark mode also lightens the footer Support link (orange-700 is 3.4:1 on #111827)', () => {
		expect(NOSCRIPT_DARK_STYLE).toContain('@media (prefers-color-scheme: dark)');
		expect(NOSCRIPT_DARK_STYLE).toMatch(/\.landing \.text-orange-700\{color:#fb923c!important\}/);
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
