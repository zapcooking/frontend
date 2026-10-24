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
 *
 * One request fans out to few hosts: at most NIP05_MAX_DOMAINS domains, one
 * nostr.json fetch per domain (other names on it are read from that same
 * body), NIP05_MAX_IN_FLIGHT fetches at once. Claims it couldn't check
 * this time come back `deferred`, for the browser to ask again later.
 */

import { nip05Key, nip05Url, parseNip05, pubkeysForName, type Nip05Id } from './nip05Verify';

export const NIP05_TIMEOUT_MS = 3000;
export const NIP05_MAX_BYTES = 512 * 1024;
export const NIP05_HIT_TTL_S = 60 * 60;
export const NIP05_MISS_TTL_S = 10 * 60;
/** Most claims one request may check. */
export const NIP05_MAX_CHECKS = 50;
/** Most distinct domains one request may fetch from (claims past them are deferred). */
export const NIP05_MAX_DOMAINS = 10;
/** Most nostr.json fetches in flight at once, per request. */
export const NIP05_MAX_IN_FLIGHT = 5;
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
 * The domain's nostr.json body as asked for this name; null when it
 * redirects, isn't a 200, is too big or isn't JSON. `cacheable` is false
 * for errors and timeouts, so the next request asks again.
 */
async function fetchBody(id: Nip05Id, deps: Nip05Deps): Promise<{ body: unknown; cacheable: boolean }> {
	const doFetch = deps.fetch ?? fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? NIP05_TIMEOUT_MS);
	try {
		const res = await doFetch(nip05Url(id), {
			redirect: 'manual',
			signal: controller.signal,
			headers: { accept: 'application/json' }
		});
		if (res.status >= 500) return { body: null, cacheable: false };
		if (res.status !== 200) return { body: null, cacheable: true };
		const text = await cappedText(res, NIP05_MAX_BYTES);
		if (text === null) return { body: null, cacheable: true };
		try {
			return { body: JSON.parse(text), cacheable: true };
		} catch {
			return { body: null, cacheable: true };
		}
	} catch {
		return { body: null, cacheable: false };
	} finally {
		clearTimeout(timer);
	}
}

const cacheKey = (id: Nip05Id) => new Request(CACHE_PREFIX + encodeURIComponent(nip05Key(id)));

/** The stored answer for this identifier, or null when there's none. */
async function readCached(id: Nip05Id, cache: CacheLike | null): Promise<string[] | null> {
	if (!cache) return null;
	try {
		const hit = await cache.match(cacheKey(id));
		if (!hit) return null;
		const stored = (await hit.json()) as { pubkeys?: unknown };
		return Array.isArray(stored.pubkeys) ? stored.pubkeys.filter((p): p is string => typeof p === 'string') : null;
	} catch {
		return null;
	}
}

async function writeCached(id: Nip05Id, pubkeys: string[], cache: CacheLike | null): Promise<void> {
	if (!cache) return;
	const ttl = pubkeys.length ? NIP05_HIT_TTL_S : NIP05_MISS_TTL_S;
	try {
		await cache.put(
			cacheKey(id),
			new Response(JSON.stringify({ pubkeys }), {
				headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` }
			})
		);
	} catch (err) {
		console.warn('[reads] nip05 cache write failed:', err);
	}
}

export async function lookupNip05(id: Nip05Id, deps: Nip05Deps = {}): Promise<string[]> {
	const cache = deps.cache ?? null;
	const cached = await readCached(id, cache);
	if (cached) return cached;
	const { body, cacheable } = await fetchBody(id, deps);
	const pubkeys = pubkeysForName(body, id.name);
	if (cacheable) await writeCached(id, pubkeys, cache);
	return pubkeys;
}

/** Runs at most `n` of the given tasks at once. */
function limiter(n: number): <T>(task: () => Promise<T>) => Promise<T> {
	let active = 0;
	const queue: (() => void)[] = [];
	return async (task) => {
		if (active >= n) await new Promise<void>((go) => queue.push(go));
		active++;
		try {
			return await task();
		} finally {
			active--;
			queue.shift()?.();
		}
	};
}

/**
 * Every name claimed on one domain → its keys, or absent when it couldn't
 * be checked this time. Cached names are free; the first uncached one is
 * fetched, and the rest are read from that body (a static nostr.json lists
 * everyone). A name the body leaves out isn't a miss, since servers that
 * answer only `?name=` leave everyone else out, so it stays unresolved.
 */
async function lookupDomain(
	domain: string,
	names: string[],
	deps: Nip05Deps,
	slot: <T>(task: () => Promise<T>) => Promise<T>
): Promise<Map<string, string[]>> {
	const cache = deps.cache ?? null;
	const out = new Map<string, string[]>();
	const uncached: string[] = [];
	for (const name of names) {
		const hit = await readCached({ name, domain }, cache);
		if (hit) out.set(name, hit);
		else uncached.push(name);
	}
	if (!uncached.length) return out;
	const [first, ...rest] = uncached;
	const { body, cacheable } = await slot(() => fetchBody({ name: first, domain }, deps));
	// An error or timeout settles nothing: every name here is asked again next time.
	if (!cacheable) return out;
	const firstKeys = pubkeysForName(body, first);
	out.set(first, firstKeys);
	await writeCached({ name: first, domain }, firstKeys, cache);
	for (const name of rest) {
		const keys = pubkeysForName(body, name);
		if (!keys.length) continue;
		out.set(name, keys);
		await writeCached({ name, domain }, keys, cache);
	}
	return out;
}

export interface Nip05Result {
	/** Authors whose claimed NIP-05 names them, in request order. */
	verified: string[];
	/** Authors whose claim couldn't be checked this time (domain cap, host error, name not in the shared fetch). */
	deferred: string[];
}

/**
 * Checks the claims with one nostr.json fetch per domain, for the first
 * NIP05_MAX_DOMAINS domains, NIP05_MAX_IN_FLIGHT at a time. Claims that
 * fail parsing are neither: they never verify.
 */
export async function verifyNip05Claims(checks: Nip05Check[], deps: Nip05Deps = {}): Promise<Nip05Result> {
	const parsed = checks.map((c) => ({ pubkey: c.pubkey.toLowerCase(), id: parseNip05(c.nip05) }));
	const byDomain = new Map<string, Set<string>>();
	for (const { id } of parsed) {
		if (!id) continue;
		const names = byDomain.get(id.domain);
		if (names) names.add(id.name);
		else if (byDomain.size < NIP05_MAX_DOMAINS) byDomain.set(id.domain, new Set([id.name]));
	}
	const slot = limiter(NIP05_MAX_IN_FLIGHT);
	const answers = new Map<string, Map<string, string[]>>();
	await Promise.all(
		[...byDomain].map(async ([domain, names]) => answers.set(domain, await lookupDomain(domain, [...names], deps, slot)))
	);
	const verified: string[] = [];
	const deferred: string[] = [];
	for (const { pubkey, id } of parsed) {
		if (!id) continue;
		const keys = answers.get(id.domain)?.get(id.name);
		if (keys?.includes(pubkey)) {
			if (!verified.includes(pubkey)) verified.push(pubkey);
		} else if (!keys && !deferred.includes(pubkey)) deferred.push(pubkey);
	}
	return { verified, deferred: deferred.filter((pk) => !verified.includes(pk)) };
}
