import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('$lib/nostr', () => ({ ndk: { subscribe: () => () => {} } }));
vi.mock('$lib/encryptionService', () => ({
	decrypt: vi.fn(),
	encrypt: vi.fn(),
	detectEncryptionMethod: vi.fn()
}));
vi.mock('$lib/muteListStore', () => ({ muteListStore: { invalidate: vi.fn(), load: vi.fn() } }));

const { fetchMuteListStrict, planPubkeyMute } = await import('./muteToggle');

const ME = 'e'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

/** Minimal NDK stand-in: subscribe() returns an emitter the test drives. */
function fakeNdk() {
	const sub = Object.assign(new EventEmitter(), { stop: vi.fn() });
	const subscribe = vi.fn(() => sub);
	return { ndk: { subscribe } as any, sub, subscribe };
}

const relaySet = {} as any;
const muteEvent = (created_at: number, tags: string[][], content = '') =>
	({ kind: 10000, pubkey: ME, created_at, tags, content }) as any;

const crypto = { decrypt: vi.fn(), encrypt: vi.fn() };

afterEach(() => vi.useRealTimers());

describe('fetchMuteListStrict', () => {
	it('returns the newest event once a relay sends EOSE', async () => {
		const { ndk, sub, subscribe } = fakeNdk();
		const pending = fetchMuteListStrict(ndk, ME, { relaySet });
		sub.emit('event', muteEvent(100, [['p', A]]));
		sub.emit('event', muteEvent(200, [['p', B]]));
		sub.emit('event', muteEvent(150, [['p', A]]));
		sub.emit('eose');
		const result = await pending;
		expect(result).toMatchObject({ status: 'found', event: { created_at: 200 } });
		// Relay-only (no cache short-circuit) against the explicit relay set.
		expect(subscribe.mock.calls[0][1]).toMatchObject({ cacheUsage: 'ONLY_RELAY' });
		expect(subscribe.mock.calls[0][2]).toBe(relaySet);
		expect(sub.stop).toHaveBeenCalled();
	});

	it('reports a confirmed absence when a relay sends EOSE with nothing', async () => {
		const { ndk, sub } = fakeNdk();
		const pending = fetchMuteListStrict(ndk, ME, { relaySet });
		sub.emit('eose');
		expect(await pending).toEqual({ status: 'absent' });
	});

	it('reports unavailable when no relay answers before the timeout', async () => {
		vi.useFakeTimers();
		const { ndk } = fakeNdk();
		const pending = fetchMuteListStrict(ndk, ME, { relaySet, timeoutMs: 1000 });
		vi.advanceTimersByTime(1000);
		expect(await pending).toEqual({ status: 'unavailable' });
	});

	it('keeps an event that arrived before the timeout', async () => {
		vi.useFakeTimers();
		const { ndk, sub } = fakeNdk();
		const pending = fetchMuteListStrict(ndk, ME, { relaySet, timeoutMs: 1000 });
		sub.emit('event', muteEvent(100, [['p', A]]));
		vi.advanceTimersByTime(1000);
		expect(await pending).toMatchObject({ status: 'found', event: { created_at: 100 } });
	});

	it('ignores events from another author', async () => {
		const { ndk, sub } = fakeNdk();
		const pending = fetchMuteListStrict(ndk, ME, { relaySet });
		sub.emit('event', { ...muteEvent(100, [['p', A]]), pubkey: A });
		sub.emit('eose');
		expect(await pending).toEqual({ status: 'absent' });
	});
});

describe('planPubkeyMute', () => {
	it('refuses to publish when the relay copy is unavailable', async () => {
		await expect(planPubkeyMute({ status: 'unavailable' }, B, true, crypto)).rejects.toThrow(
			/not reachable/
		);
	});

	it('starts a new list only when the relay copy is confirmed absent', async () => {
		expect(await planPubkeyMute({ status: 'absent' }, B, true, crypto)).toEqual({
			tags: [['p', B]],
			content: ''
		});
	});

	it('edits a found list, keeping every other entry', async () => {
		const tags = [['p', A, 'spam'], ['word', 'x'], ['t', 'nsfw'], ['e', '1'.repeat(64)]];
		const found = { status: 'found' as const, event: muteEvent(1, tags, 'ciphertext') };
		expect(await planPubkeyMute(found, B, true, crypto)).toEqual({
			tags: [...tags, ['p', B]],
			content: 'ciphertext'
		});
	});
});
