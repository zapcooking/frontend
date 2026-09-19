import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import {
	addBlockedPubkey,
	loadReadsModerationLists,
	parseVerifiedReadsEvent,
	saveReadsModerationLists,
	type ReadsModerationKV
} from './moderation.server';
import { DEFAULT_READS_MODERATION } from './moderationConfig';

function fakeKv(initial: Record<string, string> = {}): NonNullable<ReadsModerationKV> {
	const store = new Map<string, string>(Object.entries(initial));
	return {
		async get(key: string) {
			return store.get(key) ?? null;
		},
		async put(key: string, value: string) {
			store.set(key, value);
		},
		async delete(key: string) {
			store.delete(key);
		},
		async list(options?: { prefix?: string }) {
			const keys = [...store.keys()]
				.filter((name) => !options?.prefix || name.startsWith(options.prefix))
				.map((name) => ({ name }));
			return { keys, list_complete: true };
		}
	};
}

describe('addBlockedPubkey', () => {
	it('keeps both pubkeys when two auto-blocks race', async () => {
		const kv = fakeKv();
		const a = 'a'.repeat(64);
		const b = 'b'.repeat(64);
		await Promise.all([addBlockedPubkey(kv, a), addBlockedPubkey(kv, b)]);
		const lists = await loadReadsModerationLists(kv);
		expect(lists.blockedPubkeys).toContain(a);
		expect(lists.blockedPubkeys).toContain(b);
	});
});

describe('saveReadsModerationLists', () => {
	it('persists an empty denylist instead of restoring seed terms', async () => {
		const kv = fakeKv();
		await saveReadsModerationLists(kv, {
			blockedPubkeys: [],
			blockedEventIds: [],
			blockedNaddrs: [],
			denylist: []
		});
		const lists = await loadReadsModerationLists(kv);
		expect(lists.denylist).toEqual([]);
		for (const pk of DEFAULT_READS_MODERATION.blockedPubkeys) {
			expect(lists.blockedPubkeys).toContain(pk);
		}
	});
});

describe('parseVerifiedReadsEvent', () => {
	it('accepts a signed kind 30023 event', () => {
		const sk = generateSecretKey();
		const event = finalizeEvent(
			{
				kind: 30023,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['d', 'slug'],
					['title', 'Farmhouse sourdough']
				],
				content: 'Mix flour, water, and salt.'
			},
			sk
		);
		expect(parseVerifiedReadsEvent(event)?.id).toBe(event.id);
	});

	it('rejects a pubkey that does not match the signature', () => {
		const sk = generateSecretKey();
		const event = finalizeEvent(
			{
				kind: 30023,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', 'slug']],
				content: 'naked house tour'
			},
			sk
		);
		expect(
			parseVerifiedReadsEvent({
				...event,
				pubkey: 'c'.repeat(64)
			})
		).toBeNull();
	});

	it('rejects an unsigned payload', () => {
		expect(
			parseVerifiedReadsEvent({
				id: 'a'.repeat(64),
				pubkey: 'b'.repeat(64),
				created_at: 1,
				kind: 30023,
				tags: [],
				content: 'naked',
				sig: 'd'.repeat(128)
			})
		).toBeNull();
	});
});
