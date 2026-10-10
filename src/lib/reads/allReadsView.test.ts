import { describe, it, expect, vi } from 'vitest';
import { cleanCover, spamView, toSpamEvent } from './allReadsView';

const a = (id: string) => ({ id, author: { pubkey: 'p' + id }, event: { content: 'c' + id, tags: [['t', 'food']] } });

describe('spamView (the reveal toggle)', () => {
	const list = [a('1'), a('2'), a('3')];
	const reasons = new Map([['2', 'adult']]);

	it('hides flagged articles and counts them', () => {
		const v = spamView(list, reasons, false);
		expect(v.shown.map((x) => x.id)).toEqual(['1', '3']);
		expect(v.spamCount).toBe(1);
	});

	it('shows them in place when revealed, still counted', () => {
		const v = spamView(list, reasons, true);
		expect(v.shown.map((x) => x.id)).toEqual(['1', '2', '3']);
		expect(v.spamCount).toBe(1);
	});

	it('toggling back hides them again', () => {
		expect(spamView(list, reasons, true).shown).toHaveLength(3);
		expect(spamView(list, reasons, false).shown).toHaveLength(2);
	});

	it('nothing flagged: no count, nothing hidden', () => {
		expect(spamView(list, new Map(), false)).toEqual({ shown: list, spamCount: 0 });
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

	it('is null when nothing clean is left', () => {
		expect(cleanCover(cover, () => [a('2')], (x) => x.id === '2', () => ({}))).toBeNull();
	});

	it('maps an article to what the spam rules read', () => {
		expect(toSpamEvent(a('9'))).toEqual({ id: '9', pubkey: 'p9', content: 'c9', tags: [['t', 'food']] });
	});
});
