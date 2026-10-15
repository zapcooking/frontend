import { describe, it, expect, vi } from 'vitest';
import { ORG_PUBKEY } from '$lib/landing/curation';

const { unionKeyed } = vi.hoisted(() => ({ unionKeyed: vi.fn() }));
vi.mock('$lib/relayCollect', () => ({ unionKeyed }));
vi.mock('nostr-tools/pure', () => ({ verifyEvent: () => true }));
vi.mock('$lib/landing/landingData.server', () => ({ LIST_RELAYS: ['wss://a', 'wss://b'] }));

import { fetchOrgListsFromRelays } from './orgLists.server';

const list = (d: string, created_at: number) => ({
	id: `${d}-${created_at}`,
	pubkey: ORG_PUBKEY,
	kind: 30000,
	created_at,
	content: '',
	sig: '',
	tags: [['d', d]]
});

describe('fetchOrgListsFromRelays', () => {
	it('picks the newest list across every relay, not the first relay to answer', async () => {
		// The union keeps relay order: a fast relay's stale copy comes first.
		unionKeyed.mockResolvedValueOnce({
			events: { block: [list('feed-block', 100), list('feed-block', 200)], hidden: [] },
			anyDone: { block: true, hidden: true }
		});
		const lists = await fetchOrgListsFromRelays();
		expect(lists.block?.created_at).toBe(200);
		expect(lists.hidden).toBeUndefined();
	});
});
