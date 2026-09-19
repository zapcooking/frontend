import { describe, it, expect } from 'vitest';
import {
	decodeNaddr,
	evaluateReadsContent,
	findDeniedTerm,
	isBlockedReadsPointer,
	mergeReadsLists,
	naddrFromEvent,
	normalizeForScan,
	type ReadsEventLike
} from './moderation';
import { DEFAULT_READS_MODERATION } from './moderationConfig';

const SPAM_PUBKEY = '16c0ebba83c6f31931a912cef8738e59318b5879c7d931af2a9c204f6bd79992';
const MILA_ID = 'bf283bf0f9283b30a15c121b3065aefba4b8c45c46f44f516437bb419d556a8b';
const MILA_NADDR =
	'naddr1qvzqqqr4gupzq9kqawag83hnryc6jykwlpecukf33dv8n37exxhj48pqfa4a0xvjqqkxwctvd3jhy7fdvg6xvvpev5ck2tfcv43nqtf5xdjkzttpv9snvtfe8qekvcnp8q6nqwfe8qe902e5';

function event(partial: Partial<ReadsEventLike> & { title?: string; summary?: string; hashtags?: string[] }): ReadsEventLike {
	const tags: string[][] = [...(partial.tags || [])];
	if (partial.title) tags.push(['title', partial.title]);
	if (partial.summary) tags.push(['summary', partial.summary]);
	if (partial.hashtags) {
		for (const t of partial.hashtags) tags.push(['t', t]);
	}
	if (!tags.some((t) => t[0] === 'd')) tags.push(['d', 'slug']);
	return {
		id: partial.id || 'a'.repeat(64),
		pubkey: partial.pubkey || 'b'.repeat(64),
		content: partial.content || 'A wholesome sourdough primer with plenty of detail. '.repeat(10),
		kind: 30023,
		tags
	};
}

describe('normalizeForScan', () => {
	it('lowercases and strips punctuation', () => {
		expect(normalizeForScan('Big-Ass Tacos!')).toBe('big ass tacos');
	});

	it('folds a cyrillic homoglyph', () => {
		// Cyrillic а (U+0430) in place of latin a
		expect(normalizeForScan('nаked')).toBe('naked');
	});

	it('folds light leetspeak', () => {
		expect(normalizeForScan('n4ked')).toBe('naked');
	});

	it('strips zero-width characters', () => {
		expect(normalizeForScan('na\u200bked')).toBe('naked');
	});
});

describe('keyword denylist', () => {
	it('matches the spam article title', () => {
		const hit = findDeniedTerm('Mila Naturist Naked House Tour and Cooking Photos');
		expect(['naked', 'naturist']).toContain(hit);
	});

	it('does not match foodporn (legitimate food hashtag)', () => {
		expect(findDeniedTerm('foodporn')).toBeNull();
		expect(findDeniedTerm('A #foodporn gallery of pasta')).toBeNull();
	});

	it('matches spaced-out obfuscation', () => {
		expect(findDeniedTerm('n.a.k.e.d house tour')).toBe('naked');
	});

	it('matches a multi-word phrase', () => {
		expect(findDeniedTerm('photos of a big ass')).toBe('big ass');
	});

	it('matches onlyfans with a space', () => {
		expect(findDeniedTerm('find me on only fans')).toBe('only fans');
	});

	it('matches "naked cake" (accepted false positive) and allows clean copy', () => {
		expect(findDeniedTerm('Naked cake with berry filling')).toBe('naked');
		expect(findDeniedTerm('Sourdough starter and roasted chicken')).toBeNull();
	});
});

describe('blocklists', () => {
	it('seeds the NSFW spam pubkey and naddr', () => {
		expect(DEFAULT_READS_MODERATION.blockedPubkeys).toContain(SPAM_PUBKEY);
		expect(DEFAULT_READS_MODERATION.blockedEventIds).toContain(MILA_ID);
		expect(DEFAULT_READS_MODERATION.blockedNaddrs).toContain(MILA_NADDR);
	});

	it('blocks a pointer by pubkey before fetch', () => {
		expect(isBlockedReadsPointer({ pubkey: SPAM_PUBKEY })).toBe(true);
		expect(isBlockedReadsPointer({ naddr: MILA_NADDR })).toBe(true);
		expect(isBlockedReadsPointer({ pubkey: 'c'.repeat(64) })).toBe(false);
	});

	it('round-trips the seeded naddr', () => {
		const decoded = decodeNaddr(MILA_NADDR);
		expect(decoded?.pubkey).toBe(SPAM_PUBKEY);
		expect(decoded?.identifier).toBe('gallery-b4f09e1e-8ec0-43ea-aaa6-983fba850998');
		const encoded = naddrFromEvent({
			pubkey: SPAM_PUBKEY,
			kind: 30023,
			tags: [['d', 'gallery-b4f09e1e-8ec0-43ea-aaa6-983fba850998']]
		});
		expect(encoded).toBe(MILA_NADDR);
	});
});

describe('evaluateReadsContent', () => {
	it('blocks the known spam pubkey even with a clean title', () => {
		const result = evaluateReadsContent(
			event({ pubkey: SPAM_PUBKEY, title: 'Homemade pasta' })
		);
		expect(result.blocked).toBe(true);
		if (result.blocked) expect(result.reason).toBe('pubkey');
	});

	it('blocks by event id', () => {
		const result = evaluateReadsContent(event({ id: MILA_ID, pubkey: 'c'.repeat(64) }));
		expect(result.blocked).toBe(true);
		if (result.blocked) expect(result.reason).toBe('event');
	});

	it('blocks by keyword in title and reports the term', () => {
		const result = evaluateReadsContent(
			event({ title: 'Mila Naturist Naked House Tour and Cooking Photos' })
		);
		expect(result.blocked).toBe(true);
		if (result.blocked) {
			expect(result.reason).toBe('keyword');
			expect(['naked', 'naturist']).toContain(result.matchedTerm);
			expect(result.field).toBe('title');
		}
	});

	it('blocks by keyword in summary', () => {
		const result = evaluateReadsContent(
			event({ title: 'House tour', summary: 'Visit our onlyfans kitchen' })
		);
		expect(result.blocked).toBe(true);
		if (result.blocked) {
			expect(result.reason).toBe('keyword');
			expect(result.field).toBe('summary');
		}
	});

	it('blocks by hashtag', () => {
		const result = evaluateReadsContent(event({ title: 'Photos', hashtags: ['cooking', 'nsfw'] }));
		expect(result.blocked).toBe(true);
		if (result.blocked) {
			expect(result.reason).toBe('keyword');
			expect(result.field).toBe('hashtag');
			expect(result.matchedTerm).toBe('nsfw');
		}
	});

	it('blocks by first 500 chars of body, not later copy', () => {
		const early = evaluateReadsContent(
			event({ title: 'Dinner', content: 'xxx ' + 'pasta '.repeat(40) })
		);
		expect(early.blocked).toBe(true);

		const late = evaluateReadsContent(
			event({ title: 'Dinner', content: 'A'.repeat(500) + ' xxx porn' })
		);
		expect(late.blocked).toBe(false);
	});

	it('allows a normal cooking article', () => {
		const result = evaluateReadsContent(
			event({
				title: 'Farmhouse sourdough',
				summary: 'A weekend bake',
				hashtags: ['cooking', 'foodstr', 'foodporn'],
				content: 'Mix flour, water, and salt. Stretch and fold. Bake hot.'
			})
		);
		expect(result.blocked).toBe(false);
	});
});

describe('mergeReadsLists', () => {
	it('unions pubkeys and keeps seed entries', () => {
		const extra = 'd'.repeat(64);
		const merged = mergeReadsLists(DEFAULT_READS_MODERATION, {
			blockedPubkeys: [extra],
			blockedEventIds: [],
			blockedNaddrs: [],
			denylist: []
		});
		expect(merged.blockedPubkeys).toContain(SPAM_PUBKEY);
		expect(merged.blockedPubkeys).toContain(extra);
	});

	it('lets an overlay denylist replace the seed when provided', () => {
		const merged = mergeReadsLists(DEFAULT_READS_MODERATION, {
			blockedPubkeys: [],
			blockedEventIds: [],
			blockedNaddrs: [],
			denylist: ['customterm']
		});
		expect(merged.denylist).toEqual(['customterm']);
		expect(merged.blockedPubkeys).toContain(SPAM_PUBKEY);
	});
});
