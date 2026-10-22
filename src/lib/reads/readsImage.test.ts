import { describe, expect, it } from 'vitest';
import { readsImage } from './readsImage';

const NATIVE = 'https://image.nostr.build/a.jpg';
const SLOW = 'https://vcavallo.nyc3.cdn.digitaloceanspaces.com/random/food-cpi.webp';
const PH = '/placeholder.png';

describe('readsImage', () => {
	it('first attempt: a sized rendition through the routing table, never the raw original', () => {
		const hero = readsImage(NATIVE, 'hero', 0, PH);
		expect(hero.src).not.toBe(NATIVE);
		expect(hero.src).toMatch(/[?&]w=\d+/);
		expect(hero.srcset).toBeTruthy();
		expect(hero.sizes).toBe('(min-width: 1024px) 60vw, 100vw');
		// A host without native sizing goes through the resizer (weserv in tests).
		const slow = readsImage(SLOW, 'card', 0, PH);
		expect(slow.src).toMatch(/^https:\/\/images\.weserv\.nl\/\?url=/);
		expect(slow.srcset?.split(', ').length).toBe(3);
	});

	it('tertiary thumbnails ask for a small rendition', () => {
		expect(readsImage(SLOW, 'tertiary', 0, PH).src).toMatch(/w=160/);
	});

	it('falls back to the original, then the placeholder', () => {
		expect(readsImage(NATIVE, 'hero', 1, PH)).toEqual({ src: NATIVE });
		expect(readsImage(NATIVE, 'hero', 2, PH)).toEqual({ src: PH });
		expect(readsImage(null, 'card', 0, PH)).toEqual({ src: PH });
	});
});
