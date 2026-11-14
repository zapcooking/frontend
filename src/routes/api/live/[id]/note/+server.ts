/**
 * Go live — record the session's "Live now" note.
 *
 * POST /api/live/<id>/note
 *   Auth: the session's host token, `Authorization: Bearer <token>`
 *         (header only, as for publish and end).
 *   Body: JSON `{ "note_id": "<64 hex>" }`, under 1 KB.
 *   200:  { id, note_id }
 *
 * The host page posts the note (kind 1, signed by the host) and then
 * records its id here, so viewers can find the stream's comments (replies
 * to the note) and its zaps from the session itself instead of searching
 * relays. The id is set once and only while the session has not ended.
 * Nothing about viewers is read or stored.
 *
 * Replies:
 *   200                  recorded (or the same id was already recorded)
 *   400 bad_request      body not JSON, or note_id not 64 lowercase hex
 *   401 auth_failed      no token, or the wrong one (checked after "ended":
 *                        the token dies with the session)
 *   404 not_found        unknown or malformed id
 *   409 note_already_set a different note is already recorded
 *   409 ended            the session has ended
 *   413 too_large        body over 1 KB
 *   500 not_configured   the database is not bound
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { readBodyCapped } from '$lib/live/body.server';
import {
  getSession,
  hostTokenMatches,
  isNoteId,
  readHostToken,
  setSessionNote,
  type LiveDb
} from '$lib/live/sessions.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 1024;

export const POST: RequestHandler = async ({ request, params, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) {
      console.error('[Live] SCHEDULER_DB not configured');
      return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    }

    const row = await getSession(db, params.id ?? '');
    if (!row) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
    // Checked before the token, which dies with the session.
    if (row.status === 'ended') {
      return json({ error: 'ended' }, { status: 409, headers: NO_STORE });
    }
    if (!(await hostTokenMatches(row, readHostToken(request)))) {
      return json({ error: 'auth_failed', detail: 'token' }, { status: 401, headers: NO_STORE });
    }

    const body = await readBodyCapped(request, MAX_BODY_BYTES);
    if (body === 'too_large') {
      return json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
    }
    let noteId: unknown = null;
    try {
      noteId = body === 'unreadable' ? null : JSON.parse(new TextDecoder().decode(body))?.note_id;
    } catch {
      noteId = null;
    }
    if (!isNoteId(noteId)) {
      return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
    }

    if (row.note_id === noteId) {
      return json({ id: row.id, note_id: noteId }, { headers: NO_STORE });
    }
    if (row.note_id) {
      return json({ error: 'note_already_set' }, { status: 409, headers: NO_STORE });
    }
    if (!(await setSessionNote(db, row.id, noteId))) {
      // Raced: ended, or another note recorded, between the read and now.
      const now = await getSession(db, row.id);
      if (now?.note_id === noteId) {
        return json({ id: row.id, note_id: noteId }, { headers: NO_STORE });
      }
      return json(
        { error: now?.status === 'ended' ? 'ended' : 'note_already_set' },
        { status: 409, headers: NO_STORE }
      );
    }
    return json({ id: row.id, note_id: noteId }, { headers: NO_STORE });
  } catch (err) {
    console.error(`[Live] note failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
