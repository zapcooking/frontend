/**
 * POST /api/reads/moderation/hit — keyword-filter match from a Reads client.
 *
 * The client already hid the article. This endpoint:
 *   1. Verifies a signed kind 30023/35000 event (clients cannot auto-block
 *      an unrelated author by posting a denylist term + someone else's pubkey).
 *   2. Re-evaluates the event against the current denylist.
 *   3. Writes a review-log row and auto-adds that event's author pubkey.
 *
 * Rate-limited per IP. Unauthenticated by design — the feed filter runs
 * for signed-out visitors too — but the mutation is gated on a valid sig
 * and a real keyword match.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import {
	addBlockedPubkey,
	loadReadsModerationLists,
	parseVerifiedReadsEvent,
	recordReadsReview
} from '$lib/reads/moderation.server';
import { evaluateReadsContent, naddrFromEvent } from '$lib/reads/moderation';

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

	const event = parseVerifiedReadsEvent(body.event);
	if (!event) {
		return json({ error: 'bad_event' }, { status: 400 });
	}

	const lists = await loadReadsModerationLists(platform?.env?.GATED_CONTENT ?? null);
	const result = evaluateReadsContent(event, lists);
	if (!result.blocked || result.reason !== 'keyword' || !result.matchedTerm) {
		return json({ error: 'not_a_match' }, { status: 400 });
	}

	const pubkey = event.pubkey.toLowerCase();
	const recorded = await recordReadsReview(
		platform?.env?.GATED_CONTENT ?? null,
		{
			kind: 'keyword',
			eventId: event.id,
			pubkey,
			naddr: naddrFromEvent(event) ?? '',
			matchedTerm: result.matchedTerm,
			field: result.field
		},
		limited.ipHash
	);

	if (!recorded.duplicate) {
		await addBlockedPubkey(platform?.env?.GATED_CONTENT ?? null, pubkey);
	}

	console.info('[reads-moderation] keyword hit', {
		pubkey,
		eventId: event.id,
		matchedTerm: result.matchedTerm,
		duplicate: recorded.duplicate === true
	});

	return json({ ok: true, duplicate: recorded.duplicate === true });
};
