/**
 * Go live — staged rollout, for the signed-in account about itself only.
 *
 * GET /api/live/hosting
 *   Auth: NIP-98; the answer is about the signer and nobody else.
 *   200: { mode, approved, request }
 *     mode      'approved' | 'members'
 *     approved  true in 'members' mode, or when the signer is on the
 *               approved-hosts list. Decides what the host page SHOWS;
 *               the create route enforces the same rule. Blocks are not
 *               disclosed.
 *     request   the signer's latest access request:
 *               { status: 'none'|'pending'|'approved'|'declined',
 *                 created_at, decided_at, retry_at }
 *               retry_at: when a declined account may ask again (null = now)
 *     terms     { version, accepted }: the current LIVE_TERMS_VERSION and
 *               whether the signer has agreed to it ("I'm 18+, agree and
 *               go live"; recorded by POST /api/live/terms)
 *
 * POST /api/live/hosting   (Request access)
 *   Auth: NIP-98 over this exact request; the signer is the requester.
 *   Body: { note?: string }   at most 280 characters
 *   Saves a pending request in the queue (/admin/live) and DMs the admin
 *   (at most one DM per 10 minutes; it says how many are pending).
 *   200: { ok: true, status: 'pending' }
 *        { ok: true, approved: true }   already approved: nothing saved
 *   400 bad_request (note too long), 401 auth_failed,
 *   403 membership_required, 409 already_pending,
 *   409 declined_recently { retry_at }, 413 too_large,
 *   503 membership_unavailable.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEYS } from '$lib/adminAuth';
import { checkMembership } from '$lib/membershipApi.server';
import { verifyNip98 } from '$lib/nip98.server';
import { authFailedResponse } from '$lib/scheduleApi.server';
import {
  LIVE_ACCESS_ALERT_THROTTLE_SECONDS,
  LIVE_ACCESS_NOTE_MAX,
  LIVE_TERMS_VERSION
} from '$lib/live/config';
import {
  countPendingRequests,
  createAccessRequest,
  ownRequestState
} from '$lib/live/access.server';
import { readBodyCapped } from '$lib/live/body.server';
import { liveKv, readLiveEnv } from '$lib/live/env.server';
import { buildAccessRequest, sendAdminDms } from '$lib/live/reportAlert.server';
import { getHostingMode } from '$lib/live/safety.server';
import { isHostApproved, type LiveDb } from '$lib/live/sessions.server';
import { hasAcceptedTerms } from '$lib/live/terms.server';
import { publishEventRaw } from '$lib/rawPublish';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 2048;
/** KV name of the access-request DM throttle; per environment via liveKv(). */
const ALERT_NAME = 'access-alert';

/** Printable text, newlines allowed, trimmed. Null when over the limit. */
function cleanNote(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  let out = '';
  for (const ch of value.trim()) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code < 0x20 && ch !== '\n') || code === 0x7f) continue;
    out += ch;
  }
  return [...out].length > LIVE_ACCESS_NOTE_MAX ? null : out;
}

export const GET: RequestHandler = async ({ request, platform }) => {
  const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
  if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
  const auth = await verifyNip98(request, {});
  if (!auth.ok) return authFailedResponse(auth.reason);
  const pubkey = auth.pubkey.toLowerCase();
  try {
    const mode = await getHostingMode(platform);
    const approved = mode === 'members' || (await isHostApproved(db, pubkey));
    const terms = {
      version: LIVE_TERMS_VERSION,
      accepted: await hasAcceptedTerms(db, pubkey, LIVE_TERMS_VERSION)
    };
    return json(
      { mode, approved, request: await ownRequestState(db, pubkey), terms },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error(`[Live] hosting status failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    const bytes = await readBodyCapped(request, MAX_BODY_BYTES);
    if (bytes === 'too_large') return json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
    if (bytes === 'unreadable') return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
    const auth = await verifyNip98(request, { bodyBytes: bytes });
    if (!auth.ok) return authFailedResponse(auth.reason);
    const pubkey = auth.pubkey.toLowerCase();

    let body: Record<string, unknown> = {};
    try {
      const text = new TextDecoder().decode(bytes);
      const parsed = text.trim() ? JSON.parse(text) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
      body = parsed;
    } catch {
      return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
    }
    const note = cleanNote(body.note);
    if (note === null) return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });

    if (await isHostApproved(db, pubkey)) {
      return json({ ok: true, approved: true }, { headers: NO_STORE });
    }

    // Only members can be approved to host; an outage is "try again".
    const apiSecret = readLiveEnv(platform, 'RELAY_API_SECRET');
    const enabled = readLiveEnv(platform, 'MEMBERSHIP_ENABLED')?.toLowerCase() === 'true';
    if (!enabled || !apiSecret) {
      return json({ error: 'membership_unavailable' }, { status: 503, headers: NO_STORE });
    }
    const membership = await checkMembership(pubkey, apiSecret);
    if (membership.state === 'unknown') {
      return json({ error: 'membership_unavailable' }, { status: 503, headers: NO_STORE });
    }
    if (membership.state !== 'active') {
      return json({ error: 'membership_required' }, { status: 403, headers: NO_STORE });
    }

    const saved = await createAccessRequest(db, { pubkey, note });
    if (!saved.ok) {
      return json(
        saved.reason === 'declined_recently'
          ? { error: saved.reason, retry_at: saved.retry_at }
          : { error: saved.reason },
        { status: 409, headers: NO_STORE }
      );
    }
    console.info('[Live] access request saved');

    // DM every admin, at most once per throttle window; the queue has every request.
    const kv = platform?.env?.GATED_CONTENT;
    let throttled = false;
    try {
      throttled = !!(kv && (await kv.get(liveKv(platform, ALERT_NAME), 'text')));
    } catch {
      /* a KV failure must not swallow the alert */
    }
    if (!throttled) {
      const alert = (async () => {
        const sent = await sendAdminDms(
          buildAccessRequest({
            pubkey,
            note,
            pending: await countPendingRequests(db),
            origin: new URL(request.url).origin
          }),
          {
            senderKey: readLiveEnv(platform, 'NOTIFICATION_PRIVATE_KEY'),
            recipientPubkeys: ADMIN_PUBKEYS,
            publish: publishEventRaw
          }
        );
        if (sent === 'sent') {
          try {
            await kv?.put(liveKv(platform, ALERT_NAME), '1', {
              expirationTtl: LIVE_ACCESS_ALERT_THROTTLE_SECONDS
            });
          } catch {
            /* worst case another DM goes out */
          }
        }
      })();
      if (platform?.ctx) platform.ctx.waitUntil(alert);
      else await alert;
    }
    return json({ ok: true, status: 'pending' }, { headers: NO_STORE });
  } catch (err) {
    console.error(`[Live] access request failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
