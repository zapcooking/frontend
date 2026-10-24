/**
 * Phase 3a — macros row render logic.
 *
 * Covers present / absent / rough / unparsed-servings / malformed states.
 * Layout (muted rough treatment, row spacing) is not unit-testable here —
 * eyeball those on device/browser: estimate row, rough row (~13% of
 * corpus), and the unparsed-servings label length on a narrow card.
 */
import { describe, it, expect } from 'vitest';
import { honestFigures, macrosRowView, parseMacrosBlock } from './macrosDisplay';
import type { NourishMacros } from './types';

const baseMacros = (over: Partial<NourishMacros> = {}): NourishMacros => ({
	perServing: { kcal: 420, protein_g: 32, carbs_g: 28, fat_g: 18 },
	servingsUsed: 4,
	servingsParsed: true,
	confidence: 'estimate',
	method: 'llm-per100g-v1',
	...over
});

describe('macrosRowView — present / absent', () => {
	it('returns null when macros are absent (v3 / degraded) — no row', () => {
		expect(macrosRowView(undefined)).toBeNull();
		expect(macrosRowView(null)).toBeNull();
	});

	it('returns a view when macros are present', () => {
		const view = macrosRowView(baseMacros());
		expect(view).not.toBeNull();
		expect(view!.kcal).toBe(420);
		expect(view!.protein_g).toBe(32);
		expect(view!.carbs_g).toBe(28);
		expect(view!.fat_g).toBe(18);
		expect(view!.label).toBe('Estimated per serving');
		expect(view!.tone).toBe('estimate');
	});
});

describe('macrosRowView — confidence copy', () => {
	it('estimate → "Estimated per serving"', () => {
		const view = macrosRowView(baseMacros({ confidence: 'estimate' }));
		expect(view!.label).toBe('Estimated per serving');
		expect(view!.tone).toBe('estimate');
	});

	it('rough → "Rough estimate" with rough tone (honesty framing)', () => {
		// Breaded+fried / bone-in: as-written diverges from as-consumed —
		// we'd rather tell you than guess (discovery rough-class rationale).
		const view = macrosRowView(baseMacros({ confidence: 'rough' }));
		expect(view!.label).toBe('Rough estimate');
		expect(view!.tone).toBe('rough');
	});
});

describe('macrosRowView — servingsParsed: false (0.4)', () => {
	it('estimate + unparsed → discloses assumed servings', () => {
		const view = macrosRowView(
			baseMacros({ servingsParsed: false, servingsUsed: 4 })
		);
		expect(view!.label).toBe('Estimated per serving (servings assumed: 4)');
		expect(view!.tone).toBe('estimate');
	});

	it('rough + unparsed → Rough estimate + assumed servings', () => {
		const view = macrosRowView(
			baseMacros({
				confidence: 'rough',
				servingsParsed: false,
				servingsUsed: 4
			})
		);
		expect(view!.label).toBe('Rough estimate (servings assumed: 4)');
		expect(view!.tone).toBe('rough');
	});
});

describe('honestFigures — no false precision', () => {
	it('coerces to whole numbers; never emits decimals', () => {
		const figs = honestFigures({
			kcal: 420.4,
			protein_g: 32.7,
			carbs_g: 28.2,
			fat_g: 18.9
		});
		expect(figs).toEqual({
			kcal: 420,
			protein_g: 33,
			carbs_g: 28,
			fat_g: 19
		});
		for (const n of Object.values(figs)) {
			expect(Number.isInteger(n)).toBe(true);
		}
	});

	it('does not re-round kcal to a finer precision than the server', () => {
		// Server already rounded to nearest 10; UI must not invent .0 or
		// locale-formatted decimals that look more precise.
		const figs = honestFigures({
			kcal: 420,
			protein_g: 32,
			carbs_g: 28,
			fat_g: 18
		});
		expect(String(figs.kcal)).toBe('420');
		expect(String(figs.protein_g)).toBe('32');
	});
});

describe('parseMacrosBlock — degrade to absent on garbage', () => {
	it('accepts a well-formed v4 block', () => {
		const parsed = parseMacrosBlock(baseMacros());
		expect(parsed).toEqual(baseMacros());
	});

	it('returns undefined for missing / non-object / incomplete perServing', () => {
		expect(parseMacrosBlock(undefined)).toBeUndefined();
		expect(parseMacrosBlock(null)).toBeUndefined();
		expect(parseMacrosBlock('nope')).toBeUndefined();
		expect(parseMacrosBlock({ perServing: { kcal: 100 } })).toBeUndefined();
	});

	it('returns undefined for invalid confidence or servingsParsed', () => {
		expect(
			parseMacrosBlock({
				...baseMacros(),
				confidence: 'high'
			})
		).toBeUndefined();
		expect(
			parseMacrosBlock({
				...baseMacros(),
				servingsParsed: 'yes'
			})
		).toBeUndefined();
	});

	it('accepts rough confidence', () => {
		const parsed = parseMacrosBlock(baseMacros({ confidence: 'rough' }));
		expect(parsed?.confidence).toBe('rough');
	});
});

describe('eyeball checklist (not automated)', () => {
	it('documents layout states that need a device/browser pass', () => {
		// These are intentional documentation assertions — layout isn't
		// unit-testable without a Svelte harness.
		const states = [
			'estimate row — normal weight, four figures aligned',
			'rough row — muted/hedged treatment (~13% of corpus)',
			'unparsed-servings label — wraps cleanly on narrow modal',
			'absent macros — card identical to pre-3a (no empty row)'
		];
		expect(states).toHaveLength(4);
	});
});
