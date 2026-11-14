/**
 * Go live — read a session.
 *
 * GET /api/live/<id>
 *   No auth: anyone can watch, so anyone can read this.
 *   200: { id, status, title, recipe_a, host_pubkey, created_at, started_at, ended_at }
 *   404: unknown or malformed id
 *
 * The host and watch pages poll this to learn that a session has ended.
 * The response is built by toPublicSession and never contains the host
 * token hash, the Cloudflare input id, the play address or the lock.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getSession, toPublicSession, type LiveDb } from '$lib/live/sessions.server';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const GET: RequestHandler = async ({ params, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) {
      console.error('[Live] SCHEDULER_DB not configured');
      return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    }
    const row = await getSession(db, params.id ?? '');
    if (!row) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
    return json(toPublicSession(row), { headers: NO_STORE });
  } catch (err) {
    console.error('[Live] read failed:', err);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
