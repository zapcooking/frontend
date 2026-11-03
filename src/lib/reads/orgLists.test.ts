import { describe, it, expect } from 'vitest';
import { ORG_PUBKEY, pickOrgList } from '$lib/landing/curation';
import { evaluateReadsContent, mergeReadsLists, naddrFromEvent } from './moderation';
import { DEFAULT_READS_MODERATION } from './moderationConfig';
import {
	ORG_MODERATION_LISTS,
	coordinateToNaddr,
	orgModerationAsReadsLists,
	parseOrgModeration
} from './orgLists';

const SPAMMER = 'a78b5f28'.padEnd(64, '1');
const AUTHOR = 'c'.repeat(64);
const HIDDEN_ID = 'd'.repeat(64);
const OTHER = 'e'.repeat(64);

function list(d: string, tags: string[][], over: Partial<{ pubkey: string; created_at: number }> = {}) {
	return { pubkey: over.pubkey ?? ORG_PUBKEY, kind: 30000, created_at: over.created_at ?? 100, tags: [['d', d], ...tags] };
}

const block = list('feed-block', [['p', SPAMMER], ['p', 'not-hex'], ['p', SPAMMER.toUpperCase()]]);
const hidden = list('feed-hidden', [
	['e', HIDDEN_ID],
	['a', `30023:${AUTHOR}:hidden-article`],
	['a', `35000:${AUTHOR}:test-recipe`],
	['a', 'garbage'],
	['e', 'short']
]);

function articleBy(pubkey: string, d: string, id = OTHER) {
	return {
		id,
		pubkey,
		kind: 30023,
		content: 'A long, wholesome sourdough article. '.repeat(20),
		tags: [['d', d], ['title', 'Sourdough'], ['t', 'food']]
	};
}

describe('parseOrgModeration', () => {
	it('reads p from feed-block and e/a from feed-hidden, valid and de-duplicated', () => {
		expect(parseOrgModeration(block, hidden)).toEqual({
			blockedPubkeys: [SPAMMER],
			hiddenEventIds: [HIDDEN_ID],
			hiddenCoordinates: [`30023:${AUTHOR}:hidden-article`, `35000:${AUTHOR}:test-recipe`]
		});
	});

	it('is empty for missing lists', () => {
		expect(parseOrgModeration(null, null)).toEqual({ blockedPubkeys: [], hiddenEventIds: [], hiddenCoordinates: [] });
	});

	it("doesn't read p tags off the hidden list or e/a off the block list", () => {
		const m = parseOrgModeration(list('feed-block', [['e', HIDDEN_ID]]), list('feed-hidden', [['p', SPAMMER]]));
		expect(m).toEqual({ blockedPubkeys: [], hiddenEventIds: [], hiddenCoordinates: [] });
	});
});

describe('org pinning (pickOrgList)', () => {
	const ok = () => true;
	it('takes the newest org list with the right kind and d-tag', () => {
		const older = list('feed-block', [], { created_at: 50 });
		expect(pickOrgList([older, block], ORG_MODERATION_LISTS.block, ok)).toBe(block);
	});

	it('ignores a list signed by anyone else, however new', () => {
		const forged = list('feed-block', [['p', AUTHOR]], { pubkey: OTHER, created_at: 999 });
		expect(pickOrgList([forged, block], ORG_MODERATION_LISTS.block, ok)).toBe(block);
		expect(pickOrgList([forged], ORG_MODERATION_LISTS.block, ok)).toBeNull();
	});

	it('ignores a list that fails verification', () => {
		expect(pickOrgList([block], ORG_MODERATION_LISTS.block, () => false)).toBeNull();
	});

	it("doesn't take the hidden list for the block list", () => {
		expect(pickOrgList([hidden], ORG_MODERATION_LISTS.block, ok)).toBeNull();
	});
});

describe('org lists as Reads moderation', () => {
	const lists = mergeReadsLists(DEFAULT_READS_MODERATION, orgModerationAsReadsLists(parseOrgModeration(block, hidden)));

	it('blocks every article by a feed-block author', () => {
		expect(evaluateReadsContent(articleBy(SPAMMER, 'pizza-guide'), lists)).toMatchObject({ blocked: true, reason: 'pubkey' });
	});

	it('hides a feed-hidden event id', () => {
		expect(evaluateReadsContent(articleBy(AUTHOR, 'other', HIDDEN_ID), lists)).toMatchObject({ blocked: true, reason: 'event' });
	});

	it('hides every version of a feed-hidden coordinate', () => {
		const v2 = articleBy(AUTHOR, 'hidden-article', 'f'.repeat(64));
		expect(evaluateReadsContent(v2, lists)).toMatchObject({ blocked: true, reason: 'naddr' });
	});

	it('leaves the same author’s other articles alone', () => {
		expect(evaluateReadsContent(articleBy(AUTHOR, 'fine-article'), lists).blocked).toBe(false);
	});

	it("keeps the seed denylist (the overlay doesn't replace it)", () => {
		expect(lists.denylist).toEqual(DEFAULT_READS_MODERATION.denylist);
	});

	it('encodes a coordinate as the naddr an event of it produces', () => {
		expect(coordinateToNaddr(`30023:${AUTHOR}:hidden-article`)).toBe(naddrFromEvent(articleBy(AUTHOR, 'hidden-article')));
		expect(coordinateToNaddr('nope')).toBeNull();
	});
});
