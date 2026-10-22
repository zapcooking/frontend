import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '$env/dynamic/private';
import { GIF_PER_HOUR, proxyGifRequest } from './gifProxy.server';

/** An in-memory KV with the shape checkPerIpRateLimit uses. */
function memKv() {
	const m = new Map<string, string>();
	return {
		m,
		async get(k: string) {
			return m.get(k) ?? null;
		},
		async put(k: string, v: string) {
			m.set(k, v);
		}
	};
}

const ctx = (kv = memKv(), ip = '203.0.113.7') => ({ ip, kv });
const params = (q: Record<string, string>) => new URLSearchParams(q);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	env.GIFS_NOSTR_BUILD_API_KEY = 'test-key';
	fetchMock = vi.fn(async () => new Response('{"results":[]}', { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	delete env.GIFS_NOSTR_BUILD_API_KEY;
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function status(p: Promise<Response>): Promise<number> {
	try {
		return (await p).status;
	} catch (e) {
		return (e as { status: number }).status;
	}
}

describe('proxyGifRequest: configuration and input', () => {
	it('503 when the API key is not configured, without calling upstream', async () => {
		delete env.GIFS_NOSTR_BUILD_API_KEY;
		expect(await status(proxyGifRequest('search', params({ q: 'pie' }), ctx()))).toBe(503);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('400 for a missing or blank search term', async () => {
		expect(await status(proxyGifRequest('search', params({}), ctx()))).toBe(400);
		expect(await status(proxyGifRequest('suggest', params({ q: '   ' }), ctx()))).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('normalizes the query: trimmed, ≤500 chars, safe=1, limit 1–50 (default 24), offset 0–199', async () => {
		const cases: [Record<string, string>, { limit: string; offset: string }][] = [
			[{ q: '  pie  ' }, { limit: '24', offset: '0' }],
			[{ q: 'pie', limit: '500', offset: '999' }, { limit: '50', offset: '199' }],
			[{ q: 'pie', limit: '-3', offset: '-1' }, { limit: '1', offset: '0' }],
			[{ q: 'pie', limit: 'abc', offset: 'xyz' }, { limit: '24', offset: '0' }],
			[{ q: 'pie', limit: '7.9', offset: '24.5' }, { limit: '7', offset: '24' }]
		];
		for (const [input, want] of cases) {
			fetchMock.mockClear();
			await proxyGifRequest('search', params(input), ctx());
			const url = new URL(fetchMock.mock.calls[0][0] as string);
			expect(url.origin + url.pathname).toBe('https://gifs.nostr.build/api/v1/search');
			expect(url.searchParams.get('q')).toBe('pie');
			expect(url.searchParams.get('safe')).toBe('1');
			expect(url.searchParams.get('limit')).toBe(want.limit);
			expect(url.searchParams.get('offset')).toBe(want.offset);
		}
		fetchMock.mockClear();
		await proxyGifRequest('search', params({ q: 'x'.repeat(600) }), ctx());
		expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('q')).toHaveLength(500);
	});

	it('suggest asks for 6 terms and sends no offset', async () => {
		await proxyGifRequest('suggest', params({ q: 'pie', offset: '30', limit: '40' }), ctx());
		const url = new URL(fetchMock.mock.calls[0][0] as string);
		expect(url.pathname).toBe('/api/v1/suggest');
		expect(url.searchParams.get('limit')).toBe('6');
		expect(url.searchParams.has('offset')).toBe(false);
	});
});

describe('proxyGifRequest: the upstream call', () => {
	it('sends the key as a Bearer header (never in the URL)', async () => {
		await proxyGifRequest('search', params({ q: 'pie' }), ctx());
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
		expect(url).not.toContain('test-key');
	});

	it('502 when the network fails', async () => {
		fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
		expect(await status(proxyGifRequest('search', params({ q: 'pie' }), ctx()))).toBe(502);
	});

	it('502 when upstream is slower than the 8 s timeout (the request is aborted)', async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementationOnce(
			(_url: string, init: RequestInit) =>
				new Promise((_, reject) =>
					init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
				)
		);
		// No KV: the limiter is skipped, so the upstream call starts without
		// real-clock work (crypto) that fake timers can't drive.
		const p = status(proxyGifRequest('search', params({ q: 'pie' }), { ip: '203.0.113.7', kv: undefined }));
		while (!fetchMock.mock.calls.length) await Promise.resolve();
		await vi.advanceTimersByTimeAsync(7999);
		expect(fetchMock.mock.calls.length).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(await p).toBe(502);
	});

	it('passes upstream errors through with their status and body, never cached', async () => {
		for (const code of [401, 403, 429, 500]) {
			fetchMock.mockResolvedValueOnce(new Response(`{"error":${code}}`, { status: code }));
			const res = await proxyGifRequest('search', params({ q: 'pie' }), ctx());
			expect(res.status).toBe(code);
			expect(await res.text()).toBe(`{"error":${code}}`);
			expect(res.headers.get('Cache-Control')).toBe('no-store');
		}
	});

	it('a success is JSON with a short edge cache', async () => {
		const res = await proxyGifRequest('search', params({ q: 'pie' }), ctx());
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/json');
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=300, stale-while-revalidate=86400');
		expect(await res.text()).toBe('{"results":[]}');
	});
});

describe('proxyGifRequest: per-IP rate limit', () => {
	it(`after ${GIF_PER_HOUR} upstream requests in an hour, 429 without calling upstream`, async () => {
		const kv = memKv();
		for (let i = 0; i < GIF_PER_HOUR; i++) {
			expect((await proxyGifRequest('search', params({ q: `q${i}` }), ctx(kv))).status).toBe(200);
		}
		fetchMock.mockClear();
		const res = await proxyGifRequest('suggest', params({ q: 'pie' }), ctx(kv)); // one bucket for both
		expect(res.status).toBe(429);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
		expect(fetchMock).not.toHaveBeenCalled();
		// Another IP is unaffected.
		expect((await proxyGifRequest('search', params({ q: 'pie' }), ctx(kv, '198.51.100.9'))).status).toBe(200);
	});

	it('invalid input never counts against the caller', async () => {
		const kv = memKv();
		await status(proxyGifRequest('search', params({}), ctx(kv)));
		expect(kv.m.size).toBe(0);
	});
});
