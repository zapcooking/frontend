/**
 * Go live — publish relay.
 *
 * POST /api/live/<id>/publish
 *   Auth: Authorization: Bearer <host_token>   (the host token only)
 *   Body: the browser's SDP offer, Content-Type: application/sdp
 *   201:  the SDP answer, Content-Type: application/sdp
 *
 * The host's browser never holds a Cloudflare URL. This route creates a
 * fresh live input, relays the offer to it once, and returns the status
 * and the SDP answer ONLY. Cloudflare's Location, ETag and Link headers
 * are never forwarded, and neither they, the publish URL, the input id
 * nor any SDP is ever logged.
 *
 * Calling it again on the same session is how a host reconnects: the
 * previous input is deleted (ending the previous broadcast) and a new one
 * takes its place.
 *
 * Replies:
 *   201                          live; body is the SDP answer
 *   400 bad_offer                empty body, or not SDP
 *   401 auth_failed              missing, wrong or expired host token
 *   403 not_allowed              the host is no longer on the host list
 *   404 not_found                unknown or malformed id
 *   409 ended                    the session has ended
 *   409 publish_in_progress *    another publish holds the lock
 *   413 too_large                offer over the size cap
 *   415 unsupported_media_type   Content-Type is not application/sdp
 *   422 offer_rejected           Cloudflare refused this offer
 *   429 publish_limit            the session used all its publish attempts
 *   503 stream_unavailable *     Cloudflare failed or is not configured
 *   500 not_configured           the database is not bound
 * Replies marked * mean "try again": they carry `retry: true` and a
 * Retry-After header. A Cloudflare failure is never a 500, and the
 * session is marked live only after Cloudflare has answered the offer.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { isLiveHost, LIVE_OFFER_MAX_BYTES, LIVE_RETRY_AFTER_SECONDS } from '$lib/live/config';
import { readBodyCapped } from '$lib/live/body.server';
import { publishSession } from '$lib/live/relay.server';
import {
  getSession,
  hostTokenMatches,
  readHostToken,
  type LiveDb
} from '$lib/live/sessions.server';
import { readStreamConfig } from '$lib/live/stream.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const RETRY = { ...NO_STORE, 'Retry-After': String(LIVE_RETRY_AFTER_SECONDS) };

const tryAgain = (error: string, status: number) =>
  json({ error, retry: true }, { status, headers: RETRY });

export const POST: RequestHandler = async ({ request, params, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) {
      console.error('[Live] SCHEDULER_DB not configured');
      return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    }

    const row = await getSession(db, params.id ?? '');
    if (!row) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
    if (row.status === 'ended') {
      return json({ error: 'ended' }, { status: 409, headers: NO_STORE });
    }

    // Host token only, and before the body is read.
    if (!(await hostTokenMatches(row, readHostToken(request)))) {
      return json({ error: 'auth_failed', detail: 'token' }, { status: 401, headers: NO_STORE });
    }

    // Dark launch: the session's host must still be on the list.
    if (!isLiveHost(row.host_pubkey)) {
      return json({ error: 'not_allowed' }, { status: 403, headers: NO_STORE });
    }

    const contentType = (request.headers.get('Content-Type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/sdp') {
      return json({ error: 'unsupported_media_type' }, { status: 415, headers: NO_STORE });
    }

    const offer = await readBodyCapped(request, LIVE_OFFER_MAX_BYTES);
    if (offer === 'too_large') {
      return json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
    }
    if (offer === 'unreadable' || offer.length < 4) {
      return json({ error: 'bad_offer' }, { status: 400, headers: NO_STORE });
    }
    // Every SDP description starts with the version line "v=0".
    if (!(offer[0] === 0x76 && offer[1] === 0x3d && offer[2] === 0x30)) {
      return json({ error: 'bad_offer' }, { status: 400, headers: NO_STORE });
    }

    const cfg = readStreamConfig(platform);
    if (!cfg) {
      console.error('[Live] Stream is not configured (CF_STREAM_API_TOKEN / CF_STREAM_ACCOUNT_ID)');
      return tryAgain('stream_unavailable', 503);
    }

    const result = await publishSession(db, cfg, row.id, offer);
    if (result.ok) {
      // Status and SDP only. No header from Cloudflare is copied.
      return new Response(result.answer, {
        status: 201,
        headers: { 'Content-Type': 'application/sdp', ...NO_STORE }
      });
    }
    switch (result.reason) {
      case 'busy':
        return tryAgain('publish_in_progress', 409);
      case 'ended':
        return json({ error: 'ended' }, { status: 409, headers: NO_STORE });
      case 'attempt_limit':
        return json({ error: 'publish_limit' }, { status: 429, headers: NO_STORE });
      case 'offer_rejected':
        return json({ error: 'offer_rejected' }, { status: 422, headers: NO_STORE });
      case 'unavailable':
        return tryAgain('stream_unavailable', 503);
    }
  } catch (err) {
    // Name only: an error message could quote a URL or part of a body.
    console.error(`[Live] publish failed: ${(err as Error)?.name ?? 'error'}`);
    return tryAgain('stream_unavailable', 503);
  }
};
