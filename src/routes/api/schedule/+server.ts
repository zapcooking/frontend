/**
 * Scheduled Posts API — create + list.
 *
 * POST /api/schedule
 *   Body: { event: <complete signed Nostr event>, relay_mode: 'all' | 'pantry',
 *           relays?: string[], replaces?: <event id> }
 *   `relays` (optional, at most 4) are the author's own relays; in 'all'
 *   mode the sweep broadcasts to them as well as its floor relays. They
 *   are validated and ignored (not stored) in 'pantry' mode.
 *   The event is signed CLIENT-SIDE with created_at set to the future
 *   publish time — the server never holds keys and cannot alter the
 *   event (the signature covers everything). Validation runs the spec
 *   §5.1 table in order, fail-fast, returning machine-readable error
 *   codes. On success the full signed event is encrypted at rest
 *   (AES-256-GCM; protects DB exports, not the operator — see
 *   scheduleCrypto.server.ts) and inserted as status='pending' for the
 *   Phase 2 cron sweep to broadcast at publish_at.
 *
 *   `replaces` (optional) moves or edits a scheduled post in one step:
 *   the new event is stored and the caller's pending row with that id
 *   is cancelled in ONE D1 transaction, so the post is never both
 *   scheduled twice and never lost. The old row must be the caller's
 *   and still pending (404 not_found / 409 not_replaceable otherwise,
 *   nothing stored). A replace is exempt from the pending quota (net
 *   zero) and from the creates-per-hour cap; it has its own cap
 *   (MAX_MOVES_PER_HOUR). The 201 echoes `replaced: <old id>` so a
 *   client can tell this server honoured the field.
 *
 * GET /api/schedule[?status=pending|publishing|sent|failed|cancelled]
 *   The caller's rows, newest publish_at first, capped at 100,
 *   decrypted server-side — clients render their own previews. With no
 *   filter, every status EXCEPT cancelled: cancelled rows pile up with
 *   every reschedule and would push live rows out of the cap. They are
 *   still returned by ?status=cancelled. `truncated: true` is added
 *   when the cap cut the result. The query string is not part of the
 *   NIP-98 `u` match (normalizeUrl drops it), so a filtered request
 *   signs the bare URL.
 *
 * The full client contract, with every error code, is
 * docs/schedule-contract.md — change the two together.
 *
 * Both require NIP-98 auth. Failures collapse to a coarse
 * 401 { error: 'auth_failed', detail: <broad category> } — the
 * verifier's granular reason is logged, never returned (no oracle).
 * Identity is whatever pubkey signed the auth event; the POST body's
 * event.pubkey is then compared against it explicitly (pubkey_mismatch)
 * rather than via the verifier's expectedPubkey option.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools';
import { verifyNip98 } from '$lib/nip98.server';
import {
  importScheduleKey,
  encryptScheduledEvent,
  decryptScheduledEvent
} from '$lib/scheduleCrypto.server';
import { parseScheduleRelays, storedScheduleRelays } from '$lib/scheduleRelays';
import {
  SCHEDULABLE_KINDS,
  PANTRY_SCHEDULABLE_KINDS,
  SCHEDULE_STATUSES,
  MIN_LEAD_SECONDS,
  MAX_LEAD_SECONDS,
  MAX_EVENT_BYTES,
  POLL_CLOSE_MARGIN_SECONDS,
  MAX_PENDING_PER_PUBKEY,
  MAX_CREATES_PER_HOUR,
  MAX_MOVES_PER_HOUR,
  LIST_LIMIT,
  RELAY_MODES,
  authFailedResponse,
  pollCloseTimestamp,
  type RelayMode,
  type ScheduleStatus,
  type ScheduledEventRow
} from '$lib/scheduleApi.server';

function getScheduleConfig(platform: Readonly<App.Platform> | undefined) {
  return {
    db: platform?.env?.SCHEDULER_DB,
    encKeyHex: platform?.env?.SCHEDULE_ENC_KEY || env.SCHEDULE_ENC_KEY
  };
}

/** 409 for an event that is already stored, with what a retrying client needs to know. */
function alreadyScheduled(row: { status: string; replaces?: string | null }): Response {
  return json(
    { error: 'already_scheduled', status: row.status, ...(row.replaces ? { replaced: row.replaces } : {}) },
    { status: 409 }
  );
}

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const { db, encKeyHex } = getScheduleConfig(platform);
    if (!db || !encKeyHex) {
      console.error('[Schedule] SCHEDULER_DB / SCHEDULE_ENC_KEY not configured');
      return json({ error: 'not_configured' }, { status: 500 });
    }

    // Body read ONCE as raw bytes — the same bytes feed the NIP-98
    // payload-hash check and the JSON parse (note-review pattern).
    let bodyBytes: Uint8Array;
    try {
      bodyBytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return json({ error: 'bad_request' }, { status: 400 });
    }

    const auth = await verifyNip98(request, { bodyBytes });
    if (!auth.ok) {
      console.warn(`[Schedule] NIP-98 rejected (${auth.reason}) on POST`);
      return authFailedResponse(auth.reason);
    }

    // ── Spec §5.1 validation table, in order, fail-fast ──────────────

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes)) as Record<string, unknown>;
    } catch {
      return json({ error: 'bad_request' }, { status: 400 });
    }
    const { event, relay_mode, relays: relaysField, replaces: replacesField } = body ?? {};
    if (
      !event ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      typeof relay_mode !== 'string'
    ) {
      return json({ error: 'bad_request' }, { status: 400 });
    }

    // Optional: the id of the caller's pending row this event replaces.
    // Absent or null is a plain create. Anything else that is not an
    // event id is a client bug, refused before anything is looked up.
    let replaces: string | null = null;
    if (replacesField !== undefined && replacesField !== null) {
      if (typeof replacesField !== 'string' || !/^[0-9a-f]{64}$/.test(replacesField)) {
        return json({ error: 'bad_request' }, { status: 400 });
      }
      replaces = replacesField;
    }

    if (!RELAY_MODES.includes(relay_mode as RelayMode)) {
      return json({ error: 'bad_relay_mode' }, { status: 400 });
    }
    const relayMode = relay_mode as RelayMode;

    // Validated in every mode, so a bad list is never silently
    // accepted; used only in 'all' mode (pantry rows go to pantry alone).
    const parsedRelays = parseScheduleRelays(relaysField);
    if (!parsedRelays.ok) return json({ error: 'bad_relays' }, { status: 400 });
    const relays = relayMode === 'all' ? parsedRelays.relays : [];

    // verifyEvent recomputes the id hash and schnorr-verifies the sig.
    const ev = event as NostrEvent;
    let sigOk = false;
    try {
      sigOk = verifyEvent(ev);
    } catch {
      sigOk = false;
    }
    if (!sigOk) return json({ error: 'bad_signature' }, { status: 400 });

    if (ev.pubkey !== auth.pubkey) return json({ error: 'pubkey_mismatch' }, { status: 400 });

    if (!SCHEDULABLE_KINDS.includes(ev.kind)) return json({ error: 'bad_kind' }, { status: 400 });

    // Schedulable, but pantry would reject it from the keyless sweep
    // (see PANTRY_SCHEDULABLE_KINDS) — refuse now rather than fail later.
    if (relayMode === 'pantry' && !PANTRY_SCHEDULABLE_KINDS.includes(ev.kind)) {
      return json({ error: 'kind_not_allowed_for_relay_mode' }, { status: 400 });
    }

    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isInteger(ev.created_at) ||
      ev.created_at <= now + MIN_LEAD_SECONDS ||
      ev.created_at >= now + MAX_LEAD_SECONDS
    ) {
      return json({ error: 'bad_publish_time' }, { status: 400 });
    }

    const serialized = JSON.stringify(ev);
    if (new TextEncoder().encode(serialized).length > MAX_EVENT_BYTES) {
      return json({ error: 'too_large' }, { status: 400 });
    }

    // A scheduled poll that closes before (or within a minute of) its
    // publish time would be born dead — reject at schedule time.
    const closeAt = pollCloseTimestamp(ev);
    if (closeAt !== null && closeAt <= ev.created_at + POLL_CLOSE_MARGIN_SECONDS) {
      return json({ error: 'poll_closes_before_publish' }, { status: 400 });
    }

    // Already scheduled? Answer that BEFORE the quota and rate checks,
    // with the row's current status: a client retrying after a dropped
    // response must learn its first attempt landed, not be told it is
    // over a limit that the first attempt itself filled. Scoped to the
    // auth pubkey like every other lookup (the id commits to the
    // pubkey, so this is the caller's own row or nothing). A row that
    // itself replaced another says which, so a retried replace learns
    // the swap happened.
    const existing = await db
      .prepare('SELECT status, replaces FROM scheduled_events WHERE id = ?1 AND pubkey = ?2')
      .bind(ev.id, auth.pubkey)
      .first<{ status: string; replaces?: string | null }>();
    if (existing) return alreadyScheduled(existing);

    if (replaces) {
      // Scoped to the auth pubkey: a missing row and someone else's row
      // are the same 404, as on DELETE.
      const old = await db
        .prepare('SELECT status FROM scheduled_events WHERE id = ?1 AND pubkey = ?2')
        .bind(replaces, auth.pubkey)
        .first<{ status: string }>();
      if (!old) return json({ error: 'not_found' }, { status: 404 });
      if (old.status !== 'pending') {
        return json({ error: 'not_replaceable', status: old.status }, { status: 409 });
      }

      // A replace is net zero on pending rows, so the pending quota does
      // not apply, and it does not spend one of the hour's creates. It
      // has its own rolling-hour cap, counted the same way (row
      // created_at, every status).
      const moves = await db
        .prepare(
          'SELECT COUNT(*) AS c FROM scheduled_events WHERE pubkey = ?1 AND created_at > ?2 AND replaces IS NOT NULL'
        )
        .bind(auth.pubkey, now - 3600)
        .first<{ c: number }>();
      if ((moves?.c ?? 0) >= MAX_MOVES_PER_HOUR) {
        return json({ error: 'rate_limited', limit: 'moves' }, { status: 429 });
      }
    } else {
      const pending = await db
        .prepare("SELECT COUNT(*) AS c FROM scheduled_events WHERE pubkey = ?1 AND status = 'pending'")
        .bind(auth.pubkey)
        .first<{ c: number }>();
      if ((pending?.c ?? 0) >= MAX_PENDING_PER_PUBKEY) {
        return json({ error: 'quota_exceeded' }, { status: 400 });
      }

      // Rolling-hour create cap, counted by ROW created_at (schedule
      // time, not publish time) across ALL statuses — cancelled rows
      // still count, so a cancel-and-recreate loop can't bypass it.
      // Rows that replaced another are counted under the moves cap
      // above instead.
      const recent = await db
        .prepare(
          'SELECT COUNT(*) AS c FROM scheduled_events WHERE pubkey = ?1 AND created_at > ?2 AND replaces IS NULL'
        )
        .bind(auth.pubkey, now - 3600)
        .first<{ c: number }>();
      if ((recent?.c ?? 0) >= MAX_CREATES_PER_HOUR) {
        return json({ error: 'rate_limited' }, { status: 429 });
      }
    }

    // ── Validated: encrypt and insert ────────────────────────────────

    const key = await importScheduleKey(encKeyHex);
    const { ciphertext, iv } = await encryptScheduledEvent(key, serialized);

    const storedRelays = relays.length > 0 ? JSON.stringify(relays) : null;
    try {
      if (replaces) {
        // Both statements run in one D1 transaction (batch), and each is
        // conditional on the other's precondition: the new row goes in
        // only while the old one is still the caller's pending row, and
        // the old one is cancelled only once the new row is there. So
        // either both happen or neither does. If the sweep claimed the
        // old row after the lookup above, neither does, and the caller
        // is told the post is already going out.
        const [inserted, cancelled] = await db.batch([
          db
            .prepare(
              `INSERT INTO scheduled_events
                 (id, pubkey, kind, publish_at, relay_mode, ciphertext, iv, status, attempts, created_at, updated_at, relays, replaces)
               SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', 0, ?8, ?8, ?9, ?10
                WHERE EXISTS (
                  SELECT 1 FROM scheduled_events WHERE id = ?10 AND pubkey = ?2 AND status = 'pending'
                )`
            )
            .bind(
              ev.id,
              auth.pubkey,
              ev.kind,
              ev.created_at,
              relayMode,
              ciphertext,
              iv,
              now,
              storedRelays,
              replaces
            ),
          db
            .prepare(
              `UPDATE scheduled_events
                  SET status = 'cancelled', updated_at = ?3
                WHERE id = ?1 AND pubkey = ?2 AND status = 'pending'
                  AND EXISTS (
                    SELECT 1 FROM scheduled_events WHERE id = ?4 AND pubkey = ?2 AND replaces = ?1
                  )`
            )
            .bind(replaces, auth.pubkey, now, ev.id)
        ]);
        const didInsert = (inserted.meta?.changes ?? 0) === 1;
        const didCancel = (cancelled.meta?.changes ?? 0) === 1;
        if (!didInsert && !didCancel) {
          const current = await db
            .prepare('SELECT status FROM scheduled_events WHERE id = ?1 AND pubkey = ?2')
            .bind(replaces, auth.pubkey)
            .first<{ status: string }>();
          if (!current) return json({ error: 'not_found' }, { status: 404 });
          return json({ error: 'not_replaceable', status: current.status }, { status: 409 });
        }
        if (didInsert !== didCancel) {
          // Cannot happen inside one transaction; never report a swap
          // that only half happened.
          throw new Error(`replace was not atomic (insert ${didInsert}, cancel ${didCancel})`);
        }
      } else {
        await db
          .prepare(
            `INSERT INTO scheduled_events
               (id, pubkey, kind, publish_at, relay_mode, ciphertext, iv, status, attempts, created_at, updated_at, relays)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', 0, ?8, ?8, ?9)`
          )
          .bind(ev.id, auth.pubkey, ev.kind, ev.created_at, relayMode, ciphertext, iv, now, storedRelays)
          .run();
      }
    } catch (err) {
      // id is the event id (PRIMARY KEY) — the same signed event can't
      // be scheduled twice. A re-scheduled edit is a NEW signed event.
      // Reached only when two requests for the same event race past
      // the lookup above; the winner's row was inserted a moment ago.
      // (A replace that hits this rolled back whole: its old row is
      // untouched by THIS request.)
      if (err instanceof Error && /UNIQUE|PRIMARY KEY/i.test(err.message)) {
        const raced = await db
          .prepare('SELECT status, replaces FROM scheduled_events WHERE id = ?1 AND pubkey = ?2')
          .bind(ev.id, auth.pubkey)
          .first<{ status: string; replaces?: string | null }>();
        return alreadyScheduled(raced ?? { status: 'pending' });
      }
      throw err;
    }

    return json(
      {
        id: ev.id,
        publish_at: ev.created_at,
        relay_mode: relayMode,
        relays,
        status: 'pending',
        ...(replaces ? { replaced: replaces } : {})
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[Schedule] POST failed:', err);
    return json({ error: 'internal' }, { status: 500 });
  }
};

export const GET: RequestHandler = async ({ request, platform }) => {
  try {
    const { db, encKeyHex } = getScheduleConfig(platform);
    if (!db || !encKeyHex) {
      console.error('[Schedule] SCHEDULER_DB / SCHEDULE_ENC_KEY not configured');
      return json({ error: 'not_configured' }, { status: 500 });
    }

    const auth = await verifyNip98(request, {});
    if (!auth.ok) {
      console.warn(`[Schedule] NIP-98 rejected (${auth.reason}) on GET`);
      return authFailedResponse(auth.reason);
    }

    // Optional ?status= filter. Absent → every status except cancelled.
    const statusParam = new URL(request.url).searchParams.get('status');
    if (statusParam !== null && !SCHEDULE_STATUSES.includes(statusParam as ScheduleStatus)) {
      return json({ error: 'bad_status' }, { status: 400 });
    }

    const columns =
      'id, publish_at, relay_mode, relays, status, attempts, last_error, sent_at, ciphertext, iv';
    // One row past the cap is fetched so the response can say when the
    // cap cut the result.
    const { results } =
      statusParam === null
        ? await db
            .prepare(
              `SELECT ${columns}
                 FROM scheduled_events
                WHERE pubkey = ?1 AND status != 'cancelled'
                ORDER BY publish_at DESC, created_at DESC
                LIMIT ?2`
            )
            .bind(auth.pubkey, LIST_LIMIT + 1)
            .all<ScheduledEventRow>()
        : await db
            .prepare(
              `SELECT ${columns}
                 FROM scheduled_events
                WHERE pubkey = ?1 AND status = ?3
                ORDER BY publish_at DESC, created_at DESC
                LIMIT ?2`
            )
            .bind(auth.pubkey, LIST_LIMIT + 1, statusParam)
            .all<ScheduledEventRow>();
    const truncated = results.length > LIST_LIMIT;

    const key = await importScheduleKey(encKeyHex);
    const items = [];
    for (const row of results.slice(0, LIST_LIMIT)) {
      items.push({
        id: row.id,
        publish_at: row.publish_at,
        relay_mode: row.relay_mode,
        relays: storedScheduleRelays(row.relays),
        status: row.status,
        attempts: row.attempts,
        last_error: row.last_error ?? null,
        sent_at: row.sent_at ?? null,
        event: JSON.parse(await decryptScheduledEvent(key, row.ciphertext, row.iv))
      });
    }

    return json(truncated ? { items, truncated: true } : { items });
  } catch (err) {
    console.error('[Schedule] GET failed:', err);
    return json({ error: 'internal' }, { status: 500 });
  }
};
