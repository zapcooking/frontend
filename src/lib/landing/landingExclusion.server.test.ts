import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	FEED_RELAY,
	FRESH_FOR_MS,
	HERO_FALLBACK_RELAYS,
	LIST_RELAYS,
	PROFILE_RELAYS,
	RECIPE_FETCH_LIMIT,
	RECIPE_FETCH_LIMIT_WITH_EXCLUSIONS,
	__resetLandingMemo,
	buildLandingData,
	getLandingData,
	mergeWithLastGood,
	moderateLandingData,
	withoutExcludedAuthors,
	type CacheLike,
	type LandingData
} from './landingData.server';
import { ORG_PUBKEY } from './curation';
import { selectLandingEdition } from './editions';
import { standardRelays } from '$lib/consts';
import { FakeWebSocket, ev, pk, relay, relays, testVerify } from './fakeRelay.testutil';

/**
 * An author held out of discovery ($lib/discovery/config) never reaches the
 * /explore homepage: not from a build, not from the cache, not from "last
 * good" data. Removing the entry brings them back.
 */

const NOW = 1_800_000_000;
const IMG = (n: string) => `https://image.nostr.build/${n}.jpg`;
const ARCHIVER = pk('a');
const COOK = pk('c');
const EXCLUDED: ReadonlySet<string> = new Set([ARCHIVER]);
const NOBODY: ReadonlySet<string> = new Set();

function recipe(d: string, author: string, published: number) {
	return ev({
		kind: 30023,
		pubkey: author,
		created_at: published,
		tags: [['d', d], ['title', `Recipe ${d}`], ['image', IMG(d)], ['t', 'zapcooking'], ['published_at', String(published)]]
	});
}
const orgList = (kind: number, d: string, tags: string[][]) =>
	ev({ kind, pubkey: ORG_PUBKEY, sig: 'valid', created_at: NOW - 100, tags: [['d', d], ...tags] });
const profile = (who: string, name: string) =>
	ev({ kind: 0, pubkey: who, content: JSON.stringify({ name, picture: IMG(name) }) });

/** The archiver's recipes are the newest by far; six other cooks follow. */
function seed() {
	const others = ['1', '2', '3', '4', '5', '6'].map((c, i) => recipe(`cook-${c}`, pk(c), NOW - 50_000 - i * 1000));
	const feed = relay(FEED_RELAY, [
		...Array.from({ length: 12 }, (_, i) => recipe(`archived-${i}`, ARCHIVER, NOW - 100 - i * 10)),
		...others,
		recipe('editors-choice', COOK, NOW - 900_000),
		ev({ kind: 1, pubkey: ARCHIVER, created_at: NOW - 60, content: `Archived dinner ${IMG('n-arch')}` }),
		ev({ kind: 1, pubkey: pk('1'), created_at: NOW - 70, content: `Bread for dinner ${IMG('n-loaf')}` }),
		ev({
			kind: 30023,
			pubkey: ARCHIVER,
			created_at: NOW - 5000,
			tags: [['d', 'archived-read'], ['title', 'A story about sourdough bread'], ['image', IMG('read-a')], ['t', 'food']]
		}),
		ev({
			kind: 30023,
			pubkey: pk('7'),
			created_at: NOW - 6000,
			tags: [['d', 'read-7'], ['title', 'Cooking with cast iron'], ['image', IMG('read-7')], ['t', 'food']]
		}),
		ev({
			kind: 30023,
			pubkey: pk('8'),
			created_at: NOW - 7000,
			tags: [['d', 'read-8'], ['title', 'A soup for every kitchen'], ['image', IMG('read-8')], ['t', 'food']]
		})
	]);
	relay(LIST_RELAYS[0], [
		// The editor's first hero pick is the archiver's; a cook's follows.
		orgList(30004, 'explore-hero', [['a', `30023:${ARCHIVER}:archived-0`], ['a', `30023:${COOK}:editors-choice`]]),
		orgList(30004, 'explore-reads', [['a', `30023:${ARCHIVER}:archived-read`]]),
		orgList(30000, 'feed-foodies', [['p', ARCHIVER], ['p', COOK]]),
		profile(ARCHIVER, 'Archiver'),
		profile(COOK, 'Cook')
	]);
	relay(standardRelays[0], [
		ev({
			kind: 30004,
			pubkey: ARCHIVER,
			sig: 'valid',
			created_at: NOW - 5,
			tags: [['d', 'archive-pack'], ['title', 'The archive'], ['t', 'recipe-pack'], ['a', `30023:${ARCHIVER}:archived-0`]]
		})
	]);
	for (const url of new Set([...HERO_FALLBACK_RELAYS, ...LIST_RELAYS, ...PROFILE_RELAYS, ...standardRelays])) {
		if (!relays.has(url)) relay(url, [], 'down');
	}
	return feed;
}

const deps = { now: () => NOW, verify: testVerify, fetchNip11: async () => null, timeoutMs: 150 };

/** Every author on every card of the aggregate, wherever it sits. */
function authorsIn(d: LandingData): Set<string> {
	const cards = [
		d.cover, ...d.picks, ...d.newRecipes, ...d.reads, ...d.fresh,
		...(d.readPool ?? []), ...(d.coverPool ?? []), ...(d.recipePool ?? []), ...(d.freshPool ?? []), ...(d.packs ?? []),
		...(d.freshTopics ?? []).flatMap((tile) => [tile.post, ...(tile.alternatives ?? [])])
	].filter((c): c is NonNullable<typeof c> => !!c);
	return new Set([...cards.map((c) => c.author.pubkey), ...d.cooks.map((c) => c.pubkey)]);
}

function memCache(): CacheLike & { store: Map<string, string> } {
	const store = new Map<string, string>();
	return {
		store,
		async match(req) {
			const v = store.get(req.url);
			return v === undefined ? undefined : new Response(v);
		},
		async put(req, res) {
			store.set(req.url, await res.text());
		}
	};
}

beforeEach(() => {
	relays.clear();
	__resetLandingMemo();
	(globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
});
afterEach(() => {
	delete (globalThis as { WebSocket?: unknown }).WebSocket;
});

describe('building the homepage with an author held out of discovery', () => {
	it('shows the author everywhere while no entry is configured (the control)', async () => {
		seed();
		const d = await buildLandingData({ ...deps, excluded: NOBODY });
		expect(d.cover?.author.pubkey).toBe(ARCHIVER); // the editor's first pick
		expect(d.newRecipes.some((c) => c.author.pubkey === ARCHIVER)).toBe(true);
		expect(d.fresh.some((c) => c.author.pubkey === ARCHIVER)).toBe(true);
		expect(d.cooks.map((c) => c.name)).toEqual(['Archiver', 'Cook']);
		expect(d.readPool?.map((c) => c.author.pubkey)).toEqual([ARCHIVER]);
		expect(authorsIn(d).has(ARCHIVER)).toBe(true);
	});

	it('leaves the author out of every section, curated and automatic', async () => {
		seed();
		const d = await buildLandingData({ ...deps, excluded: EXCLUDED });
		expect(authorsIn(d).has(ARCHIVER)).toBe(false);
		// Curated: the editor's next approved recipe takes the cover.
		expect(d.cover?.title).toBe('Recipe editors-choice');
		expect(d.coverPool?.map((c) => c.title)).toEqual(['Recipe editors-choice']);
		expect(d.coverList?.coordinates).toEqual([`30023:${COOK}:editors-choice`]);
		expect(d.readPool).toEqual([]);
		expect(d.cooks.map((c) => c.name)).toEqual(['Cook']);
		expect(d.fresh.map((c) => c.text)).toEqual(["Bread for dinner"]);
		expect(d.packs).toEqual([]);
	});

	it('filters before ranking and slicing, so other cooks take the slots', async () => {
		seed();
		const d = await buildLandingData({ ...deps, excluded: EXCLUDED });
		// Twelve newer recipes by the archiver would have filled the picks and the
		// section; the six other cooks fill them instead, newest first.
		const shown = [...d.picks, ...d.newRecipes].map((c) => c.title);
		expect(shown).toEqual(['cook-1', 'cook-2', 'cook-3', 'cook-4', 'cook-5', 'cook-6'].map((t) => `Recipe ${t}`));
		// Automatic reads fall back to the other writers.
		expect(d.reads.map((c) => c.title)).toEqual(['Cooking with cast iron', 'A soup for every kitchen']);
	});

	it('asks the relay for more recipes while an author is held out', async () => {
		const withEntry = seed();
		await buildLandingData({ ...deps, excluded: EXCLUDED });
		const limitOf = (r: typeof withEntry) =>
			r.reqs.map((f) => f as { '#t'?: string[]; limit?: number }).find((f) => f['#t']?.includes('zapcooking'))?.limit;
		expect(limitOf(withEntry)).toBe(RECIPE_FETCH_LIMIT_WITH_EXCLUSIONS);

		relays.clear();
		const without = seed();
		await buildLandingData({ ...deps, excluded: NOBODY });
		expect(limitOf(without)).toBe(RECIPE_FETCH_LIMIT);
	});

	it('keeps the author out of the page the visitor is served', async () => {
		seed();
		const d = await buildLandingData({ ...deps, excluded: EXCLUDED });
		const edition = selectLandingEdition(moderateLandingData(d, null, NOW, EXCLUDED), NOW);
		expect(authorsIn(edition).has(ARCHIVER)).toBe(false);
		expect(edition.cover?.title).toBe('Recipe editors-choice');
		expect(edition.newRecipes.length).toBeGreaterThan(0);
	});
});

describe('cached homepage data', () => {
	it('is re-checked on every read: data cached before the entry cannot surface the author', async () => {
		seed();
		const cache = memCache();
		let clock = NOW * 1000;
		const get = (excluded: ReadonlySet<string>) =>
			getLandingData({ ...deps, cache, clock: () => clock, excluded, waitUntil: () => {} });

		// Built and cached with no entry: the author is in the stored aggregate.
		expect(authorsIn(await get(NOBODY)).has(ARCHIVER)).toBe(true);
		expect([...cache.store.values()].join('')).toContain(ARCHIVER);

		// The entry is added. The same fresh cache (memo, then a new isolate) is
		// served without the author, with no rebuild needed.
		clock += 1000;
		expect(clock - NOW * 1000).toBeLessThan(FRESH_FOR_MS);
		const served = await get(EXCLUDED);
		expect(authorsIn(served).has(ARCHIVER)).toBe(false);
		expect(served.cover).toBeNull(); // the cached cover was theirs
		__resetLandingMemo();
		expect(authorsIn(await get(EXCLUDED)).has(ARCHIVER)).toBe(false);
		// Even the visitor's edition built from that stale aggregate is clean.
		const edition = selectLandingEdition(await get(EXCLUDED), NOW);
		expect(authorsIn(edition).has(ARCHIVER)).toBe(false);
		expect(edition.cover?.title).toBe('Recipe editors-choice');
	});

	it('cannot revive the author from last-good data when a rebuild comes back empty', async () => {
		seed();
		const before = await buildLandingData({ ...deps, excluded: NOBODY });
		const empty = await buildLandingData({ ...deps, excluded: EXCLUDED, timeoutMs: 1, fetchNip11: async () => null, now: () => NOW + 60 });
		const merged = mergeWithLastGood({ ...empty, cover: null, picks: [], newRecipes: [], fresh: [], reads: [], cooks: [], settled: [] }, before).data;
		// Last good brought the old sections back...
		expect(authorsIn(merged).has(ARCHIVER)).toBe(true);
		// ...and the read-time check takes the author out again.
		expect(authorsIn(moderateLandingData(merged, null, NOW, EXCLUDED)).has(ARCHIVER)).toBe(false);
	});

	it('restores the author when the entry is removed', async () => {
		seed();
		const cache = memCache();
		let clock = NOW * 1000;
		const get = (excluded: ReadonlySet<string>) =>
			getLandingData({ ...deps, cache, clock: () => clock, excluded });

		expect(authorsIn(await get(EXCLUDED)).has(ARCHIVER)).toBe(false);
		// Entry removed: the next build (the cache has gone stale) includes them.
		clock += FRESH_FOR_MS + 1;
		__resetLandingMemo();
		const waits: Promise<unknown>[] = [];
		await getLandingData({ ...deps, cache, clock: () => clock, excluded: NOBODY, waitUntil: (p) => waits.push(p) });
		await Promise.all(waits);
		const restored = await get(NOBODY);
		expect(restored.cover?.author.pubkey).toBe(ARCHIVER);
		expect(restored.cooks.map((c) => c.name)).toEqual(['Archiver', 'Cook']);
	});

	it('withoutExcludedAuthors returns the data untouched for an empty list', () => {
		const data = { cover: null } as unknown as LandingData;
		expect(withoutExcludedAuthors(data, NOBODY)).toBe(data);
	});
});
