import { describe, expect, it, vi } from 'vitest';

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

async function run() {
	const headers: Record<string, string> = {};
	const out = (await mod.load({
		platform: { env: {}, ctx: { waitUntil: () => {} } },
		setHeaders: (h: Record<string, string>) => Object.assign(headers, h)
	} as never)) as { landing: unknown; paid: { boosts: unknown[] } };
	return { out, headers };
}

describe('/explore/next', () => {
	it('ships no client JS (csr = false) and is never prerendered', () => {
		expect(mod.csr).toBe(false);
		expect(mod.prerender).toBe(false);
	});

	it('is edge-cacheable and not indexed until the cutover', async () => {
		getLandingData.mockResolvedValueOnce(emptyLandingData(1));
		getLandingPaid.mockResolvedValueOnce({ boosts: [], sponsors: [] });
		const { headers } = await run();
		expect(headers['cache-control']).toBe('public, max-age=60, s-maxage=180');
		expect(headers['x-robots-tag']).toBe('noindex');
	});

	it('paid boosts render even when every relay section came back empty', async () => {
		getLandingData.mockResolvedValueOnce(emptyLandingData(1));
		getLandingPaid.mockResolvedValueOnce({ boosts: [boost], sponsors: [] });
		const { out } = await run();
		expect(out.paid.boosts).toEqual([boost]);
	});
});
