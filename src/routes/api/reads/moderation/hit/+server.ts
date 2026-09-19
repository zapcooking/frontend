/**
 * POST /api/reads/moderation/hit — keyword-filter match from a Reads client.
 *
 * The client already hid the article. This endpoint:
 *   1. Confirms the matched term is on the denylist (clients cannot
 *      auto-block arbitrary pubkeys with a fake term).
 *   2. Writes a review-log row.
 *   3. Auto-adds the author pubkey to blockedPubkeys.
 *
 * Rate-limited per IP. Unauthenticated by design — the feed filter runs
 * for signed-out visitors too.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import {
	addBlockedPubkey,
	loadReadsModerationLists,
	recordReadsReview,
	termIsInDenylist
} from '$lib/reads/moderation.server';
import { isHex64 } from '$lib/reads/moderation';

function clientIp(getClientAddress: () => string): string {
	try {
		return getClientAddress();
	} catch {
		return '127.0.0.1';
	}
}

export const POST: RequestHandler = async ({ request, getClientAddress, platform }) => {
	const kv = platform?.env?.GATED_CONTENT ?? platform?.env?.NOURISH_FLAGS;
	const ip = clientIp(getClientAddress);

	const limited = await checkPerIpRateLimit(kv, {
		ip,
		scope: 'reads-mod-hit',
		perHour: 60,
		perDay: 200
	});
	if (limited.limited) {
		return json(limited.body, { status: 429 });
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: 'bad_request' }, { status: 400 });
	}

	const pubkey = typeof body.pubkey === 'string' ? body.pubkey : '';
	const matchedTerm = typeof body.matchedTerm === 'string' ? body.matchedTerm : '';
	if (!isHex64(pubkey) || !matchedTerm) {
		return json({ error: 'bad_request' }, { status: 400 });
	}

	const lists = await loadReadsModerationLists(platform?.env?.GATED_CONTENT ?? null);
	if (!termIsInDenylist(matchedTerm, lists)) {
		return json({ error: 'unknown_term' }, { status: 400 });
	}

	const recorded = await recordReadsReview(
		platform?.env?.GATED_CONTENT ?? null,
		{
			kind: 'keyword',
			eventId: typeof body.eventId === 'string' ? body.eventId : '',
			pubkey,
			naddr: typeof body.naddr === 'string' ? body.naddr : '',
			matchedTerm,
			field: typeof body.field === 'string' ? body.field : ''
		},
		limited.ipHash
	);

	if (!recorded.duplicate) {
		await addBlockedPubkey(platform?.env?.GATED_CONTENT ?? null, pubkey);
	}

	console.info('[reads-moderation] keyword hit', {
		pubkey,
		eventId: body.eventId,
		matchedTerm,
		duplicate: recorded.duplicate === true
	});

	return json({ ok: true, duplicate: recorded.duplicate === true });
};
