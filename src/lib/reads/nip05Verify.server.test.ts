import { describe, it, expect, vi } from 'vitest';
import {
	NIP05_HIT_TTL_S,
	NIP05_MAX_BYTES,
	NIP05_MAX_DOMAINS,
	NIP05_MAX_IN_FLIGHT,
	NIP05_MISS_TTL_S,
	lookupNip05,
	verifyNip05Claims
} from './nip05Verify.server';

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
		expect(verified).toEqual({ verified: [A], deferred: [] });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('never fetches an identifier that fails parsing', async () => {
		const fetch = vi.fn(async () => jsonRes({ names: { _: A } }));
		expect(await verifyNip05Claims([{ pubkey: A, nip05: 'x@127.0.0.1' }], { fetch })).toEqual({ verified: [], deferred: [] });
		expect(fetch).not.toHaveBeenCalled();
	});

	const pkN = (n: number) => n.toString(16).padStart(64, '0');

	it('50 claims on 50 domains: at most 10 fetches, the rest deferred', async () => {
		const fetch = vi.fn(async (url: string) => {
			const host = new URL(url).hostname;
			const n = Number(host.slice(1, host.indexOf('.')));
			return jsonRes({ names: { bob: pkN(n) } });
		});
		const checks = Array.from({ length: 50 }, (_, i) => ({ pubkey: pkN(i), nip05: `bob@d${i}.example.com` }));
		const out = await verifyNip05Claims(checks, { fetch: fetch as unknown as typeof globalThis.fetch });
		// Literal 10, not the constant: raising the cap must fail this test.
		expect(NIP05_MAX_DOMAINS).toBe(10);
		expect(fetch.mock.calls.length).toBeLessThanOrEqual(10);
		expect(out.verified).toEqual(checks.slice(0, 10).map((c) => c.pubkey));
		expect(out.deferred).toEqual(checks.slice(10).map((c) => c.pubkey));
	});

	it('claims sharing a domain share one fetch; names that body leaves out are deferred', async () => {
		const fetch = vi.fn(async () => jsonRes({ names: { bob: A } }));
		const out = await verifyNip05Claims(
			[
				{ pubkey: A, nip05: 'bob@example.com' },
				{ pubkey: B, nip05: 'carol@example.com' }
			],
			{ fetch }
		);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(out).toEqual({ verified: [A], deferred: [B] });
	});

	it('a static nostr.json verifies every name on its domain from one fetch, and caches each', async () => {
		const cache = new MemCache();
		const fetch = vi.fn(async () => jsonRes({ names: { bob: A, carol: B } }));
		const checks = [
			{ pubkey: A, nip05: 'bob@example.com' },
			{ pubkey: B, nip05: 'carol@example.com' }
		];
		expect(await verifyNip05Claims(checks, { fetch, cache })).toEqual({ verified: [A, B], deferred: [] });
		expect(await verifyNip05Claims(checks, { fetch, cache })).toEqual({ verified: [A, B], deferred: [] });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('a host error defers its claims (uncached), a clean miss does not', async () => {
		const fetch = vi.fn(async (url: string) =>
			url.includes('down.example.com') ? new Response('', { status: 502 }) : jsonRes({ names: {} })
		);
		const out = await verifyNip05Claims(
			[
				{ pubkey: A, nip05: 'bob@down.example.com' },
				{ pubkey: B, nip05: 'bob@example.com' }
			],
			{ fetch: fetch as unknown as typeof globalThis.fetch }
		);
		expect(out).toEqual({ verified: [], deferred: [A] });
	});

	it(`never more than ${NIP05_MAX_IN_FLIGHT} fetches in flight`, async () => {
		let active = 0;
		let peak = 0;
		const fetch = vi.fn(async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, 5));
			active--;
			return jsonRes({ names: {} });
		});
		const checks = Array.from({ length: 10 }, (_, i) => ({ pubkey: pkN(i), nip05: `bob@d${i}.example.com` }));
		await verifyNip05Claims(checks, { fetch });
		expect(fetch).toHaveBeenCalledTimes(10);
		expect(peak).toBe(5);
	});
});
