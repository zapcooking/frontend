/**
 * POST /api/reads/nip05 — which "All reads" authors have a verified NIP-05.
 *
 * Body: {"checks": [{"pubkey": "<64 hex>", "nip05": "name@domain"}, …]} (≤ 50).
 * Answer: {"verified": [...], "deferred": [...]}, pubkeys in request order:
 * named by their nostr.json, or not checkable this time (ask again later).
 *
 * The browser asks only about authors the feed relay doesn't already
 * trust. Each identifier's answer is edge-cached, and one request fetches
 * from at most 10 domains (see nip05Verify.server). Per client IP,
 * 20 requests a minute; over that, 429.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { NIP05_MAX_CHECKS, verifyNip05Claims, type Nip05Check } from '$lib/reads/nip05Verify.server';

const MAX_BODY_BYTES = 32 * 1024;
/*
 * The limit itself (20 requests a minute per IP) is the limiter's config,
 * not code here. Why 20: a first page load sends 1–3 requests (≤ 10
 * domains each), and a reload inside the hour usually none (the browser
 * caches answers). 20 leaves room for several tabs and reloads behind one
 * NAT, while one IP can make the Worker fetch from at most 200 domains a
 * minute.
 */

/** The rate limiting binding's shape: one call per request, keyed by client IP. */
interface RateLimiter {
	limit(opts: { key: string }): Promise<{ success: boolean }>;
}

let warnedNoLimiter = false;
const HEX64 = /^[0-9a-f]{64}$/;

function parseChecks(body: unknown): Nip05Check[] | null {
	const checks = (body as { checks?: unknown } | null)?.checks;
	if (!Array.isArray(checks) || checks.length > NIP05_MAX_CHECKS) return null;
	const out: Nip05Check[] = [];
	for (const c of checks) {
		const { pubkey, nip05 } = (c ?? {}) as Record<string, unknown>;
		if (typeof pubkey !== 'string' || !HEX64.test(pubkey) || typeof nip05 !== 'string' || nip05.length > 320) return null;
		out.push({ pubkey, nip05 });
	}
	return out;
}

/** The body as text, or null once it passes `max` bytes (checked while streaming, before buffering more). */
async function readCapped(request: Request, max: number): Promise<string | null> {
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > max) return null;
	if (!request.body) return '';
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			void reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const c of chunks) {
		bytes.set(c, at);
		at += c.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const limiter = (platform?.env as { NIP05_RATE_LIMITER?: RateLimiter } | undefined)?.NIP05_RATE_LIMITER;
	if (limiter) {
		let ip = 'unknown';
		try {
			ip = getClientAddress();
		} catch {
			// Local dev: no client address.
		}
		let allowed = true;
		try {
			allowed = (await limiter.limit({ key: `nip05:${ip}` })).success;
		} catch (err) {
			console.warn('[reads] nip05 rate limiter failed, allowing:', err);
		}
		if (!allowed) return json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '60' } });
	} else if (!warnedNoLimiter) {
		warnedNoLimiter = true;
		console.warn('[reads] NIP05_RATE_LIMITER not bound: /api/reads/nip05 is not rate limited');
	}

	const text = await readCapped(request, MAX_BODY_BYTES);
	if (text === null) return json({ error: 'Body too large' }, { status: 413 });
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const checks = parseChecks(body);
	if (!checks) return json({ error: `Expected {checks: [{pubkey, nip05}]} with at most ${NIP05_MAX_CHECKS}` }, { status: 400 });

	const cache =
		typeof caches !== 'undefined' ? ((caches as unknown as { default?: Cache }).default ?? null) : null;
	const { verified, deferred } = await verifyNip05Claims(checks, { cache });
	return json({ verified, deferred }, { headers: { 'cache-control': 'no-store' } });
};
