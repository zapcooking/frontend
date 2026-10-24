/**
 * Phase 2 — pantry event shape + label tags + rescore wiring.
 *
 * Pure builder tests (no network). Rescore round-trip proves the admin
 * endpoint passes macros/labels into publishNourishEvent — the shared
 * engine alone does not make that free.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildNourishEventParts, publishNourishEvent } from './nourishPublisher.server';
import {
	NOURISH_LABEL_NAMESPACE,
	NOURISH_PROMPT_VERSION,
	type NourishScores,
	type NourishMacros,
	type NourishLabel
} from './types';
import { generateSecretKey } from 'nostr-tools';

function baseScores(): NourishScores {
	return {
		gut: { score: 7, label: 'Good', reason: 'r' },
		protein: { score: 8, label: 'Good', reason: 'r' },
		realFood: { score: 7, label: 'Good', reason: 'r' },
		antiInflammatory: { score: 6, label: 'Moderate', reason: 'r' },
		bloodSugar: { score: 6, label: 'Moderate', reason: 'r' },
		immuneSupportive: { score: 6, label: 'Moderate', reason: 'r' },
		brainHealth: { score: 6, label: 'Moderate', reason: 'r' },
		heartHealth: { score: 6, label: 'Moderate', reason: 'r' },
		overall: { score: 7, label: 'Good', reason: 'weighted' },
		summary: 'A solid recipe.',
		cacheVersion: '2.0'
	};
}

const RECIPE_PUBKEY = 'a'.repeat(64);
const RECIPE_DTAG = 'test-recipe';
const CONTENT_HASH = 'b'.repeat(64);

const sampleMacros: NourishMacros = {
	perServing: { kcal: 420, protein_g: 32, carbs_g: 28, fat_g: 18 },
	servingsUsed: 4,
	servingsParsed: true,
	confidence: 'estimate',
	method: 'llm-per100g-v1'
};

const sampleLabels: NourishLabel[] = [
	'protein:20plus',
	'protein:30plus',
	'kcal:under600',
	'kcal:under800',
	'carbs:under40',
	'seedoil:free'
];

describe('buildNourishEventParts — additive event shape', () => {
	it('emits macros in content and L/l tags per §3 bucket table', () => {
		const { tags, content } = buildNourishEventParts({
			recipePubkey: RECIPE_PUBKEY,
			recipeDTag: RECIPE_DTAG,
			contentHash: CONTENT_HASH,
			scores: baseScores(),
			improvements: ['use olive oil'],
			ingredientSignals: [{ name: 'chicken', signals: ['protein'], contribution: 'protein' }],
			macros: sampleMacros,
			labels: sampleLabels,
			createdAt: 1_700_000_000
		});

		expect(content.macros).toEqual(sampleMacros);
		expect(content.labels).toEqual(sampleLabels);
		expect(content.promptVersion).toBe(NOURISH_PROMPT_VERSION);
		expect(content.createdAt).toBe(1_700_000_000);

		expect(tags).toContainEqual(['L', NOURISH_LABEL_NAMESPACE]);
		for (const label of sampleLabels) {
			expect(tags).toContainEqual(['l', label, NOURISH_LABEL_NAMESPACE]);
		}
		// kcal-as-tag decision (0.5): no raw numeric kcal tag
		expect(tags.some((t) => t[0] === 'nourish_kcal')).toBe(false);
	});

	it('v4 event missing macros (degraded-to-omitted) publishes with no macro tags', () => {
		const { tags, content } = buildNourishEventParts({
			recipePubkey: RECIPE_PUBKEY,
			recipeDTag: RECIPE_DTAG,
			contentHash: CONTENT_HASH,
			scores: baseScores(),
			improvements: [],
			ingredientSignals: [],
			labels: ['seedoil:free']
		});

		expect(content.macros).toBeUndefined();
		expect(tags.some((t) => t[0] === 'nourish_kcal')).toBe(false);
		expect(tags).toContainEqual(['L', NOURISH_LABEL_NAMESPACE]);
		expect(tags).toContainEqual(['l', 'seedoil:free', NOURISH_LABEL_NAMESPACE]);
	});

	it('emits no L/l tags when labels are empty or omitted', () => {
		const empty = buildNourishEventParts({
			recipePubkey: RECIPE_PUBKEY,
			recipeDTag: RECIPE_DTAG,
			contentHash: CONTENT_HASH,
			scores: baseScores(),
			improvements: [],
			ingredientSignals: [],
			labels: []
		});
		expect(empty.tags.some((t) => t[0] === 'L' || t[0] === 'l')).toBe(false);
		expect(empty.content.labels).toBeUndefined();

		const omitted = buildNourishEventParts({
			recipePubkey: RECIPE_PUBKEY,
			recipeDTag: RECIPE_DTAG,
			contentHash: CONTENT_HASH,
			scores: baseScores(),
			improvements: [],
			ingredientSignals: []
		});
		expect(omitted.tags.some((t) => t[0] === 'L' || t[0] === 'l')).toBe(false);
		expect(omitted.content.macros).toBeUndefined();
	});

	it('preserves v1/v2/v3 score fields so older consumers keep working', () => {
		const { content, tags } = buildNourishEventParts({
			recipePubkey: RECIPE_PUBKEY,
			recipeDTag: RECIPE_DTAG,
			contentHash: CONTENT_HASH,
			scores: baseScores(),
			improvements: ['x'],
			ingredientSignals: [],
			audienceScores: {
				kidFriendly: { score: 8, label: 'Good', reason: 'mild' }
			},
			macros: sampleMacros,
			labels: sampleLabels
		});

		expect(content.gut).toEqual(baseScores().gut);
		expect(content.heartHealth).toEqual(baseScores().heartHealth);
		expect(content.audience).toEqual({
			kidFriendly: { score: 8, label: 'Good', reason: 'mild' }
		});
		expect(tags).toContainEqual(['audience_kidfriendly', '8']);
		expect(tags).toContainEqual(['nourish_hearthealth', '6']);
		expect(tags).toContainEqual(['prompt_version', NOURISH_PROMPT_VERSION]);
	});

	it('emits updated_at on rescore events', () => {
		const { tags, content } = buildNourishEventParts({
			recipePubkey: RECIPE_PUBKEY,
			recipeDTag: RECIPE_DTAG,
			contentHash: CONTENT_HASH,
			scores: baseScores(),
			improvements: [],
			ingredientSignals: [],
			macros: sampleMacros,
			labels: sampleLabels,
			updatedAt: 1_700_000_100
		});
		expect(tags).toContainEqual(['updated_at', '1700000100']);
		expect(content.updatedAt).toBe(1_700_000_100);
	});
});

describe('rescore round-trip — macros + labels reach the publisher', () => {
	const publishMock = vi.fn(async () => true);
	const pipelineMock = vi.fn();

	beforeEach(() => {
		publishMock.mockReset();
		publishMock.mockResolvedValue(true);
		pipelineMock.mockReset();
		vi.resetModules();
	});

	it('admin rescore passes macros, confidence, and labels into publishNourishEvent', async () => {
		const macros: NourishMacros = {
			...sampleMacros,
			confidence: 'estimate'
		};
		const labels: NourishLabel[] = ['protein:30plus', 'seedoil:free'];

		pipelineMock.mockResolvedValue({
			ok: true,
			scores: baseScores(),
			improvements: ['use less salt'],
			ingredientSignals: [{ name: 'chicken', signals: ['protein'], contribution: 'protein' }],
			audienceScores: {
				kidFriendly: { score: 7, label: 'Good', reason: 'ok' }
			},
			macros,
			labels
		});

		vi.doMock('$lib/nourish/scoringEngine.server', () => ({
			runScoringPipeline: pipelineMock
		}));
		vi.doMock('$lib/nourish/nourishPublisher.server', () => ({
			publishNourishEvent: publishMock
		}));
		vi.doMock('$lib/nip98.server', () => ({
			verifyNip98: vi.fn(async () => ({ ok: true, pubkey: 'admin' }))
		}));
		vi.doMock('$lib/adminAuth', () => ({
			ADMIN_PUBKEY: 'admin'
		}));
		vi.doMock('$env/dynamic/private', () => ({
			env: {
				OPENAI_API_KEY: 'sk-test',
				NOTIFICATION_PRIVATE_KEY: '1'.repeat(64)
			}
		}));

		const { POST } = await import('../../routes/api/admin/nourish/rescore/+server');

		const body = {
			recipePubkey: RECIPE_PUBKEY,
			recipeDTag: RECIPE_DTAG,
			title: 'Test Chicken',
			ingredients: ['2 chicken breasts', 'salt'],
			tags: ['dinner'],
			servings: '4',
			contentHash: CONTENT_HASH
		};
		const request = new Request('https://zap.cooking/api/admin/nourish/rescore', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Nostr test'
			},
			body: JSON.stringify(body)
		});

		const response = await POST({
			request,
			platform: { env: {} }
		} as any);

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.success).toBe(true);
		expect(json.macros).toEqual(macros);
		expect(json.labels).toEqual(labels);
		expect(json.published).toBe(true);

		expect(publishMock).toHaveBeenCalledTimes(1);
		const publishArgs = publishMock.mock.calls[0][0];
		expect(publishArgs.macros).toEqual(macros);
		expect(publishArgs.labels).toEqual(labels);
		expect(publishArgs.macros.confidence).toBe('estimate');
		expect(publishArgs.updatedAt).toBeTypeOf('number');
		expect(publishArgs.recipeDTag).toBe(RECIPE_DTAG);
	});

	it('rescore of a rough recipe still publishes macros + flag labels (no threshold tags upstream)', async () => {
		const macros: NourishMacros = {
			...sampleMacros,
			confidence: 'rough'
		};
		const labels: NourishLabel[] = ['seedoil:free', 'addedsugar:free'];

		pipelineMock.mockResolvedValue({
			ok: true,
			scores: baseScores(),
			improvements: [],
			ingredientSignals: [],
			macros,
			labels
		});

		vi.doMock('$lib/nourish/scoringEngine.server', () => ({
			runScoringPipeline: pipelineMock
		}));
		vi.doMock('$lib/nourish/nourishPublisher.server', () => ({
			publishNourishEvent: publishMock
		}));
		vi.doMock('$lib/nip98.server', () => ({
			verifyNip98: vi.fn(async () => ({ ok: true, pubkey: 'admin' }))
		}));
		vi.doMock('$lib/adminAuth', () => ({
			ADMIN_PUBKEY: 'admin'
		}));
		vi.doMock('$env/dynamic/private', () => ({
			env: {
				OPENAI_API_KEY: 'sk-test',
				NOTIFICATION_PRIVATE_KEY: '1'.repeat(64)
			}
		}));

		const { POST } = await import('../../routes/api/admin/nourish/rescore/+server');
		const body = {
			recipePubkey: RECIPE_PUBKEY,
			recipeDTag: 'fried-chicken',
			title: 'Fried Chicken',
			ingredients: ['breaded chicken', 'oil for frying'],
			tags: [],
			servings: '4',
			contentHash: CONTENT_HASH
		};
		const request = new Request('https://zap.cooking/api/admin/nourish/rescore', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Nostr test'
			},
			body: JSON.stringify(body)
		});

		const response = await POST({
			request,
			platform: { env: {} }
		} as any);
		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.macros.confidence).toBe('rough');
		expect(json.labels).toEqual(labels);

		const publishArgs = publishMock.mock.calls[0][0];
		expect(publishArgs.macros.confidence).toBe('rough');
		expect(publishArgs.labels).toEqual(labels);
		expect(publishArgs.labels.some((l: string) => l.startsWith('protein:'))).toBe(false);

		const parts = buildNourishEventParts({
			recipePubkey: RECIPE_PUBKEY,
			recipeDTag: 'fried-chicken',
			contentHash: CONTENT_HASH,
			scores: baseScores(),
			improvements: [],
			ingredientSignals: [],
			macros,
			labels
		});
		expect(parts.content.macros).toEqual(macros);
		expect(parts.tags).toContainEqual(['l', 'seedoil:free', NOURISH_LABEL_NAMESPACE]);
		expect(parts.tags.some((t) => t[0] === 'l' && String(t[1]).startsWith('protein:'))).toBe(
			false
		);
	});
});

describe('publishNourishEvent — signs without throwing on omitted macros', () => {
	it('builds a signed event when macros are omitted (degraded path)', async () => {
		const OriginalWS = globalThis.WebSocket;
		class FakeWS {
			onopen: (() => void) | null = null;
			onmessage: ((msg: MessageEvent) => void) | null = null;
			onerror: (() => void) | null = null;
			onclose: (() => void) | null = null;
			constructor(_url: string) {
				queueMicrotask(() => this.onopen?.());
			}
			send() {
				queueMicrotask(() => this.onclose?.());
			}
			close() {}
		}
		// @ts-expect-error test stub
		globalThis.WebSocket = FakeWS;

		const sk = generateSecretKey();
		const hex = Array.from(sk)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		const ok = await publishNourishEvent({
			privateKey: hex,
			recipePubkey: RECIPE_PUBKEY,
			recipeDTag: RECIPE_DTAG,
			contentHash: CONTENT_HASH,
			scores: baseScores(),
			improvements: [],
			ingredientSignals: []
		});
		expect(ok).toBe(false);

		globalThis.WebSocket = OriginalWS;
	});
});
