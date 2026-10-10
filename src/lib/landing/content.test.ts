import { describe, expect, it } from 'vitest';
import {
	chooseCover,
	eventImage,
	isFastResizeImage,
	longformCard,
	noteCard,
	parseProfile,
	rotateDaily,
	type LongformCard
} from './content';
import { responsiveImg } from './responsiveImg';
import { ev, pk } from './fakeRelay.testutil';

const FAST = 'https://image.nostr.build/a.jpg'; // native
const FAST_CF = 'https://blossom.primal.net/b.jpg'; // Cloudflare origin
const SLOW = 'https://example.org/c.jpg'; // weserv tail

const card = (coordinate: string, image: string): LongformCard => ({
	type: 'recipe',
	coordinate,
	href: `/recipe/${coordinate}`,
	title: coordinate,
	image,
	author: { pubkey: pk('a') },
	publishedAt: 1
});

describe('chooseCover (D14: the cover photo must be on a fast-resize host)', () => {
	it('keeps the editor’s first choice when it is fast', () => {
		const r = chooseCover([card('a', FAST), card('b', FAST_CF), card('c', FAST)], []);
		expect(r.cover?.coordinate).toBe('a');
		expect(r.picks.map((p) => p.coordinate)).toEqual(['b', 'c']);
	});

	it('promotes the next valid pick when the first is slow; the slow one stays a pick', () => {
		const r = chooseCover([card('slow', SLOW), card('b', FAST), card('c', FAST)], []);
		expect(r.cover?.coordinate).toBe('b');
		expect(r.picks.map((p) => p.coordinate)).toEqual(['slow', 'c']);
	});

	it('falls back to newest recipes, never an empty cover while any fast photo exists', () => {
		const r = chooseCover([card('slow', SLOW)], [card('slow', SLOW), card('n1', FAST), card('n2', FAST)]);
		expect(r.cover?.coordinate).toBe('n1');
		expect(r.picks.map((p) => p.coordinate)).toEqual(['slow', 'n2']);
		expect(chooseCover([], []).cover).toBeNull();
	});

	it('no fast photo anywhere: no cover, but the candidates still fill the picks', () => {
		const r = chooseCover([card('slow1', SLOW), card('slow2', SLOW), card('slow3', SLOW)], []);
		expect(r.cover).toBeNull();
		expect(r.picks.map((p) => p.coordinate)).toEqual(['slow1', 'slow2']);
	});

	it('classifies hosts by the routing table', () => {
		expect(isFastResizeImage(FAST)).toBe(true);
		expect(isFastResizeImage(FAST_CF)).toBe(true);
		expect(isFastResizeImage(SLOW)).toBe(false);
	});
});

describe('cards', () => {
	it('recipe vs article links, title/image required', () => {
		const recipe = ev({
			kind: 30023,
			pubkey: pk('a'),
			tags: [['d', 'pie'], ['title', 'Pie'], ['image', FAST], ['t', 'zapcooking']]
		});
		const article = ev({ kind: 30023, pubkey: pk('a'), tags: [['d', 'essay'], ['title', 'On bread'], ['image', FAST]] });
		expect(longformCard(recipe)?.href).toMatch(/^\/recipe\/naddr1/);
		expect(longformCard(article)?.href).toMatch(/^\/reads\/naddr1/);
		expect(longformCard(ev({ kind: 30023, pubkey: pk('a'), tags: [['d', 'x'], ['title', 'No photo']] }))).toBeNull();
	});

	it('published_at in milliseconds is read as seconds', () => {
		const ms = ev({
			kind: 30023,
			pubkey: pk('a'),
			created_at: 1_700_000_000,
			tags: [['d', 'borscht'], ['title', 'Borscht'], ['image', FAST], ['published_at', '1700000000000']]
		});
		expect(longformCard(ms)?.publishedAt).toBe(1_700_000_000);
		const s = ev({ kind: 30023, pubkey: pk('a'), tags: [['d', 'x'], ['title', 'X'], ['image', FAST], ['published_at', '1700000000']] });
		expect(longformCard(s)?.publishedAt).toBe(1_700_000_000);
	});

	it('Fresh cards: photos only, no replies, no content warnings, media URLs stripped', () => {
		const note = ev({ kind: 1, pubkey: pk('a'), content: `Sunday bread ${FAST}` });
		expect(noteCard(note)).toMatchObject({ image: FAST, text: 'Sunday bread' });
		expect(noteCard(ev({ kind: 1, pubkey: pk('a'), content: 'no photo' }))).toBeNull();
		expect(noteCard(ev({ kind: 1, pubkey: pk('a'), content: FAST, tags: [['e', 'x']] }))).toBeNull();
		expect(noteCard(ev({ kind: 1, pubkey: pk('a'), content: FAST, tags: [['content-warning', '']] }))).toBeNull();
	});

	it('event images: image tag, then imeta, then content; https only', () => {
		expect(eventImage({ tags: [['imeta', `url ${FAST}`, 'm image/jpeg']], content: '' })).toBe(FAST);
		expect(eventImage({ tags: [['image', 'http://x.test/a.jpg']], content: '' })).toBeUndefined();
	});

	it('profiles: display_name first, https pictures only, bad JSON tolerated', () => {
		expect(parseProfile({ content: JSON.stringify({ name: 'n', display_name: 'Display', picture: FAST }) })).toEqual({
			name: 'Display',
			picture: FAST,
			about: undefined
		});
		expect(parseProfile({ content: '{oops' })).toEqual({});
	});
});

describe('rotateDaily', () => {
	it('keeps list order inside the window (cyclic), stable within a UTC day, moving by one each day', () => {
		const items = ['a', 'b', 'c', 'd'];
		const day = 86400 * 1000;
		expect(rotateDaily(items, 2, day)).toEqual(rotateDaily(items, 2, day + 86399));
		expect(rotateDaily(items, 2, day)).toEqual(['a', 'b']);
		expect(rotateDaily(items, 2, day + 86400)).toEqual(['b', 'c']);
		expect(rotateDaily(['a'], 2, 0)).toEqual(['a']);
	});
});

describe('responsiveImg', () => {
	it('builds a srcset through the routing table, de-duplicating fixed renditions', () => {
		const r = responsiveImg(FAST, [480, 768, 1200], '100vw');
		expect(r.srcset?.split(', ')).toHaveLength(2); // nostr.build serves 640/1280 renditions
		expect(r.sizes).toBe('100vw');
		expect(responsiveImg('/local.png', [480], '100vw')).toEqual({ src: '/local.png' });
	});
});
