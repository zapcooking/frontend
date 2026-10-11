import { describe, it, expect, vi } from 'vitest';
import { NIP05_HIT_TTL_S, NIP05_MAX_BYTES, NIP05_MISS_TTL_S, lookupNip05, verifyNip05Claims } from './nip05Verify.server';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const id = { name: 'bob', domain: 'example.com' };

class MemCache {
	store = new Map<string, { body: string; cacheControl: string | null }>();
	async match(r: Request) {
		const v = this.store.get(r.url);
		return v === undefined ? undefined : new Response(v.body);
	}
	async put(r: Request, res: Response) {
		this.store.set(r.url, { body: await res.text(), cacheControl: res.headers.get('cache-control') });
	}
}

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('lookupNip05', () => {
	it('fetches the well-known URL without following redirects', async () => {
		const fetch = vi.fn(async () => jsonRes({ names: { bob: A } }));
		expect(await lookupNip05(id, { fetch })).toEqual([A]);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://example.com/.well-known/nostr.json?name=bob');
		expect(init.redirect).toBe('manual');
	});

	it('caches a hit for an hour and serves it without fetching', async () => {
		const cache = new MemCache();
		const fetch = vi.fn(async () => jsonRes({ names: { BOB: A } }));
		await lookupNip05(id, { fetch, cache });
		const [entry] = [...cache.store.values()];
		expect(entry.cacheControl).toBe(`public, max-age=${NIP05_HIT_TTL_S}`);
		expect(await lookupNip05(id, { fetch, cache })).toEqual([A]);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('caches a miss (404, no such name, not JSON) for ten minutes', async () => {
		for (const res of [new Response('', { status: 404 }), jsonRes({ names: {} }), new Response('<html>')]) {
			const cache = new MemCache();
			expect(await lookupNip05(id, { fetch: async () => res, cache })).toEqual([]);
			expect([...cache.store.values()][0].cacheControl).toBe(`public, max-age=${NIP05_MISS_TTL_S}`);
		}
	});

	it('only a 200 counts, whatever the body says', async () => {
		for (const status of [201, 203, 404, 410]) {
			const res = new Response(JSON.stringify({ names: { bob: A } }), { status });
			expect(await lookupNip05(id, { fetch: async () => res })).toEqual([]);
		}
	});

	it('a redirect is a miss (NIP-05: fetchers ignore redirects)', async () => {
		const res = new Response('', { status: 301, headers: { location: 'https://elsewhere.example/' } });
		expect(await lookupNip05(id, { fetch: async () => res })).toEqual([]);
	});

	it('server errors and network failures are misses that are never cached', async () => {
		for (const fetch of [async () => new Response('', { status: 502 }), async () => Promise.reject(new Error('down'))]) {
			const cache = new MemCache();
			expect(await lookupNip05(id, { fetch, cache })).toEqual([]);
			expect(cache.store.size).toBe(0);
		}
	});

	it('times out a hanging host, uncached', async () => {
		const cache = new MemCache();
		const fetch = (_url: string, init?: RequestInit) =>
			new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
		expect(await lookupNip05(id, { fetch: fetch as typeof globalThis.fetch, cache, timeoutMs: 10 })).toEqual([]);
		expect(cache.store.size).toBe(0);
	});

	it('stops reading past the byte cap', async () => {
		const big = JSON.stringify({ names: { bob: A }, pad: 'x'.repeat(NIP05_MAX_BYTES) });
		expect(await lookupNip05(id, { fetch: async () => new Response(big) })).toEqual([]);
		const small = JSON.stringify({ names: { bob: A }, pad: 'x'.repeat(1000) });
		expect(await lookupNip05(id, { fetch: async () => new Response(small) })).toEqual([A]);
	});
});

describe('verifyNip05Claims', () => {
	it('returns the authors their nostr.json names, fetching each identifier once', async () => {
		const fetch = vi.fn(async () => jsonRes({ names: { bob: A } }));
		const verified = await verifyNip05Claims(
			[
				{ pubkey: A, nip05: 'Bob@example.com' },
				{ pubkey: B, nip05: 'bob@example.com' },
				{ pubkey: A, nip05: 'bob@example.com' }
			],
			{ fetch }
		);
		expect(verified).toEqual([A]);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('never fetches an identifier that fails parsing', async () => {
		const fetch = vi.fn(async () => jsonRes({ names: { _: A } }));
		expect(await verifyNip05Claims([{ pubkey: A, nip05: 'x@127.0.0.1' }], { fetch })).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});
});
