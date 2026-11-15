/**
 * Go live — the anonymous "watching now" heartbeat.
 *
 * POST /api/live/<id>/heartbeat
 *   Auth: none, and none is read. Never tied to an account or a key.
 *   Body: { code } — 32 lowercase hex characters, made at random by the
 *         watch page on each page load and kept only in that page's memory
 *         (never in browser storage).
 *   200:  { watching }   distinct codes heard in the last ~60 s
 *
 * The player sends one about every 30 s while its tab is visible and the
 * stream is playing. The host's own page sends none, and a watch page
 * signed in as the host sends none (the count leaves the host out).
 *
 * The count lives in the session's presence Durable Object, in memory
 * only (workers/live-presence). Nothing about a heartbeat is stored or
 * logged: not the code, not the address. The address is passed to the
 * object for the rate limit only, where it is salted, hashed and kept for
 * one minute with two counters, never linked to a code.
 *
 * At the edge, the zone's one rate-limiting rule (the join rule, extended)
 * also covers this path and ../watching.
 *
 * Heartbeats do not touch the guest cap, the pass ceiling or the joins
 * count. When the count passes the session's stored peak, the peak is
 * raised (one conditional update): that and `joins` are the only numbers
 * kept after the stream.
 *
 * Replies:
 *   200                  counted (or already counted)
 *   400 bad_request      the body is not { code } with a valid code
 *   404 not_found        unknown or malformed id
 *   409 not_live         the session is not broadcasting right now
 *   410 ended            the session has ended
 *   413 too_large        body over 256 bytes
 *   429 rate_limited     too many heartbeats or new codes from this address
 *   503 unavailable      the presence object could not be reached
 *   500 not_configured   the database is not bound
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { readBodyCapped } from '$lib/live/body.server';
import { isHeartbeatCode } from '$lib/live/presenceCounter';
import { sendBeat } from '$lib/live/presence.server';
import { getSessionStatus, raisePeakWatching, type LiveDb } from '$lib/live/sessions.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 256;

const bad = () => json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });

function clientIp(request: Request, getClientAddress: () => string): string {
  const header = request.headers.get('CF-Connecting-IP');
  if (header) return header;
  try {
    return getClientAddress();
  } catch {
    return 'unknown';
  }
}

export const POST: RequestHandler = async ({ request, params, platform, getClientAddress }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });

    const id = params.id ?? '';
    const bytes = await readBodyCapped(request, MAX_BODY_BYTES);
    if (bytes === 'too_large') {
      return json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
    }
    if (bytes === 'unreadable') return bad();
    let code: unknown;
    try {
      code = (JSON.parse(new TextDecoder().decode(bytes)) as { code?: unknown } | null)?.code;
    } catch {
      return bad();
    }
    if (!isHeartbeatCode(code)) return bad();

    // A real, live session only: no presence object is made for anything else.
    const session = await getSessionStatus(db, id);
    if (!session) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
    if (session.status === 'ended') {
      return json({ error: 'ended' }, { status: 410, headers: NO_STORE });
    }
    if (session.status !== 'live') {
      return json({ error: 'not_live' }, { status: 409, headers: NO_STORE });
    }

    const beat = await sendBeat(platform, id, code, clientIp(request, getClientAddress));
    if (!beat.ok) {
      if (beat.reason === 'rate_limited') {
        return json(
          { error: 'rate_limited' },
          { status: 429, headers: { ...NO_STORE, 'Retry-After': '60' } }
        );
      }
      return json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
    }
    if (beat.newPeak) await raisePeakWatching(db, id, beat.peak);
    return json({ watching: beat.watching }, { headers: NO_STORE });
  } catch (err) {
    // Name only: nothing about the request is logged.
    console.error(`[Live] heartbeat failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
};
