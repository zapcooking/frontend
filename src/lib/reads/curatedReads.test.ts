import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { READS_RELAY, fetchCuratedReads } from './curatedReads';
import { loadReadsSource, saveReadsSource, READS_SOURCE_KEY } from './readsSource';
import { FakeWebSocket, ev, pk, relay, relays } from '$lib/landing/fakeRelay.testutil';

const IMG = 'https://image.nostr.build/a.jpg';
const article = (d: string, author: string, published: number, extra: string[][] = []) =>
	ev({ kind: 30023, pubkey: author, created_at: published, tags: [['d', d], ['title', d], ['image', IMG], ['published_at', String(published)], ...extra] });

const sent: unknown[][] = [];
class RecordingWS extends FakeWebSocket {
	send(raw: string) {
		sent.push(JSON.parse(raw));
		super.send(raw);
	}
}

beforeEach(() => {
	relays.clear();
	sent.length = 0;
	(globalThis as { WebSocket?: unknown }).WebSocket = RecordingWS;
});
afterEach(() => {
	delete (globalThis as { WebSocket?: unknown }).WebSocket;
});

describe('fetchCuratedReads', () => {
	it('returns only feed-relay articles: no recipes, newest version per coordinate, newest first', async () => {
		relay(READS_RELAY, [
			article('older', pk('a'), 1_700_000_000),
			article('newer', pk('b'), 1_710_000_000),
			article('newer', pk('b'), 1_705_000_000), // an older version of the same coordinate
			article('a-recipe', pk('c'), 1_720_000_000, [['t', 'zapcooking']]),
			ev({ kind: 35000, pubkey: pk('c'), tags: [['d', 'r']] }),
			// published_at in ms (the only published_at tag): read as seconds, not as the far future.
			ev({ kind: 30023, pubkey: pk('d'), created_at: 1_690_000_000, tags: [['d', 'ms'], ['title', 'ms'], ['image', IMG], ['published_at', '1690000000000']] })
		]);
		const r = await fetchCuratedReads(500);
		expect(r.complete).toBe(true);
		expect(r.events.map((e) => e.tags.find((t) => t[0] === 'd')![1])).toEqual(['newer', 'older', 'ms']);
		expect(r.events.find((e) => e.tags[0][1] === 'newer')!.created_at).toBe(1_710_000_000);
	});

	it('asks the feed relay only, for kind 30023, and never answers AUTH (no signer prompt)', async () => {
		expect(READS_RELAY).toBe('wss://feed.zap.cooking');
		const other = relay('wss://relay.primal.net', [article('spam', pk('e'), 1_720_000_000)]);
		const feed = relay('wss://feed.zap.cooking', [article('ok', pk('a'), 1_700_000_000)]);
		await fetchCuratedReads(500);
		expect(other.reqs).toEqual([]);
		expect(feed.reqs).toEqual([{ kinds: [30023], limit: 300 }]);
		expect(sent.every((m) => m[0] === 'REQ' || m[0] === 'CLOSE')).toBe(true);
	});

	it('an unreachable relay gives an empty, incomplete result (no fallback anywhere)', async () => {
		relay(READS_RELAY, [], 'down');
		const r = await fetchCuratedReads(200);
		expect(r).toEqual({ events: [], complete: false });
	});
});

describe('reads source preference', () => {
	const mem = () => {
		const m = new Map<string, string>();
		return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
	};

	it('defaults to curated; remembers "all"; anything else or broken storage means curated', () => {
		const s = mem();
		expect(loadReadsSource(s)).toBe('curated');
		saveReadsSource(s, 'all');
		expect(s.m.get(READS_SOURCE_KEY)).toBe('all');
		expect(loadReadsSource(s)).toBe('all');
		s.m.set(READS_SOURCE_KEY, 'everything');
		expect(loadReadsSource(s)).toBe('curated');
		const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
		expect(loadReadsSource(broken)).toBe('curated');
		expect(() => saveReadsSource(broken, 'all')).not.toThrow();
		expect(loadReadsSource(null)).toBe('curated');
	});
});
