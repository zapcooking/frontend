import { describe, expect, it } from 'vitest';
import {
	ORG_PUBKEY,
	isExploreCurationDTag,
	listCoordinates,
	listPubkeys,
	listTopicSlugs,
	parseCoordinate,
	pickList
} from './curation';
import { sortAndDedupePacks } from '$lib/recipePackFilter';

const P = 'a'.repeat(64);
const list = (over: Partial<{ pubkey: string; kind: number; created_at: number; tags: string[][]; sig: string }>) => ({
	pubkey: ORG_PUBKEY,
	kind: 30004,
	created_at: 100,
	tags: [['d', 'explore-hero']],
	sig: 'valid',
	...over
});
const verify = (e: { sig: string }) => e.sig === 'valid';

describe('pickList', () => {
	it('only accepts the org pubkey, the right kind and the right d-tag', () => {
		expect(pickList([list({ pubkey: P })], 'hero', verify)).toBeNull();
		expect(pickList([list({ kind: 30003 })], 'hero', verify)).toBeNull();
		expect(pickList([list({ tags: [['d', 'explore-reads']] })], 'hero', verify)).toBeNull();
		expect(pickList([list({})], 'hero', verify)).not.toBeNull();
	});

	it('takes the newest valid version; a forged newer one never wins', () => {
		const older = list({ created_at: 100 });
		const newer = list({ created_at: 200 });
		const forged = list({ created_at: 300, sig: 'forged' });
		expect(pickList([older, forged, newer], 'hero', verify)).toBe(newer);
		expect(pickList([forged], 'hero', verify)).toBeNull();
	});
});

describe('list tags', () => {
	it('keeps `a` refs in tag order, long-form kinds only, first occurrence', () => {
		const e = {
			tags: [
				['d', 'explore-hero'],
				['a', `30023:${P}:second-course`],
				['a', `30023:${P}:a:b:c`],
				['a', `30023:${P}:second-course`],
				['a', `1:${P}:x`],
				['a', 'garbage'],
				['a', `35000:${P}:pie`]
			]
		};
		expect(listCoordinates(e).map((c) => c.identifier)).toEqual(['second-course', 'a:b:c', 'pie']);
	});

	it('parses coordinates strictly', () => {
		expect(parseCoordinate(`30023:${P}:x`)).toEqual({ kind: 30023, pubkey: P, identifier: 'x' });
		expect(parseCoordinate(`30023:${P}:`)).toBeNull();
		expect(parseCoordinate(`30023:abc:x`)).toBeNull();
		expect(parseCoordinate(undefined)).toBeNull();
	});

	it('topic slugs and pubkeys: valid, lower-cased, de-duplicated, in order', () => {
		expect(listTopicSlugs({ tags: [['t', 'Baking'], ['t', 'coffee'], ['t', 'baking'], ['t', 'no spaces'], ['p', P]] })).toEqual([
			'baking',
			'coffee'
		]);
		expect(listPubkeys({ tags: [['p', P.toUpperCase()], ['p', P], ['p', 'nope']] })).toEqual([P]);
	});
});

describe('Recipe Packs ignore the explore-* curation lists (same kind 30004)', () => {
	it('isExploreCurationDTag', () => {
		expect(isExploreCurationDTag('explore-hero')).toBe(true);
		expect(isExploreCurationDTag('explore-reads')).toBe(true);
		expect(isExploreCurationDTag('zapcooking-pack-1')).toBe(false);
		expect(isExploreCurationDTag(undefined)).toBe(false);
	});

	it('sortAndDedupePacks drops explore-* lists and keeps real packs, newest per (pubkey, d)', () => {
		const a = ['a', `30023:${P}:x`];
		const packs = sortAndDedupePacks([
			{ pubkey: ORG_PUBKEY, created_at: 5, tags: [['d', 'explore-hero'], a] },
			{ pubkey: ORG_PUBKEY, created_at: 6, tags: [['d', 'explore-reads'], a] },
			{ pubkey: P, created_at: 1, tags: [['d', 'zapcooking-pack-1'], a] },
			{ pubkey: P, created_at: 3, tags: [['d', 'zapcooking-pack-1'], a] },
			{ pubkey: P, created_at: 2, tags: [['d', 'zapcooking-pack-2'], a] },
			{ pubkey: P, created_at: 9, tags: [['d', 'empty']] }
		]);
		expect(packs.map((p) => `${p.tags![0][1]}@${p.created_at}`)).toEqual(['zapcooking-pack-1@3', 'zapcooking-pack-2@2']);
	});
});
