/**
 * Go live — how many are watching a session now.
 *
 * GET /api/live/<id>/watching
 *   No auth: the same number is shown on the public Live cards.
 *   200: { watching }   a whole number while live; null when the count
 *                       cannot be read right now, or the session is not live
 *   404: unknown or malformed id
 *
 * Read by the host page while live. The count is the session's anonymous
 * heartbeat count (see ../heartbeat). Reading it records nothing.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { readWatching } from '$lib/live/presence.server';
import { getSessionStatus, type LiveDb } from '$lib/live/sessions.server';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const GET: RequestHandler = async ({ params, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    const id = params.id ?? '';
    const session = await getSessionStatus(db, id);
    if (!session) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
    // Only a live session has (or gets) a presence object.
    const watching = session.status === 'live' ? await readWatching(platform, id) : null;
    return json({ watching }, { headers: NO_STORE });
  } catch (err) {
    console.error(`[Live] watching read failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ watching: null }, { headers: NO_STORE });
  }
};
