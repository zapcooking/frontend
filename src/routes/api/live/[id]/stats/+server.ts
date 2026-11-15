/**
 * Go live — the host's after-the-stream counts.
 *
 * GET /api/live/<id>/stats
 *   Auth: Authorization: Nostr <NIP-98>, signed by the session's host.
 *   200: { peak_watching, joins }
 *   401: no or bad signature
 *   403: a valid signature from someone who is not the host
 *   404: unknown or malformed id
 *
 * For the host's ended screen when the stream was ended somewhere else
 * (the time limit, an admin, or End on another device). When the host
 * taps End on the host page, the End reply carries the same two numbers
 * and this route is not needed.
 *
 * peak_watching: the highest "watching now" count the stream reached.
 * joins: viewers admitted by the play relay, members and guests together,
 * not counting rejoins on a pass. Neither identifies anyone; they are not
 * public because they were asked for as the host's own numbers.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { verifyNip98 } from '$lib/nip98.server';
import { authFailedResponse } from '$lib/scheduleApi.server';
import { getSessionStats, getSessionStatus, type LiveDb } from '$lib/live/sessions.server';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const GET: RequestHandler = async ({ request, params, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    const id = params.id ?? '';
    const session = await getSessionStatus(db, id);
    if (!session) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });

    const auth = await verifyNip98(request, {});
    if (!auth.ok) return authFailedResponse(auth.reason);
    if (auth.pubkey.toLowerCase() !== session.host_pubkey) {
      return json({ error: 'not_host' }, { status: 403, headers: NO_STORE });
    }
    const stats = await getSessionStats(db, id);
    if (!stats) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
    return json({ peak_watching: stats.peak_watching, joins: stats.joins }, { headers: NO_STORE });
  } catch (err) {
    console.error(`[Live] stats failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
