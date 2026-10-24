/**
 * GET /api/reads/moderation — public merged blocklist + denylist.
 *
 * Seed lists always apply. KV overlay (when bound) unions pubkeys/ids/naddrs
 * and can replace the denylist after an admin save. The org's feed-relay
 * lists (feed-block authors, feed-hidden items) are unioned in as well, so
 * the open "All reads" search hides what the curated relay hides. Cached
 * briefly so Reads clients pick up auto-blocks without hammering KV.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { loadReadsModerationLists } from '$lib/reads/moderation.server';
import { mergeReadsLists } from '$lib/reads/moderation';
import { getOrgModeration } from '$lib/reads/orgLists.server';
import { orgModerationAsReadsLists } from '$lib/reads/orgLists';

export const GET: RequestHandler = async ({ platform }) => {
	const kv = platform?.env?.GATED_CONTENT ?? null;
	const cache =
		typeof caches !== 'undefined' ? ((caches as unknown as { default?: Cache }).default ?? null) : null;
	const ctx = platform?.ctx;
	const waitUntil = ctx ? (p: Promise<unknown>) => ctx.waitUntil(p) : undefined;

	const [lists, org] = await Promise.all([loadReadsModerationLists(kv), getOrgModeration({ cache, waitUntil })]);
	return json(mergeReadsLists(lists, orgModerationAsReadsLists(org)), {
		headers: {
			'cache-control': 'public, max-age=30, stale-while-revalidate=60'
		}
	});
};
