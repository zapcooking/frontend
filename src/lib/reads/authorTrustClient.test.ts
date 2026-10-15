import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type { TrustDeps } from './authorTrust';

vi.mock('$app/environment', () => ({ browser: true }));

const pk = (n: number) => n.toString(16).padStart(64, '0');

function fakeDeps(): TrustDeps {
	return {
		now: () => 0,
		storage: null,
		askRelay: vi.fn(async (pks: string[]) => new Set(pks.filter((p) => p === pk(1)))),
		nip05Claims: vi.fn(async () => new Map<string, string>()),
		verifyNip05: vi.fn(async () => ({ verified: new Set<string>(), deferred: new Set<string>() }))
	};
}

async function load() {
	vi.resetModules();
	return import('./authorTrustClient');
}

beforeEach(() => vi.useRealTimers());

describe('ensureAuthorTrust', () => {
	it('one burst of authors is one lookup; verdicts land in the store', async () => {
		const client = await load();
		const deps = fakeDeps();
		client.ensureAuthorTrust([pk(1), pk(2)], deps);
		client.ensureAuthorTrust([pk(2), pk(3)], deps);
		expect(get(client.readsAuthorTrust).size).toBe(0);
		await vi.waitFor(() => expect(get(client.readsAuthorTrust).size).toBe(3));
		expect(deps.askRelay).toHaveBeenCalledTimes(1);
		expect(deps.askRelay).toHaveBeenCalledWith([pk(1), pk(2), pk(3)]);
		const m = get(client.readsAuthorTrust);
		expect(m.get(pk(1))).toBe('trusted');
		expect(m.get(pk(2))).toBe('stranger');
	});

	it('never asks about the same author twice in a session', async () => {
		const client = await load();
		const deps = fakeDeps();
		client.ensureAuthorTrust([pk(1)], deps);
		await vi.waitFor(() => expect(get(client.readsAuthorTrust).size).toBe(1));
		client.ensureAuthorTrust([pk(1).toUpperCase(), pk(1)], deps);
		await new Promise((r) => setTimeout(r, 150));
		expect(deps.askRelay).toHaveBeenCalledTimes(1);
	});

	it('a malformed key still settles (shown normally), so nothing stays pending', async () => {
		const client = await load();
		client.ensureAuthorTrust(['npub1nope'], fakeDeps());
		await vi.waitFor(() => expect(get(client.readsAuthorTrust).get('npub1nope')).toBe('unknown'));
	});
});

describe('browserTrustDeps.askRelay', () => {
	it('POSTs the batch to the feed relay and reads the trusted subset', async () => {
		const client = await load();
		const fetch = vi.fn(async () => new Response(JSON.stringify({ trusted: [pk(1)] })));
		vi.stubGlobal('fetch', fetch);
		const got = await client.browserTrustDeps.askRelay([pk(1), pk(2)]);
		expect([...got!]).toEqual([pk(1)]);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://feed.zap.cooking/trust');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({ pubkeys: [pk(1), pk(2)] });
		vi.unstubAllGlobals();
	});

	it('429, 503, 400 → null (ask later, not untrusted)', async () => {
		const client = await load();
		const body = JSON.stringify({ trusted: [pk(1)] });
		for (const status of [429, 503, 400]) {
			vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));
			expect(await client.browserTrustDeps.askRelay([pk(1)])).toBeNull();
		}
		vi.unstubAllGlobals();
	});
});
