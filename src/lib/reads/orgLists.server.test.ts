import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ORG_PUBKEY } from '$lib/landing/curation';
import type { NostrEvent } from '$lib/relayCollect';
import {
	ORG_LISTS_CACHE_KEY,
	ORG_LISTS_FRESH_FOR_MS,
	__resetOrgListsMemo,
	getOrgModeration,
	mergeOrgLists
} from './orgLists.server';

const P1 = '1'.repeat(64);
const P2 = '2'.repeat(64);
const ID = '3'.repeat(64);

function ev(d: string, tags: string[][], created_at: number): NostrEvent {
	return { id: d + created_at, pubkey: ORG_PUBKEY, kind: 30000, created_at, tags: [['d', d], ...tags], content: '', sig: '' };
}

class MemCache {
	store = new Map<string, string>();
	async match(r: Request) {
		const v = this.store.get(r.url);
		return v === undefined ? undefined : new Response(v);
	}
	async put(r: Request, res: Response) {
		this.store.set(r.url, await res.text());
	}
}

beforeEach(() => __resetOrgListsMemo());

describe('getOrgModeration', () => {
	it('fetches when nothing is stored, and caches under the fixed key', async () => {
		const cache = new MemCache();
		const fetchLists = vi.fn(async () => ({ block: ev('feed-block', [['p', P1]], 10), hidden: ev('feed-hidden', [['e', ID]], 10) }));
		const m = await getOrgModeration({ cache, fetchLists, clock: () => 1000 });
		expect(m).toEqual({ blockedPubkeys: [P1], hiddenEventIds: [ID], hiddenCoordinates: [] });
		expect(cache.store.has(ORG_LISTS_CACHE_KEY)).toBe(true);
	});

	it('serves from memory while fresh (no second fetch)', async () => {
		const fetchLists = vi.fn(async () => ({ block: ev('feed-block', [['p', P1]], 10) }));
		let now = 1000;
		await getOrgModeration({ fetchLists, clock: () => now });
		now += ORG_LISTS_FRESH_FOR_MS - 1;
		await getOrgModeration({ fetchLists, clock: () => now });
		expect(fetchLists).toHaveBeenCalledTimes(1);
	});

	it('serves from the cache in a new isolate (no fetch)', async () => {
		const cache = new MemCache();
		await getOrgModeration({ cache, fetchLists: async () => ({ block: ev('feed-block', [['p', P1]], 10) }), clock: () => 1000 });
		__resetOrgListsMemo();
		const fetchLists = vi.fn(async () => ({}));
		const m = await getOrgModeration({ cache, fetchLists, clock: () => 2000 });
		expect(m.blockedPubkeys).toEqual([P1]);
		expect(fetchLists).not.toHaveBeenCalled();
	});

	it('serves stale while refreshing in the background', async () => {
		let now = 1000;
		await getOrgModeration({ fetchLists: async () => ({ block: ev('feed-block', [['p', P1]], 10) }), clock: () => now });
		now += ORG_LISTS_FRESH_FOR_MS + 1;
		const pending: Promise<unknown>[] = [];
		const stale = await getOrgModeration({
			fetchLists: async () => ({ block: ev('feed-block', [['p', P2]], 20) }),
			clock: () => now,
			waitUntil: (p) => pending.push(p)
		});
		expect(stale.blockedPubkeys).toEqual([P1]);
		await Promise.all(pending);
		now += 1;
		const next = await getOrgModeration({ fetchLists: async () => ({}), clock: () => now });
		expect(next.blockedPubkeys).toEqual([P2]);
	});

	it('keeps the last good list when a refresh comes back without it (or throws)', async () => {
		let now = 1000;
		await getOrgModeration({ fetchLists: async () => ({ block: ev('feed-block', [['p', P1]], 10) }), clock: () => now });
		now += ORG_LISTS_FRESH_FOR_MS + 1;
		const pending: Promise<unknown>[] = [];
		await getOrgModeration({ fetchLists: async () => { throw new Error('relays down'); }, clock: () => now, waitUntil: (p) => pending.push(p) });
		await Promise.all(pending);
		const m = await getOrgModeration({ fetchLists: async () => ({}), clock: () => now + 1 });
		expect(m.blockedPubkeys).toEqual([P1]);
	});

	it('is empty (never throws) when the first fetch fails', async () => {
		const m = await getOrgModeration({ fetchLists: async () => { throw new Error('x'); } });
		expect(m).toEqual({ blockedPubkeys: [], hiddenEventIds: [], hiddenCoordinates: [] });
	});
});

describe('mergeOrgLists', () => {
	it('never lets an older copy replace a newer one', () => {
		const last = mergeOrgLists({}, { block: ev('feed-block', [['p', P2]], 20) });
		const next = mergeOrgLists(last, { block: ev('feed-block', [['p', P1]], 10) });
		expect(next.block?.createdAt).toBe(20);
	});

	it('an emptied list replaces the old one (an unblock takes effect)', () => {
		const last = mergeOrgLists({}, { block: ev('feed-block', [['p', P1]], 10) });
		const next = mergeOrgLists(last, { block: ev('feed-block', [], 20) });
		expect(next.block?.event.tags).toEqual([['d', 'feed-block']]);
	});
});
