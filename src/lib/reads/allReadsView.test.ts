import { describe, it, expect, vi } from 'vitest';
import { cleanCover, foldReason, readsFold, toSpamEvent } from './allReadsView';

const a = (id: string) => ({ id, author: { pubkey: 'p' + id }, event: { content: 'c' + id, tags: [['t', 'food']] } });

describe('readsFold (the two reveal lines)', () => {
	const list = [a('1'), a('2'), a('3')];
	const reasons = new Map([['2', 'adult']]);
	const none = { spam: false, strangers: false };

	it('hides flagged articles and counts them', () => {
		const v = readsFold(list, reasons, null, none);
		expect(v.shown.map((x) => x.id)).toEqual(['1', '3']);
		expect(v.spamCount).toBe(1);
	});

	it('shows them in place when revealed, still counted', () => {
		const v = readsFold(list, reasons, null, { spam: true, strangers: false });
		expect(v.shown.map((x) => x.id)).toEqual(['1', '2', '3']);
		expect(v.spamCount).toBe(1);
	});

	it('nothing flagged, no trust map: everything shown, nothing counted', () => {
		expect(readsFold(list, new Map(), null, none)).toEqual({ shown: list, spamCount: 0, strangerCount: 0 });
	});

	const trust = new Map([
		['p1', 'trusted'],
		['p2', 'trusted'],
		['p3', 'stranger'],
		['p4', 'unknown']
	] as const);
	const four = [a('1'), a('2'), a('3'), a('4'), a('5')];

	it('strangers fold on their own line; unknown shows; pending is held back uncounted', () => {
		const v = readsFold(four, new Map(), trust, none);
		expect(v.shown.map((x) => x.id)).toEqual(['1', '2', '4']);
		expect(v.strangerCount).toBe(1);
		expect(v.spamCount).toBe(0);
	});

	it('revealing strangers shows them, not spam; revealing spam shows spam, not strangers', () => {
		expect(readsFold(four, reasons, trust, { spam: false, strangers: true }).shown.map((x) => x.id)).toEqual(['1', '3', '4']);
		expect(readsFold(four, reasons, trust, { spam: true, strangers: false }).shown.map((x) => x.id)).toEqual(['1', '2', '4']);
	});

	it('spam rules apply to trusted authors too, and spam from a stranger counts once, as spam', () => {
		const v = readsFold(four, new Map([['1', 'links'], ['3', 'adult']]), trust, none);
		expect(v.shown.map((x) => x.id)).toEqual(['2', '4']);
		expect(v.spamCount).toBe(2);
		expect(v.strangerCount).toBe(0);
	});

	it('pending authors never show, whatever is revealed', () => {
		expect(readsFold([a('5')], new Map(), trust, { spam: true, strangers: true }).shown).toEqual([]);
	});

	it('matches authors case-insensitively', () => {
		expect(foldReason({ id: 'x', author: { pubkey: 'P3' } }, new Map(), trust)).toBe('stranger');
	});
});

describe('cleanCover', () => {
	const cover = { hero: a('1'), secondary: [a('2')], tertiary: [a('3')] };

	it('keeps a clean cover as is, without scanning candidates', () => {
		const clean = vi.fn(() => []);
		expect(cleanCover(cover, clean, () => false, () => null)).toBe(cover);
		expect(clean).not.toHaveBeenCalled();
	});

	it('re-picks from clean candidates when any cover article is out', () => {
		const recurate = vi.fn((xs: ReturnType<typeof a>[]) => ({ hero: xs[0] }));
		const next = cleanCover(cover, () => [a('2'), a('4')], (x) => x.id === '2', recurate);
		expect(recurate.mock.calls[0][0].map((x: { id: string }) => x.id)).toEqual(['4']);
		expect(next?.hero?.id).toBe('4');
	});

	it('with no cover, picks one once a clean candidate exists', () => {
		expect(cleanCover(null, () => [a('2')], (x) => x.id === '2', () => ({ hero: a('x') }))).toBeNull();
		expect(cleanCover(null, () => [a('4')], () => false, (xs) => ({ hero: xs[0] }))?.hero?.id).toBe('4');
	});

	it('is null when nothing clean is left', () => {
		expect(cleanCover(cover, () => [a('2')], (x) => x.id === '2', () => ({}))).toBeNull();
	});

	it('maps an article to what the spam rules read', () => {
		expect(toSpamEvent(a('9'))).toEqual({ id: '9', pubkey: 'p9', content: 'c9', tags: [['t', 'food']] });
	});
});
