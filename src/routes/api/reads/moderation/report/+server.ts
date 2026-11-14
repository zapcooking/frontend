/**
 * POST /api/reads/moderation/report — user-submitted article report.
 *
 * Writes to the same review log as keyword hits. Does not auto-block;
 * keyword lists miss things, and a report is a queue item for review.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import { recordReadsReview } from '$lib/reads/moderation.server';
import { isHex64, isNaddr } from '$lib/reads/moderation';

const REASONS = new Set(['nsfw', 'spam', 'other']);

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
		scope: 'reads-mod-report',
		perHour: 8,
		perDay: 20
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

	const pubkey = typeof body.pubkey === 'string' ? body.pubkey.trim().toLowerCase() : '';
	const eventId = typeof body.eventId === 'string' ? body.eventId.trim().toLowerCase() : '';
	const naddr = typeof body.naddr === 'string' ? body.naddr.trim().toLowerCase() : '';
	const reason = typeof body.reason === 'string' ? body.reason.trim().toLowerCase() : '';
	const details = typeof body.details === 'string' ? body.details.trim() : '';

	if (!isHex64(pubkey) || !REASONS.has(reason)) {
		return json({ error: 'bad_request' }, { status: 400 });
	}
	if (eventId && !isHex64(eventId)) {
		return json({ error: 'bad_request' }, { status: 400 });
	}
	if (naddr && !isNaddr(naddr)) {
		return json({ error: 'bad_request' }, { status: 400 });
	}

	const recorded = await recordReadsReview(
		platform?.env?.GATED_CONTENT ?? null,
		{
			kind: 'report',
			eventId,
			pubkey,
			naddr,
			reason,
			details
		},
		limited.ipHash
	);

	console.info('[reads-moderation] report', {
		pubkey,
		eventId,
		reason,
		duplicate: recorded.duplicate === true
	});

	return json({ ok: true, duplicate: recorded.duplicate === true });
};
