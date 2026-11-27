/**
 * Go live — report a stream, or one comment in its chat.
 *
 * POST /api/live/<id>/report
 *   A stream report needs no auth: anyone watching may report the stream.
 *   A COMMENT report needs NIP-98 over this exact request (401
 *   auth_required otherwise): only signed-in users report comments (Privacy
 *   §1.7). The signature is checked and nothing about the signer is
 *   stored or sent: the reporter is still only the keyed IP hash.
 *   Rate limited per IP.
 *   Body: { reason, details?, comment?: { id, pubkey } }
 *     reason   child_safety | nudity | violence | spam | other
 *     details  the reporter's note, at most 300 characters
 *     comment  the reported comment (event id and author); absent = the stream
 *   200: { ok: true, duplicate: boolean }   nothing else: no totals, no status
 *
 * What a report does, in this order:
 *  1. It is stored (live_reports), one per reporter per target. A
 *     reporter is a KEYED hash: HMAC-SHA256(LIVE_REPORTER_HASH_SECRET,
 *     the rate limiter's daily-salted IP hash). Never the IP, and never an
 *     unkeyed hash: without the secret NOTHING is stored, the admin is
 *     still DM'd (unthrottled, marked "not stored"), and the reply is
 *     503 not_stored (the page asks the reporter to email support).
 *  2. The session's hold is opened (first report) with a snapshot, so the
 *     record is kept until the admin releases it.
 *  3. The admin is DM'd (throttled per session, except child safety and
 *     violence). A repeat from the same reporter sends nothing, except an
 *     urgent report, which always alerts. An urgent report after the same
 *     reporter's report of another reason is stored too.
 * Nothing is ended automatically: the admin decides.
 *
 * Replies: 400 bad_request, 401 auth_required (a comment report without a
 * valid signature), 404 not_found, 413 too_large, 429 (rate
 * limit), 500 not_configured / internal, 503 not_stored (the reporter
 * hash secret is not set; the admin was DM'd).
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEYS } from '$lib/adminAuth';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import {
  LIVE_REPORT_DETAILS_MAX,
  isLiveReportReason,
  liveReportRateScope
} from '$lib/live/config';
import { readBodyCapped } from '$lib/live/body.server';
import { liveKv, readLiveEnv } from '$lib/live/env.server';
import { alertThrottleName, sendReportAlert } from '$lib/live/reportAlert.server';
import { keyedReporterHash, recordReport } from '$lib/live/safety.server';
import { getSession, isLiveSessionId, type LiveDb } from '$lib/live/sessions.server';
import { publishEventRaw } from '$lib/rawPublish';
import { verifyNip98 } from '$lib/nip98.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 2048;
const HEX64 = /^[0-9a-f]{64}$/;

const bad = () => json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });

export const POST: RequestHandler = async ({ request, params, getClientAddress, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    const sessionId = params.id ?? '';
    if (!isLiveSessionId(sessionId)) return bad();

    const bytes = await readBodyCapped(request, MAX_BODY_BYTES);
    if (bytes === 'too_large') return json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
    if (bytes === 'unreadable') return bad();
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad();
      body = parsed as Record<string, unknown>;
    } catch {
      return bad();
    }

    const reason = body.reason;
    if (!isLiveReportReason(reason)) return bad();
    if (body.details !== undefined && typeof body.details !== 'string') return bad();
    const details = typeof body.details === 'string' ? body.details.trim() : '';
    if (details.length > LIVE_REPORT_DETAILS_MAX) return bad();
    let comment: { id: string; pubkey: string } | null = null;
    if (body.comment !== undefined) {
      const c = body.comment as { id?: unknown; pubkey?: unknown } | null;
      const id = typeof c?.id === 'string' ? c.id.toLowerCase() : '';
      const pubkey = typeof c?.pubkey === 'string' ? c.pubkey.toLowerCase() : '';
      if (!HEX64.test(id) || !HEX64.test(pubkey)) return bad();
      comment = { id, pubkey };
    }

    // Comment reports are for signed-in users: the server enforces what the
    // chat shows. Checked, never stored (the signer's key is not used).
    if (comment) {
      const auth = await verifyNip98(request, { bodyBytes: bytes });
      if (!auth.ok) {
        console.warn(`[Live] comment report refused: NIP-98 ${auth.reason}`);
        return json({ error: 'auth_required' }, { status: 401, headers: NO_STORE });
      }
    }

    // Per-IP limit. Its daily-salted hash, keyed with the secret, is the
    // reporter's identity (one report per reporter per target); the salt
    // still rotates daily. No usable address (or no KV): the report is
    // taken under a one-off 'unverified:' id that matches nothing.
    let ip = '';
    try {
      ip = getClientAddress();
    } catch {
      /* no address */
    }
    let reporterHash = '';
    if (ip) {
      const kv = platform?.env?.GATED_CONTENT ?? platform?.env?.NOURISH_FLAGS;
      const limited = await checkPerIpRateLimit(kv, {
        ip,
        scope: liveReportRateScope(readLiveEnv(platform, 'LIVE_INPUT_PREFIX')),
        perHour: 8,
        perDay: 20
      });
      if (limited.limited) return json(limited.body, { status: 429, headers: NO_STORE });
      reporterHash = limited.ipHash;
    }

    const alertDeps = {
      kv: platform?.env?.GATED_CONTENT,
      throttleKey: liveKv(platform, alertThrottleName(sessionId)),
      senderKey: readLiveEnv(platform, 'NOTIFICATION_PRIVATE_KEY'),
      recipientPubkeys: ADMIN_PUBKEYS,
      publish: publishEventRaw
    };
    const origin = new URL(request.url).origin;

    // Fail closed on storage: without the secret no report is stored (an
    // unkeyed IP hash is never written). The admin is still DM'd, never
    // throttled, so no report (above all a child-safety one) is lost
    // silently; the reporter is asked to email support.
    const hashSecret = readLiveEnv(platform, 'LIVE_REPORTER_HASH_SECRET');
    if (!hashSecret) {
      console.error('[Live] report NOT stored: LIVE_REPORTER_HASH_SECRET is not set');
      const session = await getSession(db, sessionId);
      if (!session) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
      await sendReportAlert(
        { sessionId, title: session.title, reason, comment: !!comment, origin, notStored: true },
        alertDeps
      );
      return json({ error: 'not_stored' }, { status: 503, headers: NO_STORE });
    }
    reporterHash = reporterHash ? await keyedReporterHash(hashSecret, reporterHash) : '';

    const result = await recordReport(db, { sessionId, reporterHash, reason, details, comment });
    if (!result.ok) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
    console.info(
      `[Live] report session=${sessionId} reason=${reason} comment=${!!comment} new=${result.recorded}`
    );

    // Alert on every new report, and on EVERY urgent one (child safety,
    // violence), even an identical repeat: an urgent report is never lost
    // silently. The per-IP limit bounds how often that can happen.
    if (result.recorded || result.urgent) {
      const alert = sendReportAlert(
        { sessionId, title: result.title, reason, comment: !!comment, origin },
        alertDeps
      );
      if (platform?.ctx) platform.ctx.waitUntil(alert);
      else await alert;
    }

    return json({ ok: true, duplicate: !result.recorded }, { headers: NO_STORE });
  } catch (err) {
    console.error(`[Live] report failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
