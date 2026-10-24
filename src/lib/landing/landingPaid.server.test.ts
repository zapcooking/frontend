import { describe, expect, it, vi } from 'vitest';

const boosts = vi.fn();
const sponsors = vi.fn();
vi.mock('$lib/boostStore.server', () => ({ getActiveBoosts: (...a: unknown[]) => boosts(...a) }));
vi.mock('$lib/sponsorStore.server', () => ({ getActiveSponsors: (...a: unknown[]) => sponsors(...a) }));

const { getLandingPaid } = await import('./landingPaid.server');

const boost = (over: Record<string, unknown> = {}) => ({
	id: 'b1',
	naddr: 'naddr1qqtest',
	recipeTitle: 'Paid pie',
	recipeImage: 'https://image.nostr.build/pie.jpg',
	authorPubkey: 'a'.repeat(64),
	expiresAt: 123,
	...over
});
const sponsor = (over: Record<string, unknown> = {}) => ({
	id: 's1',
	title: 'Spices',
	description: 'Good spices',
	imageUrl: 'https://x.test/s.png',
	linkUrl: 'https://x.test',
	...over
});

describe('getLandingPaid', () => {
	it('renders active boosts and headline sponsors from KV', async () => {
		boosts.mockResolvedValueOnce([boost()]);
		sponsors.mockResolvedValueOnce([sponsor()]);
		const r = await getLandingPaid(null);
		expect(r.boosts).toEqual([
			{ id: 'b1', href: '/recipe/naddr1qqtest', title: 'Paid pie', image: 'https://image.nostr.build/pie.jpg', authorPubkey: 'a'.repeat(64), expiresAt: 123 }
		]);
		expect(r.sponsors[0].linkUrl).toBe('https://x.test');
		expect(sponsors).toHaveBeenCalledWith(null, 'headline');
	});

	it('a failing sponsor read never hides paid boosts (and vice versa)', async () => {
		boosts.mockResolvedValueOnce([boost()]);
		sponsors.mockRejectedValueOnce(new Error('kv'));
		expect((await getLandingPaid(null)).boosts).toHaveLength(1);
		boosts.mockRejectedValueOnce(new Error('kv'));
		sponsors.mockResolvedValueOnce([sponsor()]);
		expect((await getLandingPaid(null)).sponsors).toHaveLength(1);
	});

	it('drops unsafe links and malformed boosts, keeps http sponsors', async () => {
		boosts.mockResolvedValueOnce([boost({ naddr: 'javascript:alert(1)' }), boost({ id: 'b2', recipeImage: 'data:x' })]);
		sponsors.mockResolvedValueOnce([sponsor({ linkUrl: 'javascript:alert(1)' }), sponsor({ id: 's2', linkUrl: 'http://old.test' })]);
		const r = await getLandingPaid(null);
		expect(r.boosts.map((b) => [b.id, b.image])).toEqual([['b2', '']]);
		expect(r.sponsors.map((s) => s.id)).toEqual(['s2']);
	});
});
