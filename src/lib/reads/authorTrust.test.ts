import { describe, it, expect, vi } from 'vitest';
import {
	TRUST_BATCH,
	TRUST_CACHE_KEY,
	TRUST_CACHE_MAX,
	TRUST_TTL_MS,
	nip05ClaimsFromProfiles,
	parseTrustResponse,
	readTrustCache,
	resolveAuthorTrust,
	writeTrustCache,
	type TrustDeps
} from './authorTrust';

const pk = (n: number) => n.toString(16).padStart(64, '0');
const MEMBER = pk(1);
const VERIFIED = pk(2);
const CLAIMS_ONLY = pk(3);
const NOBODY = pk(4);

class MemStorage {
	data = new Map<string, string>();
	getItem(k: string) {
		return this.data.get(k) ?? null;
	}
	setItem(k: string, v: string) {
		this.data.set(k, v);
	}
}

function deps(over: Partial<TrustDeps> = {}): TrustDeps & { storage: MemStorage } {
	return {
		now: () => 1_000_000,
		storage: new MemStorage(),
		askRelay: vi.fn(async (pks: string[]) => new Set(pks.filter((p) => p === MEMBER))),
		nip05Claims: vi.fn(async () => new Map([[VERIFIED, 'v@example.com'], [CLAIMS_ONLY, 'c@example.com']])),
		verifyNip05: vi.fn(async (checks: { pubkey: string }[]) => ({
			verified: new Set(checks.map((c) => c.pubkey).filter((p) => p === VERIFIED)),
			deferred: new Set<string>()
		})),
		...over
	} as TrustDeps & { storage: MemStorage };
}

describe('resolveAuthorTrust', () => {
	it('trust set or verified NIP-05 → trusted; neither → stranger', async () => {
		const v = await resolveAuthorTrust([MEMBER, VERIFIED, CLAIMS_ONLY, NOBODY], deps());
		expect(Object.fromEntries(v)).toEqual({
			[MEMBER]: 'trusted',
			[VERIFIED]: 'trusted',
			[CLAIMS_ONLY]: 'stranger',
			[NOBODY]: 'stranger'
		});
	});

	it('only checks NIP-05 for authors the relay does not trust, and only claimants', async () => {
		const d = deps();
		await resolveAuthorTrust([MEMBER, VERIFIED, CLAIMS_ONLY, NOBODY], d);
		expect(d.nip05Claims).toHaveBeenCalledWith([VERIFIED, CLAIMS_ONLY, NOBODY]);
		expect(d.verifyNip05).toHaveBeenCalledWith([
			{ pubkey: VERIFIED, nip05: 'v@example.com' },
			{ pubkey: CLAIMS_ONLY, nip05: 'c@example.com' }
		]);
	});

	it('everyone trusted: no profile lookup at all', async () => {
		const d = deps({ askRelay: async (pks) => new Set(pks) });
		await resolveAuthorTrust([MEMBER, NOBODY], d);
		expect(d.nip05Claims).not.toHaveBeenCalled();
	});

	it('the relay unable to answer (429, 503, down) → unknown, not untrusted, and no NIP-05 fallback', async () => {
		for (const askRelay of [async () => null, async () => Promise.reject(new Error('x'))]) {
			const d = deps({ askRelay });
			const v = await resolveAuthorTrust([MEMBER, NOBODY], d);
			expect([...v.values()]).toEqual(['unknown', 'unknown']);
			expect(d.nip05Claims).not.toHaveBeenCalled();
		}
	});

	it('no profile relay answering → unknown', async () => {
		const v = await resolveAuthorTrust([NOBODY], deps({ nip05Claims: async () => null }));
		expect(v.get(NOBODY)).toBe('unknown');
	});

	it('the NIP-05 check failing (429, error) → claimants fold as strangers but are not cached', async () => {
		for (const verifyNip05 of [async () => null, async () => Promise.reject(new Error('x'))]) {
			const d = deps({ verifyNip05 });
			const v = await resolveAuthorTrust([VERIFIED, NOBODY], d);
			expect(v.get(VERIFIED)).toBe('stranger');
			expect(v.get(NOBODY)).toBe('stranger');
			expect(Object.keys(JSON.parse(d.storage.getItem(TRUST_CACHE_KEY)!))).toEqual([NOBODY]);

			// The next visit asks again, and a working route verifies them.
			const next = deps({ storage: d.storage });
			expect((await resolveAuthorTrust([VERIFIED], next)).get(VERIFIED)).toBe('trusted');
			expect(next.verifyNip05).toHaveBeenCalledTimes(1);
		}
	});

	it('a deferred claim folds as a stranger, uncached; checked ones are cached', async () => {
		const d = deps({
			verifyNip05: async () => ({ verified: new Set<string>(), deferred: new Set([VERIFIED]) })
		});
		const v = await resolveAuthorTrust([VERIFIED, CLAIMS_ONLY], d);
		expect(v.get(VERIFIED)).toBe('stranger');
		expect(v.get(CLAIMS_ONLY)).toBe('stranger');
		expect(Object.keys(JSON.parse(d.storage.getItem(TRUST_CACHE_KEY)!))).toEqual([CLAIMS_ONLY]);
	});

	it('sends NIP-05 checks in batches of at most 10 domains and 50 claims', async () => {
		const many = Array.from({ length: 25 }, (_, i) => pk(i + 500));
		const verifyNip05 = vi.fn(async () => ({ verified: new Set<string>(), deferred: new Set<string>() }));
		const nip05Claims = async () => new Map(many.map((p, i) => [p, `n${i}@d${i}.example.com`]));
		await resolveAuthorTrust(many, deps({ verifyNip05, nip05Claims }));
		const sizes = (verifyNip05.mock.calls as unknown as [{ nip05: string }[]][]).map(([b]) => b.length);
		expect(sizes).toEqual([10, 10, 5]);
	});

	it('asks the relay in batches of 250, each author once, lower-cased, skipping malformed keys', async () => {
		const many = Array.from({ length: TRUST_BATCH + 10 }, (_, i) => pk(i + 100));
		const askRelay = vi.fn(async () => new Set<string>());
		const LETTERS = 'ab'.repeat(32);
		await resolveAuthorTrust([...many, many[0], LETTERS.toUpperCase(), 'npub1x'], deps({ askRelay }));
		expect(askRelay).toHaveBeenCalledTimes(2);
		expect((askRelay.mock.calls[0] as unknown as [string[]])[0]).toHaveLength(TRUST_BATCH);
		expect((askRelay.mock.calls[1] as unknown as [string[]])[0]).toEqual([...many.slice(TRUST_BATCH), LETTERS]);
	});

	it('caches trusted and stranger for an hour, never unknown', async () => {
		const d = deps({ askRelay: async () => null });
		await resolveAuthorTrust([NOBODY], d);
		expect(d.storage.getItem(TRUST_CACHE_KEY)).toBe('{}');
		await resolveAuthorTrust([MEMBER, NOBODY], deps({ storage: d.storage }));
		expect(Object.keys(JSON.parse(d.storage.getItem(TRUST_CACHE_KEY)!)).sort()).toEqual([MEMBER, NOBODY].sort());

		const again = deps({ storage: d.storage });
		const v = await resolveAuthorTrust([MEMBER, NOBODY], again);
		expect(again.askRelay).not.toHaveBeenCalled();
		expect(v.get(MEMBER)).toBe('trusted');
		expect(v.get(NOBODY)).toBe('stranger');

		const later = deps({ storage: d.storage, now: () => 1_000_000 + TRUST_TTL_MS });
		await resolveAuthorTrust([MEMBER], later);
		expect(later.askRelay).toHaveBeenCalledTimes(1);
	});
});

describe('trust cache', () => {
	it('ignores garbage, future and expired entries', () => {
		const s = new MemStorage();
		s.setItem(TRUST_CACHE_KEY, JSON.stringify({ a: [1, 10], b: [0, 500], c: [1, 1e12], d: 'x', e: [2, 500] }));
		expect(Object.fromEntries(readTrustCache(s, 500 + TRUST_TTL_MS - 1))).toEqual({ b: 'stranger' });
		s.setItem(TRUST_CACHE_KEY, '{not json');
		expect(readTrustCache(s, 0).size).toBe(0);
	});

	it('keeps the newest answers past the cap', () => {
		const s = new MemStorage();
		const old = new Map(Array.from({ length: TRUST_CACHE_MAX }, (_, i) => [pk(i), 'trusted' as const]));
		writeTrustCache(s, old, 100);
		writeTrustCache(s, new Map([[pk(999999), 'stranger']]), 200);
		const kept = JSON.parse(s.getItem(TRUST_CACHE_KEY)!);
		expect(Object.keys(kept)).toHaveLength(TRUST_CACHE_MAX);
		expect(kept[pk(999999)]).toEqual([0, 200]);
	});

	it('a throwing storage never breaks the lookup', async () => {
		const storage = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		};
		const v = await resolveAuthorTrust([MEMBER], deps({ storage }));
		expect(v.get(MEMBER)).toBe('trusted');
	});
});

describe('parseTrustResponse', () => {
	it('keeps only keys that were asked about', () => {
		expect([...parseTrustResponse({ trusted: [MEMBER, NOBODY, 5] }, [MEMBER])!]).toEqual([MEMBER]);
	});

	it('not a /trust answer → null', () => {
		for (const body of [null, {}, { trusted: null }, { trusted: 'x' }]) expect(parseTrustResponse(body, [MEMBER])).toBeNull();
	});
});

describe('nip05ClaimsFromProfiles', () => {
	const prof = (pubkey: string, created_at: number, content: string) => ({ pubkey, created_at, kind: 0, content });

	it('reads the newest profile per author', () => {
		const claims = nip05ClaimsFromProfiles([
			prof(VERIFIED, 1, JSON.stringify({ nip05: 'old@example.com' })),
			prof(VERIFIED, 2, JSON.stringify({ nip05: ' new@example.com ' })),
			prof(VERIFIED, 0, JSON.stringify({ nip05: 'older@example.com' }))
		]);
		expect(claims.get(VERIFIED)).toBe('new@example.com');
	});

	it('no claim when the newest profile drops it, is not JSON, or another kind', () => {
		const claims = nip05ClaimsFromProfiles([
			prof(VERIFIED, 1, JSON.stringify({ nip05: 'a@example.com' })),
			prof(VERIFIED, 2, JSON.stringify({ name: 'v' })),
			prof(NOBODY, 1, 'not json'),
			{ ...prof(CLAIMS_ONLY, 1, JSON.stringify({ nip05: 'c@example.com' })), kind: 1 },
			prof(MEMBER, 1, JSON.stringify({ nip05: 7 }))
		]);
		expect(claims.size).toBe(0);
	});
});
