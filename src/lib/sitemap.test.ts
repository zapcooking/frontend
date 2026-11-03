import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROBOTS_DISALLOW, SITEMAP_PATHS, buildRobotsTxt, buildSitemapXml, curatedTagPaths } from './sitemap';

describe('sitemap.xml', () => {
	it('is a valid urlset with absolute, escaped URLs and no duplicates', () => {
		const xml = buildSitemapXml();
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
		const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
		expect(locs.every((l) => l.startsWith('https://zap.cooking/'))).toBe(true);
		expect(new Set(locs).size).toBe(locs.length);
		expect(locs).toContain('https://zap.cooking/explore');
		expect(buildSitemapXml('https://x.test', ['/a?b=1&c=2'])).toContain('<loc>https://x.test/a?b=1&amp;c=2</loc>');
	});

	it('lists every curated tag page once, and never the unindexed preview', () => {
		const tags = curatedTagPaths();
		expect(tags).toContain('/tag/Japanese');
		expect(new Set(tags).size).toBe(tags.length);
		expect(tags).toContain('/tag/Middle-Eastern');
		expect(buildSitemapXml()).not.toContain('/explore/next');
	});

	it('only lists routes that exist', () => {
		for (const p of SITEMAP_PATHS) {
			expect(existsSync(resolve('src/routes', p.slice(1))), p).toBe(true);
		}
	});

	it('never lists a path robots.txt disallows', () => {
		for (const p of SITEMAP_PATHS) {
			expect(ROBOTS_DISALLOW.some((d) => p.startsWith(d)), p).toBe(false);
		}
	});
});

describe('robots.txt', () => {
	it('allows the site, keeps crawlers out of per-user and API paths, points at the sitemap', () => {
		const txt = buildRobotsTxt();
		expect(txt).toMatch(/^User-agent: \*\nAllow: \/\n/);
		expect(txt).toContain('Disallow: /api/\n');
		expect(txt).toContain('Disallow: /settings\n');
		expect(txt).toContain('Sitemap: https://zap.cooking/sitemap.xml\n');
		expect(txt).not.toMatch(/Disallow: \/\n/);
	});
});
