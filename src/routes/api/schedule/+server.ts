/**
 * Scheduled Posts API — create + list.
 *
 * POST /api/schedule
 *   Body: { event: <complete signed Nostr event>, relay_mode: 'all' | 'pantry' }
 *   The event is signed CLIENT-SIDE with created_at set to the future
 *   publish time — the server never holds keys and cannot alter the
 *   event (the signature covers everything). Validation runs the spec
 *   §5.1 table in order, fail-fast, returning machine-readable error
 *   codes. On success the full signed event is encrypted at rest
 *   (AES-256-GCM; protects DB exports, not the operator — see
 *   scheduleCrypto.server.ts) and inserted as status='pending' for the
 *   Phase 2 cron sweep to broadcast at publish_at.
 *
 * GET /api/schedule
 *   The caller's rows (all statuses), newest publish_at first, capped
 *   at 100, decrypted server-side — clients render their own previews.
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
import {
  SCHEDULABLE_KINDS,
  MIN_LEAD_SECONDS,
  MAX_LEAD_SECONDS,
  MAX_EVENT_BYTES,
  POLL_CLOSE_MARGIN_SECONDS,
  MAX_PENDING_PER_PUBKEY,
  MAX_CREATES_PER_HOUR,
  LIST_LIMIT,
  RELAY_MODES,
  authFailedResponse,
  pollCloseTimestamp,
  type RelayMode,
  type ScheduledEventRow
} from '$lib/scheduleApi.server';

function getScheduleConfig(platform: Readonly<App.Platform> | undefined) {
  return {
    db: platform?.env?.SCHEDULER_DB,
    encKeyHex: platform?.env?.SCHEDULE_ENC_KEY || env.SCHEDULE_ENC_KEY
  };
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
    const { event, relay_mode } = body ?? {};
    if (
      !event ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      typeof relay_mode !== 'string'
    ) {
      return json({ error: 'bad_request' }, { status: 400 });
    }

    if (!RELAY_MODES.includes(relay_mode as RelayMode)) {
      return json({ error: 'bad_relay_mode' }, { status: 400 });
    }
    const relayMode = relay_mode as RelayMode;

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
    const recent = await db
      .prepare('SELECT COUNT(*) AS c FROM scheduled_events WHERE pubkey = ?1 AND created_at > ?2')
      .bind(auth.pubkey, now - 3600)
      .first<{ c: number }>();
    if ((recent?.c ?? 0) >= MAX_CREATES_PER_HOUR) {
      return json({ error: 'rate_limited' }, { status: 429 });
    }

    // ── Validated: encrypt and insert ────────────────────────────────

    const key = await importScheduleKey(encKeyHex);
    const { ciphertext, iv } = await encryptScheduledEvent(key, serialized);

    try {
      await db
        .prepare(
          `INSERT INTO scheduled_events
             (id, pubkey, kind, publish_at, relay_mode, ciphertext, iv, status, attempts, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', 0, ?8, ?8)`
        )
        .bind(ev.id, auth.pubkey, ev.kind, ev.created_at, relayMode, ciphertext, iv, now)
        .run();
    } catch (err) {
      // id is the event id (PRIMARY KEY) — the same signed event can't
      // be scheduled twice. A re-scheduled edit is a NEW signed event.
      if (err instanceof Error && /UNIQUE|PRIMARY KEY/i.test(err.message)) {
        return json({ error: 'already_scheduled' }, { status: 409 });
      }
      throw err;
    }

    return json(
      { id: ev.id, publish_at: ev.created_at, relay_mode: relayMode, status: 'pending' },
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

    const { results } = await db
      .prepare(
        `SELECT id, publish_at, relay_mode, status, attempts, last_error, sent_at, ciphertext, iv
           FROM scheduled_events
          WHERE pubkey = ?1
          ORDER BY publish_at DESC, created_at DESC
          LIMIT ?2`
      )
      .bind(auth.pubkey, LIST_LIMIT)
      .all<ScheduledEventRow>();

    const key = await importScheduleKey(encKeyHex);
    const items = [];
    for (const row of results) {
      items.push({
        id: row.id,
        publish_at: row.publish_at,
        relay_mode: row.relay_mode,
        status: row.status,
        attempts: row.attempts,
        last_error: row.last_error ?? null,
        sent_at: row.sent_at ?? null,
        event: JSON.parse(await decryptScheduledEvent(key, row.ciphertext, row.iv))
      });
    }

    return json({ items });
  } catch (err) {
    console.error('[Schedule] GET failed:', err);
    return json({ error: 'internal' }, { status: 500 });
  }
};
