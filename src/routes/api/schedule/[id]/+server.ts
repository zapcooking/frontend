/**
 * Scheduled Posts API — cancel.
 *
 * DELETE /api/schedule/[id]
 *   Only status='pending' rows are cancellable (→ 'cancelled', 200).
 *   Any other status → 409 { error: 'not_cancellable', status }.
 *
 * 404 DISCIPLINE: "row doesn't exist" and "row belongs to someone
 * else" MUST return byte-identical 404s — the lookup is scoped to the
 * auth pubkey so the two cases are indistinguishable by construction.
 * Do not "improve" the ownership case to a 403: that would leak which
 * event ids exist in other users' schedules.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { verifyNip98 } from '$lib/nip98.server';
import { authFailedResponse } from '$lib/scheduleApi.server';

export const DELETE: RequestHandler = async ({ request, params, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB;
    if (!db) {
      console.error('[Schedule] SCHEDULER_DB not configured');
      return json({ error: 'not_configured' }, { status: 500 });
    }

    const auth = await verifyNip98(request, {});
    if (!auth.ok) {
      console.warn(`[Schedule] NIP-98 rejected (${auth.reason}) on DELETE`);
      return authFailedResponse(auth.reason);
    }

    const id = params.id ?? '';
    const row = await db
      .prepare('SELECT status FROM scheduled_events WHERE id = ?1 AND pubkey = ?2')
      .bind(id, auth.pubkey)
      .first<{ status: string }>();
    if (!row) return json({ error: 'not_found' }, { status: 404 });

    if (row.status !== 'pending') {
      return json({ error: 'not_cancellable', status: row.status }, { status: 409 });
    }

    // Conditional update: if the sweep claimed the row between our
    // read and this write (status flipped off 'pending'), changes is 0
    // and we report the current status honestly instead of lying
    // "cancelled" about an event already being broadcast.
    const now = Math.floor(Date.now() / 1000);
    const res = await db
      .prepare(
        "UPDATE scheduled_events SET status = 'cancelled', updated_at = ?3 WHERE id = ?1 AND pubkey = ?2 AND status = 'pending'"
      )
      .bind(id, auth.pubkey, now)
      .run();
    if ((res.meta?.changes ?? 0) === 0) {
      const current = await db
        .prepare('SELECT status FROM scheduled_events WHERE id = ?1 AND pubkey = ?2')
        .bind(id, auth.pubkey)
        .first<{ status: string }>();
      return json({ error: 'not_cancellable', status: current?.status ?? 'unknown' }, { status: 409 });
    }

    return json({ id, status: 'cancelled' });
  } catch (err) {
    console.error('[Schedule] DELETE failed:', err);
    return json({ error: 'internal' }, { status: 500 });
  }
};
