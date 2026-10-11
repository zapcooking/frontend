/**
 * NIP-05 verification for "All reads", the Worker half. Browsers can't
 * fetch most nostr.json files (no CORS) and shouldn't hand their IP to
 * every domain an author names, so the Worker fetches them.
 *
 * Each identifier's answer is kept in the Cache API (an hour when it
 * names someone, ten minutes when it doesn't). Errors and timeouts aren't
 * cached and count as "not verified": a claim that can't be checked
 * doesn't earn trust, so a NIP-05 on a hanging host can't wave spam
 * through. Redirects aren't followed (NIP-05 says so) and bodies are
 * capped. Nothing here throws.
 */

import { nip05Key, nip05Url, parseNip05, pubkeysForName, type Nip05Id } from './nip05Verify';

export const NIP05_TIMEOUT_MS = 3000;
export const NIP05_MAX_BYTES = 512 * 1024;
export const NIP05_HIT_TTL_S = 60 * 60;
export const NIP05_MISS_TTL_S = 10 * 60;
/** Most claims one request may check. */
export const NIP05_MAX_CHECKS = 50;
/** Not a routable URL: the adapter's page cache can never serve it. */
const CACHE_PREFIX = 'https://reads-nip05.zap.cooking.invalid/v1/';

interface CacheLike {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

export interface Nip05Deps {
	fetch?: typeof fetch;
	cache?: CacheLike | null;
	timeoutMs?: number;
}

export interface Nip05Check {
	pubkey: string;
	nip05: string;
}

/** The body as text, or null past the byte cap. */
async function cappedText(res: Response, maxBytes: number): Promise<string | null> {
	if (!res.body) return '';
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxBytes) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const all = new Uint8Array(size);
	let at = 0;
	for (const c of chunks) {
		all.set(c, at);
		at += c.byteLength;
	}
	return new TextDecoder().decode(all);
}

/**
 * The keys the domain gives this name, lower-cased; [] when it gives none,
 * redirects, is too big or isn't JSON. `cacheable` is false for errors and
 * timeouts, so the next request asks again.
 */
async function fetchNames(id: Nip05Id, deps: Nip05Deps): Promise<{ pubkeys: string[]; cacheable: boolean }> {
	const doFetch = deps.fetch ?? fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? NIP05_TIMEOUT_MS);
	try {
		const res = await doFetch(nip05Url(id), {
			redirect: 'manual',
			signal: controller.signal,
			headers: { accept: 'application/json' }
		});
		if (res.status >= 500) return { pubkeys: [], cacheable: false };
		if (res.status !== 200) return { pubkeys: [], cacheable: true };
		const text = await cappedText(res, NIP05_MAX_BYTES);
		if (text === null) return { pubkeys: [], cacheable: true };
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			return { pubkeys: [], cacheable: true };
		}
		return { pubkeys: pubkeysForName(body, id.name), cacheable: true };
	} catch {
		return { pubkeys: [], cacheable: false };
	} finally {
		clearTimeout(timer);
	}
}

export async function lookupNip05(id: Nip05Id, deps: Nip05Deps = {}): Promise<string[]> {
	const cache = deps.cache ?? null;
	const key = new Request(CACHE_PREFIX + encodeURIComponent(nip05Key(id)));
	if (cache) {
		try {
			const hit = await cache.match(key);
			if (hit) {
				const stored = (await hit.json()) as { pubkeys?: unknown };
				if (Array.isArray(stored.pubkeys)) return stored.pubkeys.filter((p): p is string => typeof p === 'string');
			}
		} catch {
			// Fetch it instead.
		}
	}
	const { pubkeys, cacheable } = await fetchNames(id, deps);
	if (cache && cacheable) {
		const ttl = pubkeys.length ? NIP05_HIT_TTL_S : NIP05_MISS_TTL_S;
		try {
			await cache.put(
				key,
				new Response(JSON.stringify({ pubkeys }), {
					headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` }
				})
			);
		} catch (err) {
			console.warn('[reads] nip05 cache write failed:', err);
		}
	}
	return pubkeys;
}

/** The authors whose claimed NIP-05 names them, in request order. Each identifier is fetched once. */
export async function verifyNip05Claims(checks: Nip05Check[], deps: Nip05Deps = {}): Promise<string[]> {
	const lookups = new Map<string, Promise<string[]>>();
	const pending = checks.map(async (c) => {
		const id = parseNip05(c.nip05);
		if (!id) return null;
		const key = nip05Key(id);
		if (!lookups.has(key)) lookups.set(key, lookupNip05(id, deps));
		const pubkeys = await lookups.get(key)!;
		return pubkeys.includes(c.pubkey.toLowerCase()) ? c.pubkey.toLowerCase() : null;
	});
	const out: string[] = [];
	for (const pk of await Promise.all(pending)) if (pk && !out.includes(pk)) out.push(pk);
	return out;
}
