import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_EVENTS_PER_SUB, collect, raceKeyed, unionKeyed } from './relayCollect';
import { FakeWebSocket, ev, pk, relay, relays } from './landing/fakeRelay.testutil';

const A = 'wss://a.test';
const B = 'wss://b.test';
const C = 'wss://c.test';

beforeEach(() => {
	relays.clear();
	(globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
});
afterEach(() => {
	delete (globalThis as { WebSocket?: unknown }).WebSocket;
});

describe('collect', () => {
	it('runs several subscriptions on one socket until every EOSE', async () => {
		relay(A, [ev({ kind: 1, pubkey: pk('a') }), ev({ kind: 0, pubkey: pk('a') })]);
		const r = await collect(A, { notes: { kinds: [1] }, profiles: { kinds: [0] } }, { timeoutMs: 500 });
		expect(r.events.notes).toHaveLength(1);
		expect(r.events.profiles).toHaveLength(1);
		expect(r.done).toEqual({ notes: true, profiles: true });
	});

	it('resolves with what arrived when the relay never answers (timeout)', async () => {
		relay(A, [ev({ kind: 1, pubkey: pk('a') })], 'hang');
		const t0 = Date.now();
		const r = await collect(A, { notes: { kinds: [1] } }, { timeoutMs: 50 });
		expect(Date.now() - t0).toBeLessThan(400);
		expect(r.done.notes).toBe(false);
		expect(r.events.notes).toEqual([]);
	});

	it('drops malformed events: tags must be arrays of strings', async () => {
		const good = ev({ kind: 1, pubkey: pk('a'), tags: [['t', 'food']] });
		const nullTag = { ...ev({ kind: 1, pubkey: pk('b') }), tags: [null] } as unknown as ReturnType<typeof ev>;
		const numTag = { ...ev({ kind: 1, pubkey: pk('c') }), tags: [['t', 5]] } as unknown as ReturnType<typeof ev>;
		const notArray = { ...ev({ kind: 1, pubkey: pk('d') }), tags: ['t'] } as unknown as ReturnType<typeof ev>;
		relay(A, [good, nullTag, numTag, notArray]);
		const r = await collect(A, { x: { kinds: [1] } }, { timeoutMs: 500 });
		expect(r.events.x.map((e) => e.id)).toEqual([good.id]);
	});

	it('never keeps more than the filter limit, or the global cap, even from a relay that ignores limit', async () => {
		const many = Array.from({ length: MAX_EVENTS_PER_SUB + 50 }, (_, i) => ev({ kind: 1, pubkey: pk('a'), created_at: 1_800_000_000 - i }));
		const r1 = relay(A, many);
		r1.ignoreLimit = true;
		const capped = await collect(A, { x: { kinds: [1], limit: 5 } }, { timeoutMs: 1000 });
		expect(capped.events.x).toHaveLength(5);
		const unbounded = await collect(A, { x: { kinds: [1] } }, { timeoutMs: 1000 });
		expect(unbounded.events.x).toHaveLength(MAX_EVENTS_PER_SUB);
	});

	it('records CLOSED reasons and treats them as done', async () => {
		relay(A, [], 'closed');
		const r = await collect(A, { x: { kinds: [1] } }, { timeoutMs: 500 });
		expect(r.done.x).toBe(true);
		expect(r.closed.x).toMatch(/^auth-required/);
	});

	it('resolves (empty) when the socket errors', async () => {
		relay(A, [], 'down');
		const r = await collect(A, { x: { kinds: [1] } }, { timeoutMs: 500 });
		expect(r.done.x).toBe(false);
	});
});

describe('raceKeyed', () => {
	it('takes the first valid answer per key and skips relays whose answer is rejected', async () => {
		const good = ev({ kind: 30000, pubkey: pk('o'), sig: 'valid' });
		const bad = ev({ kind: 30000, pubkey: pk('o'), sig: 'forged' });
		relay(A, [bad]); // answers first, but its event is rejected
		const b = relay(B, [good]);
		b.delayMs = 20;
		const won = await raceKeyed(
			[A, B],
			{ list: { kinds: [30000] } },
			(_k, evs) => evs.find((e) => e.sig === 'valid') ?? null,
			{ timeoutMs: 500 }
		);
		expect(won.list?.id).toBe(good.id);
	});

	it('leaves keys nobody could answer out of the result, within the timeout', async () => {
		relay(A, [], 'hang');
		relay(B, [], 'down');
		const t0 = Date.now();
		const won = await raceKeyed([A, B], { list: { kinds: [1] } }, (_k, evs) => evs[0] ?? null, { timeoutMs: 60 });
		expect(won).toEqual({});
		expect(Date.now() - t0).toBeLessThan(400);
	});
});

describe('unionKeyed', () => {
	it('merges every relay that answers, de-duplicated by id', async () => {
		const shared = ev({ kind: 0, pubkey: pk('a') });
		relay(A, [shared, ev({ kind: 0, pubkey: pk('b') })]);
		relay(B, [shared, ev({ kind: 0, pubkey: pk('c') })]);
		relay(C, [], 'down');
		const r = await unionKeyed([A, B, C], { p: { kinds: [0] } }, { timeoutMs: 500 });
		expect(r.events.p.map((e) => e.pubkey).sort()).toEqual([pk('a'), pk('b'), pk('c')]);
		expect(r.anyDone.p).toBe(true);
	});
});
