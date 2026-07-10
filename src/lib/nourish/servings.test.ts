import { describe, it, expect } from 'vitest';
import { parseServings } from './servings';

describe('parseServings (Phase 0 §0.4)', () => {
	it('falls back to 4 when empty / missing', () => {
		expect(parseServings('')).toEqual({ n: 4, parsed: false });
		expect(parseServings(null)).toEqual({ n: 4, parsed: false });
		expect(parseServings(undefined)).toEqual({ n: 4, parsed: false });
		expect(parseServings('   ')).toEqual({ n: 4, parsed: false });
	});

	it('parses bare integers', () => {
		expect(parseServings('4')).toEqual({ n: 4, parsed: true });
		expect(parseServings('12')).toEqual({ n: 12, parsed: true });
	});

	it('parses leading integer with trailing note', () => {
		expect(parseServings('4 (~3-tbsp servings)')).toEqual({ n: 4, parsed: true });
	});

	it('parses ranges as midpoint with lo/hi', () => {
		expect(parseServings('4-6')).toEqual({ n: 5, parsed: true, lo: 4, hi: 6 });
		expect(parseServings('4–6')).toEqual({ n: 5, parsed: true, lo: 4, hi: 6 });
		expect(parseServings('8-10')).toEqual({ n: 9, parsed: true, lo: 8, hi: 10 });
		expect(parseServings('Serves 3 to 4 people.')).toEqual({
			n: 4,
			parsed: true,
			lo: 3,
			hi: 4
		});
	});

	it('treats unparseable prose as fallback', () => {
		expect(parseServings('Variable')).toEqual({ n: 4, parsed: false });
		expect(parseServings('four')).toEqual({ n: 4, parsed: false });
		expect(parseServings('a few')).toEqual({ n: 4, parsed: false });
	});
});
