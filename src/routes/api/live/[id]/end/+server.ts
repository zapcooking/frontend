/**
 * Go live — end a session.
 *
 * POST /api/live/<id>/end
 *   Auth, either of:
 *     Authorization: Bearer <host_token>   the token returned at create
 *     Authorization: Nostr <NIP-98>        signed by the session's host
 *                                          (ends it from another device)
 *   200: { id, status: 'ended' }
 *   401: no credential, a wrong or expired token, or a bad signature
 *   403: a valid signature from someone who is not the host
 *   404: unknown or malformed id
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
import {
  endSession,
  getSession,
  hostTokenMatches,
  readHostToken,
  type LiveDb
} from '$lib/live/sessions.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
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
      // The same bytes feed the payload check; an empty body means there
      // is nothing to bind and no payload tag is required.
      let bodyBytes: Uint8Array;
      try {
        bodyBytes = new Uint8Array(await request.arrayBuffer());
      } catch {
        return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
      }
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
    return ended();
  } catch (err) {
    console.error('[Live] end failed:', err);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
