/**
 * Go live — the session's pre-signed "ended" announcement.
 *
 * Only the host can sign the kind 30311 that says a stream has ended,
 * and the host page is often gone when it does. So the page signs it
 * ahead of time, with every live announcement, and leaves it here; the
 * server publishes it when the session ends by any path (see
 * $lib/live/endedEvent.server). The server never builds or signs one.
 *
 * POST /api/live/<id>/ended-event      hold this one (replaces an older one)
 *   Auth: the session's host token, `Authorization: Bearer <token>`.
 *   Body: JSON `{ "event": <signed kind 30311>, "relays": ["wss://…"] }`,
 *         under 16 KB. `relays` is optional: up to 8 of the host's own
 *         relays (wss://, public hostnames) to publish to as well.
 *   200:  { id, event_id }
 *
 * DELETE /api/live/<id>/ended-event    forget the held one
 *   Auth: the host token. For a live announcement that went out without
 *   a twin: the held one is older than it now, and relays would refuse it.
 *   200:  { id, dropped }
 *
 * GET /api/live/<id>/ended-event       the held event of an ENDED session
 *   No auth: once the session has ended the event is meant to be public.
 *   200:  { id, event }
 *   404:  unknown id, the session has not ended, or nothing is held
 *
 * Replies (POST, DELETE):
 *   400 bad_request      body not JSON, or the event is not this session's
 *                        ended announcement signed by its host
 *   401 auth_failed      no token, or the wrong one (checked after "ended":
 *                        the token dies with the session)
 *   404 not_found        unknown or malformed id
 *   409 ended            the session has ended
 *   409 not_newer        the held event is as new or newer (POST)
 *   413 too_large        body over 16 KB
 *   500 not_configured   the database is not bound
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { readBodyCapped } from '$lib/live/body.server';
import { dropEndedEvent, readEndedEvent, storeEndedEvent } from '$lib/live/endedEvent.server';
import {
  getSession,
  hostTokenMatches,
  isLiveSessionId,
  readHostToken,
  type LiveDb,
  type LiveSessionRow
} from '$lib/live/sessions.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 16 * 1024;
const reply = (body: unknown, status = 200) => json(body, { status, headers: NO_STORE });

/** The open session this host token belongs to, or the refusal to send. */
async function hostSession(
  db: LiveDb,
  id: string,
  request: Request
): Promise<LiveSessionRow | Response> {
  const row = await getSession(db, id);
  if (!row) return reply({ error: 'not_found' }, 404);
  // Checked before the token, which dies with the session.
  if (row.status === 'ended') return reply({ error: 'ended' }, 409);
  if (!(await hostTokenMatches(row, readHostToken(request)))) {
    return reply({ error: 'auth_failed', detail: 'token' }, 401);
  }
  return row;
}

export const POST: RequestHandler = async ({ request, params, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) {
      console.error('[Live] SCHEDULER_DB not configured');
      return reply({ error: 'not_configured' }, 500);
    }
    const row = await hostSession(db, params.id ?? '', request);
    if (row instanceof Response) return row;

    const body = await readBodyCapped(request, MAX_BODY_BYTES);
    if (body === 'too_large') return reply({ error: 'too_large' }, 413);
    let parsed: { event?: unknown; relays?: unknown } | null = null;
    try {
      parsed = body === 'unreadable' ? null : JSON.parse(new TextDecoder().decode(body));
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object') return reply({ error: 'bad_request' }, 400);

    const outcome = await storeEndedEvent(db, row, parsed.event, parsed.relays);
    if (outcome.ok) return reply({ id: row.id, event_id: outcome.id });
    if (outcome.reason === 'invalid') {
      return reply({ error: 'bad_request', detail: outcome.problem }, 400);
    }
    return reply({ error: outcome.reason }, 409);
  } catch (err) {
    console.error(`[Live] ended-event store failed: ${(err as Error)?.name ?? 'error'}`);
    return reply({ error: 'internal' }, 500);
  }
};

export const DELETE: RequestHandler = async ({ request, params, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) {
      console.error('[Live] SCHEDULER_DB not configured');
      return reply({ error: 'not_configured' }, 500);
    }
    const row = await hostSession(db, params.id ?? '', request);
    if (row instanceof Response) return row;
    return reply({ id: row.id, dropped: await dropEndedEvent(db, row.id) });
  } catch (err) {
    console.error(`[Live] ended-event drop failed: ${(err as Error)?.name ?? 'error'}`);
    return reply({ error: 'internal' }, 500);
  }
};

export const GET: RequestHandler = async ({ params, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) {
      console.error('[Live] SCHEDULER_DB not configured');
      return reply({ error: 'not_configured' }, 500);
    }
    const id = params.id ?? '';
    const event = isLiveSessionId(id) ? await readEndedEvent(db, id) : null;
    if (!event) return reply({ error: 'not_found' }, 404);
    return reply({ id, event });
  } catch (err) {
    console.error(`[Live] ended-event read failed: ${(err as Error)?.name ?? 'error'}`);
    return reply({ error: 'internal' }, 500);
  }
};
