/**
 * Go live — end a session.
 *
 * POST /api/live/<id>/end
 *   Auth, either of:
 *     Authorization: Bearer <host_token>   the token returned at create
 *     Authorization: Nostr <NIP-98>        signed by the session's host
 *                                          (ends it from another device)
 *   200: { id, status: 'ended' }, plus { peak_watching, joins } when this
 *        call ended it (the host's after-the-stream counts; see ../stats)
 *   401: no credential, a wrong or expired token, or a bad signature
 *   403: a valid signature from someone who is not the host
 *   404: unknown or malformed id
 *   413: a NIP-98 request with a body over 1 KB (End takes no body)
 *
 * Ending also deletes the session's Cloudflare live input, which is what
 * stops the broadcast for viewers. The reply is 200 whether or not that
 * delete could be confirmed: the session IS ended (nobody new can join,
 * and the host token is dead). An unconfirmed delete leaves the input id
 * on the row, which is the record the sweep uses to retry.
 *
 * Ending also publishes the host's pre-signed "ended" announcement (kind
 * 30311), when one is held, so other Nostr apps stop showing the stream
 * as live (see $lib/live/endedEvent.server). After the reply; never
 * changes it.
 *
 * Idempotent: ending a session that has already ended returns the same
 * 200 and changes nothing. That reply needs no credential (the status is
 * public, and by then the host token no longer exists).
 *
 * The host token is read from the Authorization header only. A token in
 * the URL or the body is ignored.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { verifyNip98 } from '$lib/nip98.server';
import { authFailedResponse } from '$lib/scheduleApi.server';
import { readBodyCapped } from '$lib/live/body.server';
import { parseRelaysOverride, publishHeldEnded } from '$lib/live/endedEvent.server';
import { readLiveEnv } from '$lib/live/env.server';
import { removeInputAfterEnd } from '$lib/live/relay.server';
import { readStreamConfig } from '$lib/live/stream.server';
import {
  endSession,
  getSession,
  getSessionStats,
  hostTokenMatches,
  readHostToken,
  type LiveDb
} from '$lib/live/sessions.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 1024;
const unauthorized = () =>
  json({ error: 'auth_failed', detail: 'token' }, { status: 401, headers: NO_STORE });

export const POST: RequestHandler = async ({ request, params, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) {
      console.error('[Live] SCHEDULER_DB not configured');
      return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    }

    const row = await getSession(db, params.id ?? '');
    if (!row) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });

    const ended = () => json({ id: row.id, status: 'ended' }, { headers: NO_STORE });
    if (row.status === 'ended') return ended();

    const header = request.headers.get('Authorization') ?? '';

    if (header.startsWith('Nostr ')) {
      // End takes no body. Whatever is sent is read under a small cap,
      // enforced while reading, before any signature work.
      const bodyBytes = await readBodyCapped(request, MAX_BODY_BYTES);
      if (bodyBytes === 'too_large') {
        return json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
      }
      if (bodyBytes === 'unreadable') {
        return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
      }
      // The same bytes feed the payload check; an empty body means there
      // is nothing to bind and no payload tag is required.
      const auth = await verifyNip98(request, bodyBytes.length > 0 ? { bodyBytes } : {});
      if (!auth.ok) {
        console.warn(`[Live] NIP-98 rejected (${auth.reason}) on end`);
        return authFailedResponse(auth.reason);
      }
      if (auth.pubkey.toLowerCase() !== row.host_pubkey) {
        return json({ error: 'not_host' }, { status: 403, headers: NO_STORE });
      }
    } else if (!(await hostTokenMatches(row, readHostToken(request)))) {
      return unauthorized();
    }

    await endSession(db, row.id, 'host');
    // Deleting the Cloudflare input is what stops the broadcast for
    // viewers. If it cannot be confirmed the session is still ended, and
    // the input id stays on the row for the sweep to retry.
    await removeInputAfterEnd(db, readStreamConfig(platform), row.id);
    // Tell other Nostr apps: publish the "ended" announcement the host
    // signed ahead of time, if one is held. One try now, after the reply;
    // the sweep retries whatever this leaves waiting.
    const told = publishHeldEnded(db, row.id, {
      relaysOverride: parseRelaysOverride(readLiveEnv(platform, 'LIVE_ENDED_RELAYS'))
    }).catch((err) => {
      console.error(`[LiveEnded] session=${row.id} publish failed: ${(err as Error)?.name ?? 'error'}`);
    });
    if (platform?.ctx?.waitUntil) platform.ctx.waitUntil(told);
    else await told;
    // The host's after-the-stream counts go with THIS reply only (it is the
    // authenticated one). The idempotent reply above carries none.
    const stats = await getSessionStats(db, row.id).catch(() => null);
    return json(
      {
        id: row.id,
        status: 'ended',
        ...(stats ? { peak_watching: stats.peak_watching, joins: stats.joins } : {})
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error('[Live] end failed:', err);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
