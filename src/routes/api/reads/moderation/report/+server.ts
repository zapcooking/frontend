/**
 * POST /api/reads/moderation/report — user-submitted report (articles,
 * plated posts, Go live streams and their comments).
 *
 * Writes to the same review log as keyword hits. Does not auto-block;
 * keyword lists miss things, and a report is a queue item for review.
 *
 * Go live: a report that names `liveSession` (a session id) also
 *  - puts that session on a report hold, so its record is kept past the
 *    30-day retention until the admin releases it, and
 *  - DMs the admin at once (throttled to one per session per 10 minutes,
 *    except a child-safety report, which always alerts).
 * An unknown session id does neither.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import { getSession, isLiveSessionId, setReportHold, type LiveDb } from '$lib/live/sessions.server';
import { readLiveEnv } from '$lib/live/env.server';
import { sendReportAlert } from '$lib/live/reportAlert.server';
import { publishEventRaw } from '$lib/rawPublish';
import { recordReadsReview } from '$lib/reads/moderation.server';
import { isHex64, isNaddr } from '$lib/reads/moderation';

const REASONS = new Set(['nsfw', 'spam', 'other', 'child_safety']);

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
	const liveSession =
		typeof body.liveSession === 'string' ? body.liveSession.trim().toLowerCase() : '';

	if (!isHex64(pubkey) || !REASONS.has(reason)) {
		return json({ error: 'bad_request' }, { status: 400 });
	}
	if (eventId && !isHex64(eventId)) {
		return json({ error: 'bad_request' }, { status: 400 });
	}
	if (naddr && !isNaddr(naddr)) {
		return json({ error: 'bad_request' }, { status: 400 });
	}
	if (liveSession && !isLiveSessionId(liveSession)) {
		return json({ error: 'bad_request' }, { status: 400 });
	}

	const recorded = await recordReadsReview(
		platform?.env?.GATED_CONTENT ?? null,
		{
			kind: 'report',
			eventId,
			pubkey,
			naddr,
			liveSession,
			reason,
			details
		},
		limited.ipHash
	);

	console.info('[reads-moderation] report', {
		pubkey,
		eventId,
		reason,
		live: liveSession !== '',
		duplicate: recorded.duplicate === true
	});

	if (liveSession) {
		await handleLiveReport(platform, new URL(request.url).origin, liveSession, reason, !!eventId);
	}

	return json({ ok: true, duplicate: recorded.duplicate === true });
};

/**
 * Hold the session and alert the admin. The hold is written before the
 * reply; the DM is sent in the background (waitUntil) where the runtime
 * offers it. Failures are logged, never returned: the report itself is
 * already recorded.
 */
async function handleLiveReport(
	platform: Readonly<App.Platform> | undefined,
	origin: string,
	sessionId: string,
	reason: string,
	comment: boolean
): Promise<void> {
	const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
	if (!db) return;
	try {
		if (!(await setReportHold(db, sessionId))) return; // unknown session: nothing to do
		const session = await getSession(db, sessionId);
		if (!session) return;
		const alert = sendReportAlert(
			{ sessionId, title: session.title, reason, comment, origin },
			{
				kv: platform?.env?.GATED_CONTENT,
				senderKey: readLiveEnv(platform, 'NOTIFICATION_PRIVATE_KEY'),
				recipientPubkey: ADMIN_PUBKEY,
				publish: publishEventRaw
			}
		);
		if (platform?.ctx) platform.ctx.waitUntil(alert);
		else await alert;
	} catch (err) {
		console.error(`[reads-moderation] live report handling failed: ${(err as Error)?.name ?? 'error'}`);
	}
}
