/**
 * Go live — report a stream, or one comment in its chat.
 *
 * POST /api/live/<id>/report
 *   No auth (anyone watching may report the stream; the chat asks for
 *   sign-in before it offers to report a comment). Rate limited per IP.
 *   Body: { reason, details?, comment?: { id, pubkey } }
 *     reason   child_safety | nudity | violence | spam | other
 *     details  the reporter's note, at most 300 characters
 *     comment  the reported comment (event id and author); absent = the stream
 *   200: { ok: true, duplicate: boolean }   nothing else: no totals, no status
 *
 * What a report does, in this order:
 *  1. It is stored (live_reports), one per reporter per target. A
 *     reporter is the rate limiter's daily-salted IP hash, never the IP.
 *  2. The session's hold is opened (first report) with a snapshot, so the
 *     record is kept until the admin releases it.
 *  3. The admin is DM'd (throttled per session, except child safety and
 *     violence). A repeat from the same reporter sends nothing.
 * Nothing is ended automatically: the admin decides.
 *
 * Replies: 400 bad_request, 404 not_found, 413 too_large, 429 (rate
 * limit), 500 not_configured / internal.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import { LIVE_REPORT_DETAILS_MAX, isLiveReportReason } from '$lib/live/config';
import { readBodyCapped } from '$lib/live/body.server';
import { readLiveEnv } from '$lib/live/env.server';
import { sendReportAlert } from '$lib/live/reportAlert.server';
import { recordReport } from '$lib/live/safety.server';
import { isLiveSessionId, type LiveDb } from '$lib/live/sessions.server';
import { publishEventRaw } from '$lib/rawPublish';

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

    // Per-IP limit; its daily-salted hash is the reporter's identity (one
    // report per reporter per target). No usable address: the report is
    // still taken.
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
        scope: 'live-report',
        perHour: 8,
        perDay: 20
      });
      if (limited.limited) return json(limited.body, { status: 429, headers: NO_STORE });
      reporterHash = limited.ipHash;
    }

    const result = await recordReport(db, { sessionId, reporterHash, reason, details, comment });
    if (!result.ok) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
    console.info(
      `[Live] report session=${sessionId} reason=${reason} comment=${!!comment} new=${result.recorded}`
    );

    if (result.recorded) {
      const alert = sendReportAlert(
        {
          sessionId,
          title: result.title,
          reason,
          comment: !!comment,
          origin: new URL(request.url).origin
        },
        {
          kv: platform?.env?.GATED_CONTENT,
          senderKey: readLiveEnv(platform, 'NOTIFICATION_PRIVATE_KEY'),
          recipientPubkey: ADMIN_PUBKEY,
          publish: publishEventRaw
        }
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
