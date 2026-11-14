/**
 * Tests for the OG relay race in `recipePackOg.server.ts`.
 *
 * The card resolver races a fixed relay list over raw WebSocket; when that
 * list was just primal + nos.lol, recipes that only lived on other standard
 * relays (nostr.wine) silently got the generic fallback card while the
 * browser — which queries the full standard pool — rendered them fine.
 * These tests pin the behaviors that fix depended on: the full pool is
 * asked, a later relay's event wins, total misses log per-relay outcomes,
 * and repeat lookups are served from the last-good cache.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { raceRelays } from './recipePackOg.server';

type ScriptedRelay = (ws: FakeWebSocket) => void;

/** Script per relay URL, run when the module sends its REQ on that socket. */
let relayScripts: Record<string, ScriptedRelay> = {};

class FakeWebSocket {
	static OPEN = 1;
	static CONNECTING = 0;
	static instances: FakeWebSocket[] = [];

	readyState = FakeWebSocket.CONNECTING;
	sentMessages: string[] = [];
	closedByClient = false;
	onopen: (() => void) | null = null;
	onmessage: ((ev: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: (() => void) | null = null;

	constructor(readonly url: string) {
		FakeWebSocket.instances.push(this);
		// Mimic the runtime: the connection succeeds on the next microtask,
		// after the caller has finished assigning handlers.
		queueMicrotask(() => this.onopen?.());
	}

	send(data: string) {
		this.sentMessages.push(data);
		relayScripts[this.url]?.(this);
	}

	close() {
		this.closedByClient = true;
		this.readyState = 3;
	}
}

function scriptReply(ws: FakeWebSocket, message: unknown[]) {
	queueMicrotask(() => ws.onmessage?.({ data: JSON.stringify(message) }));
}

function subIdOf(ws: FakeWebSocket): string {
	return JSON.parse(ws.sentMessages[0])[1];
}

const eose: ScriptedRelay = (ws) => scriptReply(ws, ['EOSE', subIdOf(ws)]);

function eventRelay(event: unknown): ScriptedRelay {
	return (ws) => scriptReply(ws, ['EVENT', subIdOf(ws), event]);
}

const silent: ScriptedRelay = () => {
	/* socket never opens — only the 3.5s timeout can settle it */
};

function recipeEvent(pubkey: string, dTag: string, image: string) {
	return {
		kind: 30023,
		pubkey,
		created_at: 1700000000,
		content: 'Cranberry sauce',
		tags: [
			['title', 'Daniel’s Killer Cranberry Sauce'],
			['d', dTag],
			['image', image]
		]
	};
}

const STANDARD_RELAYS = ['wss://nos.lol', 'wss://purplepag.es', 'wss://relay.primal.net', 'wss://nostr.wine'];

beforeEach(() => {
	vi.stubGlobal('WebSocket', FakeWebSocket);
	FakeWebSocket.instances = [];
	relayScripts = {};
	// Fake the clock only — fake timers would also stub queueMicrotask,
	// which the scripted relay replies rely on to run.
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('raceRelays', () => {
	const pubkey = 'b'.repeat(64);
	const dTag = 'cranberry-sauce';

	it('asks the full standard relay pool, not just primal and nos.lol', async () => {
		relayScripts = Object.fromEntries(STANDARD_RELAYS.map((url) => [url, eose]));
		await raceRelays({ kinds: [30023], authors: [pubkey], '#d': [dTag] });

		const requestedUrls = FakeWebSocket.instances
			.filter((ws) => ws.sentMessages.length > 0)
			.map((ws) => ws.url);
		expect(requestedUrls).toContain('wss://nostr.wine');
		expect(requestedUrls).toContain('wss://relay.primal.net');
		expect(requestedUrls).toContain('wss://nos.lol');
	});

	it('finds the recipe when the former primal+nos.lol pair misses but nostr.wine holds it', async () => {
		relayScripts = {
			'wss://relay.primal.net': eose,
			'wss://purplepag.es': eose,
			'wss://nos.lol': silent, // hung — must not block or win
			'wss://nostr.wine': eventRelay(recipeEvent(pubkey, dTag, 'https://i.nostr.build/KY5X.jpg'))
		};

		const evt = await raceRelays({ kinds: [30023], authors: [pubkey], '#d': [dTag] });

		expect(evt?.tags).toContainEqual(['image', 'https://i.nostr.build/KY5X.jpg']);
		// The hung socket is aborted once a winner resolves, rather than
		// holding its 3.5s timeout open.
		const hung = FakeWebSocket.instances.find((ws) => ws.url === 'wss://nos.lol');
		expect(hung?.closedByClient).toBe(true);
	});

	it('returns null and logs per-relay outcomes when no relay has the event', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		relayScripts = Object.fromEntries([
			...STANDARD_RELAYS.filter((u) => u !== 'wss://nos.lol').map((url) => [url, eose]),
			['wss://nos.lol', silent]
		]);

		const filter = { kinds: [30023], authors: ['c'.repeat(64)], '#d': ['gone'] };
		const pending = raceRelays(filter);
		await vi.advanceTimersByTimeAsync(3500);
		const evt = await pending;

		expect(evt).toBeNull();
		const logged = warn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
		expect(logged).toContain('[og] relay miss');
		expect(logged).toContain('wss://nos.lol=timeout');
		expect(logged).toContain('wss://nostr.wine=eose');
	});

	it('serves repeat lookups from the last-good cache without re-querying relays', async () => {
		relayScripts = Object.fromEntries(STANDARD_RELAYS.map((url) => [url, eose]));
		relayScripts['wss://nostr.wine'] = eventRelay(recipeEvent(pubkey, dTag, 'https://i.nostr.build/KY5X.jpg'));

		const filter = { kinds: [30023], authors: [pubkey], '#d': [dTag] };
		const first = await raceRelays(filter);
		const socketsAfterFirst = FakeWebSocket.instances.length;

		// Simulate every relay going down; the warm lookup must still resolve.
		relayScripts = Object.fromEntries(STANDARD_RELAYS.map((url) => [url, silent]));
		const second = await raceRelays(filter);

		expect(second).toEqual(first);
		expect(FakeWebSocket.instances.length).toBe(socketsAfterFirst);
	});

	it('does not cache misses, so a later lookup can succeed', async () => {
		relayScripts = Object.fromEntries(STANDARD_RELAYS.map((url) => [url, eose]));
		const filter = { kinds: [30023], authors: ['d'.repeat(64)], '#d': ['not-yet'] };

		const pendingMiss = raceRelays(filter);
		await vi.advanceTimersByTimeAsync(10);
		expect(await pendingMiss).toBeNull();

		relayScripts['wss://nostr.wine'] = eventRelay(recipeEvent('d'.repeat(64), 'not-yet', 'https://i.nostr.build/late.jpg'));
		const evt = await raceRelays(filter);
		expect(evt?.tags).toContainEqual(['image', 'https://i.nostr.build/late.jpg']);
	});
});
