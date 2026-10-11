/**
 * Who "All reads" shows normally: authors with a trust connection.
 *
 *   trusted   in the feed relay's trust set (any tier, POST /trust), or a
 *             verified NIP-05 (the domain's nostr.json names the key)
 *   stranger  neither: folded under "N from accounts we don't know yet"
 *   unknown   couldn't tell (relay busy, starting or unreachable; profile
 *             relays down): shown normally, never cached, asked again next
 *             visit. A 429 or 503 isn't "untrusted".
 *
 * Trusted and stranger answers are cached per author for an hour, so a
 * normal page view sends at most one /trust request. The relay asks for
 * browser-only calls (Workers share outbound IPs and its limit is per IP),
 * batches of at most 250, and that hour of caching.
 *
 * No network here: the relay call, the profile lookup and the NIP-05 check
 * come in as deps (see authorTrustClient).
 */

export type TrustVerdict = 'trusted' | 'stranger' | 'unknown';

export const TRUST_URL = 'https://feed.zap.cooking/trust';
export const TRUST_BATCH = 250;
export const TRUST_TIMEOUT_MS = 2500;
export const TRUST_TTL_MS = 60 * 60 * 1000;
export const TRUST_CACHE_KEY = 'zapcooking_reads_trust_v1';
/** Most authors kept in the cache (newest answers win). */
export const TRUST_CACHE_MAX = 3000;
/** Most NIP-05 claims per /api/reads/nip05 request. */
export const NIP05_CHECK_BATCH = 50;

const HEX64 = /^[0-9a-f]{64}$/;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** pubkey → [1 trusted | 0 stranger, answered at (ms)] */
type CacheShape = Record<string, [0 | 1, number]>;

export interface TrustDeps {
	/** ms */
	now: () => number;
	storage?: StorageLike | null;
	/** The subset /trust calls trusted, or null when it couldn't answer. */
	askRelay: (pubkeys: string[]) => Promise<Set<string> | null>;
	/** NIP-05 each author claims in their profile (absent = none), or null when no profile relay answered. */
	nip05Claims: (pubkeys: string[]) => Promise<Map<string, string> | null>;
	/** The authors whose claim verifies, or null when the check itself failed. */
	verifyNip05: (checks: { pubkey: string; nip05: string }[]) => Promise<Set<string> | null>;
}

function readCache(storage: StorageLike | null | undefined): CacheShape {
	try {
		const raw = storage?.getItem(TRUST_CACHE_KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : null;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as CacheShape) : {};
	} catch {
		return {};
	}
}

/** Unexpired cached answers. */
export function readTrustCache(storage: StorageLike | null | undefined, now: number): Map<string, TrustVerdict> {
	const out = new Map<string, TrustVerdict>();
	for (const [pk, v] of Object.entries(readCache(storage))) {
		if (!Array.isArray(v) || typeof v[1] !== 'number' || now - v[1] >= TRUST_TTL_MS || v[1] > now) continue;
		if (v[0] === 1) out.set(pk, 'trusted');
		else if (v[0] === 0) out.set(pk, 'stranger');
	}
	return out;
}

/** Adds trusted/stranger answers (unknown is never stored), dropping expired ones and the oldest past the cap. */
export function writeTrustCache(
	storage: StorageLike | null | undefined,
	verdicts: ReadonlyMap<string, TrustVerdict>,
	now: number
): void {
	if (!storage) return;
	const next: CacheShape = {};
	for (const [pk, v] of Object.entries(readCache(storage))) {
		if (Array.isArray(v) && typeof v[1] === 'number' && now - v[1] < TRUST_TTL_MS) next[pk] = v;
	}
	for (const [pk, v] of verdicts) {
		if (v === 'trusted') next[pk] = [1, now];
		else if (v === 'stranger') next[pk] = [0, now];
	}
	const kept = Object.entries(next)
		.sort((a, b) => b[1][1] - a[1][1])
		.slice(0, TRUST_CACHE_MAX);
	try {
		storage.setItem(TRUST_CACHE_KEY, JSON.stringify(Object.fromEntries(kept)));
	} catch {
		/* full or blocked storage: the next visit asks again */
	}
}

export function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/** A /trust response body → the trusted subset of what was asked, or null when it isn't one. */
export function parseTrustResponse(body: unknown, asked: string[]): Set<string> | null {
	const trusted = (body as { trusted?: unknown } | null)?.trusted;
	if (!Array.isArray(trusted)) return null;
	const askedSet = new Set(asked);
	return new Set(trusted.filter((pk): pk is string => typeof pk === 'string' && askedSet.has(pk)));
}

/**
 * A verdict for every (valid, lower-cased) author asked about: cached ones
 * first, then the relay for the rest (in batches of 250), then a NIP-05
 * check for those the relay doesn't trust.
 */
export async function resolveAuthorTrust(pubkeys: string[], deps: TrustDeps): Promise<Map<string, TrustVerdict>> {
	const out = new Map<string, TrustVerdict>();
	const cached = readTrustCache(deps.storage, deps.now());
	const ask: string[] = [];
	for (const raw of pubkeys) {
		const pk = raw.toLowerCase();
		if (!HEX64.test(pk) || out.has(pk) || ask.includes(pk)) continue;
		const hit = cached.get(pk);
		if (hit) out.set(pk, hit);
		else ask.push(pk);
	}
	if (ask.length === 0) return out;

	const fresh = new Map<string, TrustVerdict>();
	const notTrusted: string[] = [];
	for (const batch of chunk(ask, TRUST_BATCH)) {
		let trusted: Set<string> | null = null;
		try {
			trusted = await deps.askRelay(batch);
		} catch {
			trusted = null;
		}
		for (const pk of batch) {
			if (!trusted) fresh.set(pk, 'unknown');
			else if (trusted.has(pk)) fresh.set(pk, 'trusted');
			else notTrusted.push(pk);
		}
	}

	if (notTrusted.length) {
		let claims: Map<string, string> | null = null;
		try {
			claims = await deps.nip05Claims(notTrusted);
		} catch {
			claims = null;
		}
		const checks = claims ? notTrusted.filter((pk) => claims!.has(pk)).map((pk) => ({ pubkey: pk, nip05: claims!.get(pk)! })) : [];
		const verified = new Set<string>();
		let checkFailed = false;
		const answers = await Promise.all(
			chunk(checks, NIP05_CHECK_BATCH).map((b) => deps.verifyNip05(b).catch(() => null))
		);
		for (const a of answers) {
			if (!a) checkFailed = true;
			else for (const pk of a) verified.add(pk);
		}
		for (const pk of notTrusted) {
			if (!claims) fresh.set(pk, 'unknown');
			else if (verified.has(pk)) fresh.set(pk, 'trusted');
			else if (checkFailed && claims.has(pk)) fresh.set(pk, 'unknown');
			else fresh.set(pk, 'stranger');
		}
	}

	writeTrustCache(deps.storage, fresh, deps.now());
	for (const [pk, v] of fresh) out.set(pk, v);
	return out;
}

/** Newest kind-0 per author → the NIP-05 it claims (authors without one are absent). */
export function nip05ClaimsFromProfiles(
	events: { pubkey: string; created_at: number; kind: number; content: string }[]
): Map<string, string> {
	const newest = new Map<string, { created_at: number; content: string }>();
	for (const e of events) {
		if (e.kind !== 0) continue;
		const pk = e.pubkey.toLowerCase();
		const prev = newest.get(pk);
		if (!prev || e.created_at > prev.created_at) newest.set(pk, e);
	}
	const out = new Map<string, string>();
	for (const [pk, e] of newest) {
		try {
			const nip05 = (JSON.parse(e.content) as { nip05?: unknown })?.nip05;
			if (typeof nip05 === 'string' && nip05.trim()) out.set(pk, nip05.trim());
		} catch {
			/* not JSON: no claim */
		}
	}
	return out;
}
