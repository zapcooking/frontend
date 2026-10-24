import { describe, expect, it } from 'vitest';
import { EDITION_SECONDS, editionVariant, nextEditionHref, selectCollections, selectCover, selectLandingEdition } from './editions';
import { emptyLandingData, topicHref } from './landingData.server';
import { longformCard, type LongformCard } from './content';
import { ev, pk } from './fakeRelay.testutil';

function recipe(n: number, author = String(n), tags: string[] = []): LongformCard {
	return { type: 'recipe', coordinate: `recipe-${n}`, title: `Dish ${n}`, href: `/recipe/${n}`, image: `https://image.nostr.build/${n}.jpg`, author: { pubkey: author, name: `Cook ${author}` }, tags, publishedAt: n };
}
const pool = Array.from({ length: 16 }, (_, n) => recipe(n, String(n % 8)));

describe('six-hour editions', () => {
	it('is deterministic within an edition, moves at the boundary, and does not mutate the cache', () => {
		const before = JSON.stringify(pool);
		const current = selectCover(pool, 0);
		expect(selectCover(pool, EDITION_SECONDS - 1)).toEqual(current);
		expect(selectCover(pool, EDITION_SECONDS)).not.toEqual(current);
		expect(JSON.stringify(pool)).toBe(before);
	});
	it('selects three distinct authors and coordinates even when a cook has several approved recipes', () => {
		const cards = selectCover([recipe(0, 'a'), recipe(1, 'a'), recipe(2, 'b'), recipe(2, 'b'), recipe(3, 'c')], 0);
		expect(cards).toHaveLength(3);
		expect(new Set(cards.map((c) => c.author.pubkey)).size).toBe(3);
		expect(new Set(cards.map((c) => c.coordinate)).size).toBe(3);
	});
	it('prefers complementary author-supplied tags when available', () => {
		const cards = selectCover([recipe(0, 'a', ['pasta']), recipe(1, 'b', ['pasta']), recipe(2, 'c', ['drinks'])], 0);
		expect(cards[1].tags).toEqual(['drinks']);
	});
	it('uses fewer features for sparse pools, never padding an approved list with recent recipes', () => {
		expect(selectCover([], 0)).toEqual([]);
		expect(selectCover([recipe(0), recipe(1, '0')], 0)).toHaveLength(1);
		const data = { ...emptyLandingData(), coverPool: [recipe(0)], recipePool: pool };
		const result = selectLandingEdition(data, 0);
		expect(result.cover?.coordinate).toBe('recipe-0');
		expect(result.picks).toEqual([]);
	});
	it('offers bounded variations of the same pool and cycles ordinary links', () => {
		expect(selectCover(pool, 0, editionVariant('next'))).not.toEqual(selectCover(pool, 0));
		expect(editionVariant('9000')).toBe(0);
		expect(editionVariant('-1')).toBe(0);
		expect(nextEditionHref(null)).toBe('/explore?edition=next');
		expect(nextEditionHref('next')).toBe('/explore?edition=2');
		expect(nextEditionHref('2')).toBe('/explore?edition=3');
		expect(nextEditionHref('3')).toBe('/explore');
	});
	it('excludes cover recipes from every later recipe section and separates spotlights from dinner', () => {
		const data = { ...emptyLandingData(), coverPool: pool.slice(0, 4), recipePool: pool, reads: [pool[0]], cooks: [{ pubkey: '4', name: 'Cook 4', about: 'I bake bread.', href: '/user/4' }] };
		const result = selectLandingEdition(data, 0);
		const cards = [result.cover!, ...result.picks, ...result.newRecipes, ...result.spotlights.map((s) => s.recipe), ...result.reads];
		expect(new Set(cards.map((c) => c.coordinate)).size).toBe(cards.length);
		expect(result.spotlights[0].about).toBe('I bake bread.');
		expect(result.spotlights[0].recipe.author.pubkey).toBe('4');
	});
	it('never promotes unapproved old-cache fallback content, with no invented profile introduction', () => {
		const data = { ...emptyLandingData(), cover: pool[0], picks: [pool[1]], newRecipes: [pool[2]], cooks: [{ pubkey: '2', name: 'Cook', href: '/user/2' }] };
		const result = selectLandingEdition(data, 0);
		expect(result.cover).toBeNull();
		expect(result.spotlights).toEqual([]);
	});
});

describe('public collections', () => {
	it('normalizes real recipe metadata and uses it for public tag destinations', () => {
		const card = longformCard(ev({ kind: 30023, pubkey: pk('a'), tags: [['d', 'bread'], ['title', 'Bread'], ['image', 'https://image.nostr.build/bread.jpg'], ['t', 'zapcooking'], ['t', 'zapcooking-bread']] }))!;
		expect(card.tags).toEqual(['bread']);
		const tiles = selectCollections([card], 0);
		expect(tiles).toHaveLength(1);
		expect(tiles[0].href).toBe('/tag/bread');
		expect(topicHref('vegetables')).toBe('/tag/vegetables');
		expect(topicHref('fish & chips')).toBe('/tag/fish%20%26%20chips');
	});
	it('does not make up collection content or reuse an image and bounds the tile count', () => {
		expect(selectCollections([recipe(0)], 0)).toEqual([]);
		const tags = ['pasta', 'soup', 'bread', 'vegetables', 'drinks', 'dessert', 'breakfast'];
		const tiles = selectCollections(tags.map((t, n) => recipe(n, String(n), [t])), 0);
		expect(tiles).toHaveLength(6);
		expect(tiles.every((t) => t.href.startsWith('/tag/') && !t.href.includes('/feed'))).toBe(true);
		expect(new Set(tiles.map((t) => t.image)).size).toBe(tiles.length);
	});
	it('uses recurring date rules for seasonal collections', () => {
		const cards = [recipe(0, 'a', ['soup']), recipe(1, 'b', ['salad'])];
		expect(selectCollections(cards, Date.UTC(2026, 0, 15) / 1000).map((t) => t.slug)).toEqual(['soup']);
		expect(selectCollections(cards, Date.UTC(2027, 6, 15) / 1000).map((t) => t.slug)).toEqual(['salad']);
	});
});
