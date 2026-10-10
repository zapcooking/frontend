import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	FEED_RELAY,
	FREE_WINDOW_SECONDS,
	FRESH_FOR_MS,
	LIST_RELAYS,
	PROFILE_RELAYS,
	READS_RELAYS,
	SINCE_PAD_SECONDS,
	__resetLandingMemo,
	buildLandingData,
	emptyLandingData,
	getLandingData,
	mergeWithLastGood,
	type CacheLike,
	type LandingData
} from './landingData.server';
import { ORG_PUBKEY } from './curation';
import { FakeWebSocket, ev, pk, relay, relays, testVerify } from './fakeRelay.testutil';

const NOW = 1_800_000_000;
const IMG = (n: string) => `https://image.nostr.build/${n}.jpg`;
const SLOW_IMG = 'https://example.org/slow.jpg';
const COOK = pk('c');
const WRITER = pk('d');
const OUTSIDER = pk('b'); // an author the feed relay doesn't store

const nip11 = {
	topics: {
		featured_topics: [{ slug: 'baking', label: 'Baking' }],
		parents: [
			{ slug: 'baking', name: 'Baking', count_14d: 46, topics: [{ slug: 'kimchi', name: 'Kimchi', count_14d: 1 }] }
		]
	}
};

function recipe(d: string, author: string, image: string, published: number) {
	return ev({
		kind: 30023,
		pubkey: author,
		created_at: published,
		tags: [['d', d], ['title', `Recipe ${d}`], ['image', image], ['t', 'zapcooking'], ['published_at', String(published)]]
	});
}
function article(d: string, author: string, extra: string[][] = []) {
	return ev({
		kind: 30023,
		pubkey: author,
		created_at: NOW - 5000,
		tags: [['d', d], ['title', `Read ${d}`], ['image', IMG(d)], ...extra]
	});
}
function orgList(kind: number, d: string, tags: string[][], over: { pubkey?: string; sig?: string } = {}) {
	return ev({ kind, pubkey: over.pubkey ?? ORG_PUBKEY, sig: over.sig ?? 'valid', created_at: NOW - 100, tags: [['d', d], ...tags] });
}
const profile = (who: string, name: string) => ev({ kind: 0, pubkey: who, content: JSON.stringify({ name, picture: IMG(name) }) });

function seed() {
	const feed = relay(FEED_RELAY, [
		ev({ kind: 1, pubkey: pk('1'), created_at: NOW - 60, content: `Bread ${IMG('n1')}`, tags: [['topic', 'baking']] }),
		ev({ kind: 1, pubkey: pk('1'), created_at: NOW - 70, content: `Same author ${IMG('n2')}` }),
		ev({ kind: 1, pubkey: pk('2'), created_at: NOW - 80, content: 'no photo' }),
		ev({ kind: 1, pubkey: pk('3'), created_at: NOW - FREE_WINDOW_SECONDS - 10, content: `Too old ${IMG('old')}` }),
		recipe('newest', pk('4'), IMG('r1'), NOW - 1000),
		recipe('older', pk('5'), IMG('r2'), NOW - 2000),
		recipe('editors-cover', COOK, IMG('cover'), NOW - 900_000),
		recipe('slow-photo', COOK, SLOW_IMG, NOW - 800_000),
		article('trusted-read', WRITER),
		article('food-fallback', pk('6'), [['t', 'sourdough']]),
		article('off-topic-fallback', pk('7'), [['t', 'politics']])
	]);
	const lists = [
		orgList(30004, 'explore-hero', [['a', `30023:${COOK}:slow-photo`], ['a', `30023:${COOK}:editors-cover`]]),
		orgList(30004, 'explore-reads', [['a', `30023:${OUTSIDER}:outside-read`], ['a', `30023:${WRITER}:trusted-read`]]),
		orgList(30015, 'explore-topics', [['t', 'baking'], ['t', 'kimchi']]),
		orgList(30000, 'feed-foodies', [['p', COOK], ['p', WRITER], ['p', pk('9')]]),
		// An impostor's list with the same d-tag never wins.
		orgList(30004, 'explore-hero', [['a', `30023:${pk('4')}:newest`]], { pubkey: pk('e') })
	];
	// primal is a list, reads and profile relay at once.
	expect(LIST_RELAYS[0]).toBe(READS_RELAYS[0]);
	expect(PROFILE_RELAYS[1]).toBe(READS_RELAYS[0]);
	relay(LIST_RELAYS[0], [...lists, article('outside-read', OUTSIDER), profile(pk('4'), 'Four')]);
	relay(LIST_RELAYS[1], [], 'down');
	relay(LIST_RELAYS[2], [], 'hang');
	relay(PROFILE_RELAYS[0], [profile(COOK, 'Cook'), profile(WRITER, 'Writer')]);
	for (const url of new Set([...READS_RELAYS, ...LIST_RELAYS, ...PROFILE_RELAYS])) if (!relays.has(url)) relay(url, [], 'down');
	return feed;
}

const deps = {
	now: () => NOW,
	verify: testVerify,
	fetchNip11: async () => nip11,
	timeoutMs: 150
};

beforeEach(() => {
	relays.clear();
	__resetLandingMemo();
	(globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
});
afterEach(() => {
	delete (globalThis as { WebSocket?: unknown }).WebSocket;
});

describe('buildLandingData', () => {
	it('builds every section from the feed relay, NIP-11 and public relays', async () => {
		seed();
		const d = await buildLandingData(deps);

		// D14: the editor's first pick has a slow photo, so the next one is the cover.
		expect(d.cover?.title).toBe('Recipe editors-cover');
		expect(d.cover?.author.name).toBe('Cook');
		// Picks: the demoted slow photo, then the newest recipe fills the second slot.
		expect(d.picks.map((c) => c.title)).toEqual(['Recipe slow-photo', 'Recipe newest']);

		// Fresh: photos only, one per author, inside the window.
		expect(d.fresh.map((c) => c.text)).toEqual(['Bread']);

		// New recipes: newest first, without the cover/picks.
		expect(d.newRecipes.map((c) => c.title)).toEqual(['Recipe older']);

		// Topics: list order; counts under 5 hidden; tiles without a photo dropped.
		expect(d.topics).toEqual([{ slug: 'baking', name: 'Baking', count: 46, image: IMG('n1'), href: '/feed' }]);

		// Cooks: list order, only those with a profile.
		expect(d.cooks.map((c) => c.name)).toEqual(['Cook', 'Writer']);

		// Reads: curated order; the outsider's article came from a public relay.
		expect(d.reads.map((c) => c.title)).toEqual(['Read outside-read', 'Read trusted-read']);
	});

	it('asks the feed relay for Fresh from a minute inside its window (no AUTH-grace stall)', async () => {
		const feed = seed();
		await buildLandingData(deps);
		const fresh = feed.reqs.find((f) => Array.isArray(f.kinds) && (f.kinds as number[]).includes(1) && !f.search);
		// The relay's floor is now − 14 d; a `since` a second older stalls 1 s.
		expect(SINCE_PAD_SECONDS).toBe(60);
		expect(fresh?.since).toBe(NOW - 14 * 86400 + 60);
		const topic = feed.reqs.find((f) => f.search === 'topic:baking');
		expect(topic?.since).toBe(NOW - 14 * 86400 + 60);
		expect(topic?.limit).toBe(5);
	});

	it('ignores lists that fail verification and falls back (featured topics, newest recipes)', async () => {
		seed();
		relay(LIST_RELAYS[0], [
			profile(pk('4'), 'Four'),
			orgList(30004, 'explore-hero', [['a', `30023:${COOK}:editors-cover`]], { sig: 'forged' }),
			orgList(30015, 'explore-topics', [['t', 'kimchi']], { sig: 'forged' }),
			orgList(30000, 'feed-foodies', [['p', COOK]], { sig: 'forged' })
		]);
		const d = await buildLandingData(deps);
		expect(d.cover?.title).toBe('Recipe newest');
		expect(d.topics.map((t) => t.slug)).toEqual(['baking']); // NIP-11 featured
		expect(d.cooks).toEqual([]);
	});

	it('without a reads list, falls back to articles with a food hashtag only', async () => {
		seed();
		relay(LIST_RELAYS[0], []);
		const d = await buildLandingData(deps);
		expect(d.reads.map((c) => c.title)).toEqual(['Read food-fallback']);
	});

	it('applies reads moderation to curated and fallback articles', async () => {
		seed();
		const d = await buildLandingData({
			...deps,
			moderation: { blockedPubkeys: [OUTSIDER], blockedEventIds: [], blockedNaddrs: [], denylist: [] }
		});
		expect(d.reads.map((c) => c.title)).toEqual(['Read trusted-read']);
	});

	it('comes back empty, without throwing, when every relay is down', async () => {
		for (const url of [FEED_RELAY, ...LIST_RELAYS, ...READS_RELAYS, ...PROFILE_RELAYS]) relay(url, [], 'down');
		const d = await buildLandingData({ ...deps, fetchNip11: async () => null });
		expect(d).toEqual({ ...emptyLandingData(NOW) });
	});
});

describe('last good data', () => {
	const good: LandingData = {
		...emptyLandingData(1),
		cover: {
			type: 'recipe',
			coordinate: 'c',
			href: '/recipe/x',
			title: 'Old cover',
			image: IMG('c'),
			author: { pubkey: pk('a') },
			publishedAt: 1
		},
		fresh: [{ id: 'f', href: '/note1', text: 'old', image: IMG('f'), author: { pubkey: pk('a') }, createdAt: 1 }]
	};

	it('a section that comes back empty keeps its last good version', () => {
		const next = { ...emptyLandingData(2), topics: [{ slug: 's', name: 'S', count: null, image: IMG('s'), href: '/feed' }] };
		const { data, stale } = mergeWithLastGood(next, good);
		expect(data.cover?.title).toBe('Old cover');
		expect(data.fresh).toEqual(good.fresh);
		expect(data.topics).toEqual(next.topics);
		expect(stale.sort()).toEqual(['cover', 'fresh']);
	});

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

	it('serves fresh cache without building, stale cache while refreshing, last good on failure', async () => {
		const cache = memCache();
		let clock = 1_000_000;
		const build = vi.fn(async () => ({ ...emptyLandingData(5), fresh: good.fresh }));
		const waits: Promise<unknown>[] = [];
		const get = () => getLandingData({ cache, build, clock: () => clock, waitUntil: (p) => waits.push(p) });

		// Nothing stored: one blocking build.
		expect((await get()).fresh).toEqual(good.fresh);
		expect(build).toHaveBeenCalledTimes(1);

		// Fresh: no build (memo, then cache in a new isolate).
		clock += FRESH_FOR_MS - 1;
		await get();
		__resetLandingMemo();
		await get();
		expect(build).toHaveBeenCalledTimes(1);

		// Stale: served at once, refreshed in the background.
		clock += 10;
		build.mockImplementationOnce(async () => {
			throw new Error('relays down');
		});
		const stale = await get();
		expect(stale.fresh).toEqual(good.fresh);
		await Promise.all(waits);
		expect(build).toHaveBeenCalledTimes(2);

		// The failed refresh didn't replace the last good data.
		__resetLandingMemo();
		expect((await get()).fresh).toEqual(good.fresh);
	});

	it('never stores an empty build; with nothing stored it returns empty sections', async () => {
		const cache = memCache();
		const d = await getLandingData({ cache, build: async () => emptyLandingData(1), clock: () => 1 });
		expect(d).toEqual(emptyLandingData());
		expect(cache.store.size).toBe(0);
	});
});
