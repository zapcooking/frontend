/**
 * GET /api/reads/moderation — public merged blocklist + denylist.
 *
 * Seed lists always apply. KV overlay (when bound) unions pubkeys/ids/naddrs
 * and can replace the denylist after an admin save. Cached briefly so Reads
 * clients pick up auto-blocks without hammering KV.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { loadReadsModerationLists } from '$lib/reads/moderation.server';

export const GET: RequestHandler = async ({ platform }) => {
	const kv = platform?.env?.GATED_CONTENT ?? null;
	const lists = await loadReadsModerationLists(kv);
	return json(lists, {
		headers: {
			'cache-control': 'public, max-age=30, stale-while-revalidate=60'
		}
	});
};
