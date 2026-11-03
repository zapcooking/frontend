import { describe, it, expect, vi } from 'vitest';

const SPAMMER = '9'.repeat(64);
const HIDDEN = 'd'.repeat(64);

vi.mock('$lib/reads/orgLists.server', () => ({
	getOrgModeration: vi.fn(async () => ({ blockedPubkeys: [SPAMMER], hiddenEventIds: [HIDDEN], hiddenCoordinates: [] }))
}));

import { GET } from './+server';
import { DEFAULT_READS_MODERATION } from '$lib/reads/moderationConfig';

describe('GET /api/reads/moderation', () => {
	it('unions the org feed-block and feed-hidden entries into the seed lists', async () => {
		const res = await GET({ platform: undefined } as unknown as Parameters<typeof GET>[0]);
		const body = await res.json();
		for (const pk of [...DEFAULT_READS_MODERATION.blockedPubkeys, SPAMMER]) expect(body.blockedPubkeys).toContain(pk);
		for (const id of [...DEFAULT_READS_MODERATION.blockedEventIds, HIDDEN]) expect(body.blockedEventIds).toContain(id);
		expect(body.denylist).toEqual(DEFAULT_READS_MODERATION.denylist);
	});
});
