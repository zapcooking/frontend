import { describe, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';
import type { LandingEdition } from '$lib/landing/editions';

const getLandingData = vi.fn();
const getLandingPaid = vi.fn();
vi.mock('$lib/landing/landingData.server', async (importOriginal: () => Promise<unknown>) => ({
	...((await importOriginal()) as typeof import('$lib/landing/landingData.server')),
	getLandingData: (...a: unknown[]) => getLandingData(...a)
}));
vi.mock('$lib/landing/landingPaid.server', () => ({ getLandingPaid: (...a: unknown[]) => getLandingPaid(...a) }));
vi.mock('$lib/reads/moderation.server', () => ({ loadReadsModerationLists: async () => null }));

const mod = await import('./+page.server');
const { emptyLandingData } = await import('$lib/landing/landingData.server');

const boost = { id: 'b1', href: '/recipe/naddr1x', title: 'Paid pie', image: '', authorPubkey: 'a'.repeat(64), expiresAt: 1 };

async function run(search = '', personalization = '') {
	const headers: Record<string, string> = {};
	const out = (await mod.load({
		platform: { env: {}, ctx: { waitUntil: () => {} } },
		url: new URL(`https://zap.cooking/explore${search}`),
		request: new Request('https://zap.cooking/explore', { headers: { cookie: personalization } }),
		cookies: { get: () => { throw new Error('Shared landing HTML must not inspect visitor cookies'); } },
		setHeaders: (h: Record<string, string>) => Object.assign(headers, h)
	} as never)) as { landing: LandingEdition; paid: { boosts: unknown[] } };
	return { out, headers };
}

describe('/explore', () => {
	it('disables app hydration (csr = false) and is never prerendered', () => {
		expect(mod.csr).toBe(false);
		expect(mod.prerender).toBe(false);
	});

	it('is edge-cacheable and indexable (noindex dropped at the cutover)', async () => {
		getLandingData.mockResolvedValueOnce(emptyLandingData(1));
		getLandingPaid.mockResolvedValueOnce({ boosts: [], sponsors: [] });
		const { headers } = await run();
		expect(headers['cache-control']).toBe('public, max-age=60, s-maxage=180');
		expect(headers['x-robots-tag']).toBeUndefined();
	});

	it('returns identical public data and cache headers for different visitors', async () => {
		getLandingData.mockResolvedValue(emptyLandingData(1));
		getLandingPaid.mockResolvedValue({ boosts: [], sponsors: [] });
		const visitor = await run('', '');
		const member = await run('', 'membership=active; user=private-identity');
		expect(member).toEqual(visitor);
		expect(JSON.stringify(member)).not.toMatch(/private-identity|membership=active/);
	});

	it('keeps variants in public URLs and reuses the same aggregate-fetch arguments', async () => {
		getLandingData.mockClear();
		getLandingData.mockResolvedValue(emptyLandingData(1));
		getLandingPaid.mockResolvedValue({ boosts: [], sponsors: [] });
		await run();
		await run('?edition=next');
		for (const [args] of getLandingData.mock.calls) {
			expect(Object.keys(args).sort()).toEqual(['cache', 'moderation', 'waitUntil']);
		}
	});

	it('preserves the disclosed boost while excluding the same recipe from the cover', async () => {
		const address = { kind: 30023, pubkey: 'a'.repeat(64), identifier: 'paid-pie' };
		const plainHref = `/recipe/${nip19.naddrEncode(address)}`;
		const hintedHref = `/recipe/${nip19.naddrEncode({ ...address, relays: ['wss://feed.zap.cooking'] })}`;
		const card = { type: 'recipe' as const, coordinate: `30023:${address.pubkey}:paid-pie`, title: 'Pie', image: 'https://image.nostr.build/pie.jpg', author: { pubkey: address.pubkey }, publishedAt: 1, href: plainHref };
		const paidBoost = { ...boost, href: hintedHref };
		getLandingData.mockResolvedValueOnce({ ...emptyLandingData(1), coverPool: [card] });
		getLandingPaid.mockResolvedValueOnce({ boosts: [paidBoost], sponsors: [] });
		const { out } = await run();
		expect(out.landing.cover).toBeNull();
		expect(out.landing.picks).toEqual([]);
		expect(out.paid.boosts).toEqual([paidBoost]);
	});

	it('paid boosts render even when every relay section came back empty', async () => {
		getLandingData.mockResolvedValueOnce(emptyLandingData(1));
		getLandingPaid.mockResolvedValueOnce({ boosts: [boost], sponsors: [] });
		const { out } = await run();
		expect(out.paid.boosts).toEqual([boost]);
	});
});
