/**
 * Scope-aware promo engine tests.
 *
 * Two jobs:
 *  1. Prove the cookbook behaviour is byte-for-byte unchanged after the
 *     generalisation (LAUNCH 50%, FREEPACK 100% free, expiry, kill-switch).
 *  2. Prove the new scope semantics: scope matching incl. 'all' and the
 *     genesis carve-out, USD-cents math, and the membership/genesis
 *     percent-only + sub-100% caps (D1/D3).
 */

import { describe, expect, it } from 'vitest';
import { env } from '$env/dynamic/private';
import { applyPromo, scopeAllows } from '$lib/promoEngine.server';
import { COOKBOOK_EXPORT_SATS } from '$lib/cookbookPricing';
import type { PromoConfigState, PromoKV } from '$lib/promoEngine.server';

/** Minimal in-memory KV that serves a fixed config (or null = empty). */
function makeKv(config: PromoConfigState | null): PromoKV {
	return {
		async get() {
			return config === null ? null : JSON.stringify(config);
		},
		async put() {},
		async delete() {}
	};
}

describe('cookbook backward-compat (default config, empty KV)', () => {
	it('LAUNCH applies 50% off', async () => {
		const r = await applyPromo(null, 'LAUNCH', COOKBOOK_EXPORT_SATS, 'cookbook');
		expect(r.ok).toBe(true);
		expect(r.applied).toMatchObject({
			code: 'LAUNCH',
			originalSats: 2100,
			discountSats: 1050,
			finalSats: 1050,
			free: false,
			label: '50% off'
		});
	});

	it('FREEPACK is 100% off / free', async () => {
		const r = await applyPromo(null, 'freepack', COOKBOOK_EXPORT_SATS, 'cookbook');
		expect(r.ok).toBe(true);
		expect(r.applied?.finalSats).toBe(0);
		expect(r.applied?.free).toBe(true);
		expect(r.applied?.label).toBe('Free');
	});

	it('unknown / empty codes are rejected', async () => {
		expect((await applyPromo(null, 'NOPE', 2100, 'cookbook')).error).toBe('unknown_code');
		expect((await applyPromo(null, '', 2100, 'cookbook')).error).toBe('unknown_code');
	});
});

describe('kill switches', () => {
	it('COOKBOOK_PROMOS_DISABLED disables only the cookbook scope', async () => {
		const kv = makeKv({
			enabled: true,
			codes: { MEM: { percentOff: 20, flatOff: 0, scope: 'membership' } }
		});
		env.COOKBOOK_PROMOS_DISABLED = 'true';
		try {
			expect((await applyPromo(null, 'LAUNCH', 2100, 'cookbook')).error).toBe('disabled');
			// membership scope unaffected by the legacy cookbook switch
			expect((await applyPromo(kv, 'MEM', 5000, 'membership')).ok).toBe(true);
		} finally {
			delete env.COOKBOOK_PROMOS_DISABLED;
		}
	});

	it('PROMOS_DISABLED disables every scope', async () => {
		const kv = makeKv({
			enabled: true,
			codes: { MEM: { percentOff: 20, flatOff: 0, scope: 'membership' } }
		});
		env.PROMOS_DISABLED = 'true';
		try {
			expect((await applyPromo(null, 'LAUNCH', 2100, 'cookbook')).error).toBe('disabled');
			expect((await applyPromo(kv, 'MEM', 5000, 'membership')).error).toBe('disabled');
		} finally {
			delete env.PROMOS_DISABLED;
		}
	});
});

describe('expiry', () => {
	const past = Date.now() - 1000;
	const future = Date.now() + 60_000;
	const kv = makeKv({
		enabled: true,
		codes: {
			OLD: { percentOff: 50, flatOff: 0, scope: 'cookbook', expiresAt: past },
			NEW: { percentOff: 50, flatOff: 0, scope: 'cookbook', expiresAt: future }
		}
	});

	it('rejects an expired code', async () => {
		expect((await applyPromo(kv, 'OLD', 2100, 'cookbook')).error).toBe('expired');
	});
	it('accepts a not-yet-expired code', async () => {
		expect((await applyPromo(kv, 'NEW', 2100, 'cookbook')).ok).toBe(true);
	});
});

describe('scope matching', () => {
	const kv = makeKv({
		enabled: true,
		codes: {
			COOKONLY: { percentOff: 50, flatOff: 0, scope: 'cookbook' },
			MEMONLY: { percentOff: 20, flatOff: 0, scope: 'membership' },
			GENONLY: { percentOff: 10, flatOff: 0, scope: 'genesis' },
			ALLCODE: { percentOff: 30, flatOff: 0, scope: 'all' },
			LEGACY: { percentOff: 40, flatOff: 0 } // no scope → defaults to 'all'
		}
	});

	it('exact-scope codes only match their surface', async () => {
		expect((await applyPromo(kv, 'COOKONLY', 2100, 'cookbook')).ok).toBe(true);
		expect((await applyPromo(kv, 'COOKONLY', 5000, 'membership')).error).toBe('wrong_scope');
		expect((await applyPromo(kv, 'MEMONLY', 5000, 'membership')).ok).toBe(true);
		expect((await applyPromo(kv, 'MEMONLY', 2100, 'cookbook')).error).toBe('wrong_scope');
		expect((await applyPromo(kv, 'GENONLY', 5000, 'genesis')).ok).toBe(true);
		expect((await applyPromo(kv, 'GENONLY', 5000, 'membership')).error).toBe('wrong_scope');
	});

	it("'all' covers cookbook + membership but NOT genesis (D4)", async () => {
		expect((await applyPromo(kv, 'ALLCODE', 2100, 'cookbook')).ok).toBe(true);
		expect((await applyPromo(kv, 'ALLCODE', 5000, 'membership')).ok).toBe(true);
		expect((await applyPromo(kv, 'ALLCODE', 5000, 'genesis')).error).toBe('wrong_scope');
	});

	it('legacy codes with no scope behave like \"all\"', async () => {
		expect((await applyPromo(kv, 'LEGACY', 2100, 'cookbook')).ok).toBe(true);
		expect((await applyPromo(kv, 'LEGACY', 5000, 'membership')).ok).toBe(true);
		expect((await applyPromo(kv, 'LEGACY', 5000, 'genesis')).error).toBe('wrong_scope');
	});
});

describe('USD-cents math (membership)', () => {
	const kv = makeKv({
		enabled: true,
		codes: { TWENTY: { percentOff: 20, flatOff: 0, scope: 'membership' } }
	});

	it('20% off $49.00 (4900 cents) → $39.20 (3920 cents)', async () => {
		const r = await applyPromo(kv, 'TWENTY', 4900, 'membership');
		expect(r.ok).toBe(true);
		expect(r.applied?.originalSats).toBe(4900); // cents, despite the field name
		expect(r.applied?.discountSats).toBe(980);
		expect(r.applied?.finalSats).toBe(3920);
		expect(r.applied?.label).toBe('20% off');
		expect(r.applied?.free).toBe(false);
	});
});

describe('membership/genesis percent-only + sub-100% caps (D1/D3)', () => {
	const kv = makeKv({
		enabled: true,
		codes: {
			MEMFLAT: { percentOff: 0, flatOff: 500, scope: 'membership' },
			MEMFULL: { percentOff: 100, flatOff: 0, scope: 'membership' },
			GENFLAT: { percentOff: 0, flatOff: 100, scope: 'genesis' },
			GENFULL: { percentOff: 100, flatOff: 0, scope: 'genesis' },
			CBFREE: { percentOff: 100, flatOff: 0, scope: 'cookbook' }
		}
	});

	it('rejects flatOff on membership/genesis', async () => {
		expect((await applyPromo(kv, 'MEMFLAT', 4900, 'membership')).error).toBe('invalid_for_scope');
		expect((await applyPromo(kv, 'GENFLAT', 21000, 'genesis')).error).toBe('invalid_for_scope');
	});

	it('rejects >=100% on membership/genesis (no free-grant path)', async () => {
		expect((await applyPromo(kv, 'MEMFULL', 4900, 'membership')).error).toBe('invalid_for_scope');
		expect((await applyPromo(kv, 'GENFULL', 21000, 'genesis')).error).toBe('invalid_for_scope');
	});

	it('still allows 100%-off on cookbook (caps are scope-specific)', async () => {
		const r = await applyPromo(kv, 'CBFREE', 2100, 'cookbook');
		expect(r.ok).toBe(true);
		expect(r.applied?.free).toBe(true);
	});
});

describe('D2 stacking order (promo on list USD, then 5% BTC discount)', () => {
	const BTC_DISCOUNT = 5;
	const kv = makeKv({
		enabled: true,
		codes: { TWENTY: { percentOff: 20, flatOff: 0, scope: 'membership' } }
	});

	it('stacks: $49 → 20% promo → 5% BTC = $37.24 (NOT replace, NOT BTC-only)', async () => {
		const baseUsd = 49;
		const lookup = await applyPromo(kv, 'TWENTY', Math.round(baseUsd * 100), 'membership');
		const listUsd = lookup.applied!.finalSats / 100; // promo-adjusted list price
		const finalUsd = listUsd * (1 - BTC_DISCOUNT / 100); // 5% BTC discount stacks

		expect(listUsd).toBeCloseTo(39.2, 5);
		expect(finalUsd).toBeCloseTo(37.24, 5); // 49 * 0.8 * 0.95
		// Guard against regressions to the other two interpretations:
		expect(finalUsd).not.toBeCloseTo(39.2, 2); // replace (promo only)
		expect(finalUsd).not.toBeCloseTo(46.55, 2); // BTC-only (49 * 0.95)
	});

	it('percent-only stacking is commutative (order within the stack is irrelevant)', async () => {
		const baseUsd = 89;
		const lookup = await applyPromo(kv, 'TWENTY', Math.round(baseUsd * 100), 'membership');
		const promoThenBtc = (lookup.applied!.finalSats / 100) * 0.95;
		const btcThenPromo = baseUsd * 0.95 * 0.8;
		expect(promoThenBtc).toBeCloseTo(btcThenPromo, 5);
	});
});

describe('scopeAllows (pure)', () => {
	it('legacy/undefined defaults to all (cookbook+membership, not genesis)', () => {
		expect(scopeAllows(undefined, 'cookbook')).toBe(true);
		expect(scopeAllows(undefined, 'membership')).toBe(true);
		expect(scopeAllows(undefined, 'genesis')).toBe(false);
	});
	it("'all' excludes genesis and sponsor", () => {
		expect(scopeAllows('all', 'membership')).toBe(true);
		expect(scopeAllows('all', 'genesis')).toBe(false);
		expect(scopeAllows('all', 'sponsor')).toBe(false);
	});
	it('exact scopes match only themselves', () => {
		expect(scopeAllows('cookbook', 'cookbook')).toBe(true);
		expect(scopeAllows('membership', 'genesis')).toBe(false);
		expect(scopeAllows('genesis', 'genesis')).toBe(true);
	});
});
