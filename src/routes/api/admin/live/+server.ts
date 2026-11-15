/**
 * Go live — admin controls (/admin/live).
 *
 * Auth for every call: NIP-98 signed by ADMIN_PUBKEY (the same gate as
 * /api/admin/promos and /api/admin/deletion-requests). Nothing else is
 * accepted: not a host token, not another member's signature.
 *
 * Every POST action is written to the action log (live_actions) with its
 * time and the signer as actor. The reply carries `logged: false` if that
 * write failed (the action itself has happened).
 *
 * GET /api/admin/live
 *   200: { off, mode, mode_set, sessions, approved, requests, blocked, incidents, actions }
 *     mode       the hosting mode as KV reads it here (can lag ~1 min after a switch)
 *     mode_set   the mode last switched to, from the action log (null = never)
 *     sessions   open ones, ended ones whose input is not confirmed
 *                deleted, and every one under an open report hold (no
 *                input id, token or lock)
 *     approved   the approved-hosts list   blocked   the blocked list
 *     requests   pending access requests, oldest first, each with the
 *                requester's membership: 'active' | 'inactive' | 'unknown'
 *     incidents  report holds with their reports (never a reporter hash)
 *     actions    the latest 100 entries of the action log
 *
 * POST /api/admin/live — body { action, ... }:
 *   end      { id }       end the session, delete its Cloudflare input
 *   off      { on }       on: switch Go live off for everyone and end every
 *                         open session; off: clear the flag (KV, ~1 min)
 *   mode     { mode }     'approved' (approved list only) | 'members'
 *                         (any active member). KV, ~1 min to apply.
 *   approve  { pubkey }   add to the approved-hosts list
 *              (also closes the account's pending request as approved)
 *   approve_request { id }  approve a pending access request: the account
 *                         is added to the approved list (logged 'approve')
 *   decline_request { id }  decline it (logged 'decline'); the account may
 *                         ask again 30 days later
 *   unapprove{ pubkey }   remove from it. A running stream is not ended
 *                         (use block for that); the next create is refused.
 *   block    { pubkey }   block from hosting in every mode, then end the
 *                         account's open session and delete the input
 *   unblock  { pubkey }   remove the block. Nothing is restarted.
 *   release  { id }       release the session's report hold (also accepted
 *                         as 'release_hold'). The 30-day rule then applies
 *                         once the session's reports age out (90 days).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { verifyNip98 } from '$lib/nip98.server';
import { blockHost, endAllOpen, endAndRemove } from '$lib/live/admin.server';
import { checkMembership } from '$lib/membershipApi.server';
import {
  decideRequest,
  listPendingRequests,
  resolvePendingAsApproved
} from '$lib/live/access.server';
import { readBodyCapped } from '$lib/live/body.server';
import { readLiveEnv } from '$lib/live/env.server';
import { isLiveOff, setLiveOff } from '$lib/live/killSwitch.server';
import {
  getHostingMode,
  lastModeSet,
  listActions,
  listIncidents,
  logAction,
  releaseHold,
  setHostingMode
} from '$lib/live/safety.server';
import {
  getSession,
  isLiveSessionId,
  listApprovedHosts,
  listBlockedHosts,
  listSessionsForAdmin,
  setHostApproved,
  setHostBlocked,
  type LiveDb
} from '$lib/live/sessions.server';
import { readStreamConfig } from '$lib/live/stream.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 1024;
const HEX64_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const forbidden = () => json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
const bad = () => json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });

const readPubkey = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const pk = value.trim().toLowerCase();
  return HEX64_RE.test(pk) ? pk : null;
};

/** Pending requests with each requester's membership (tri-state; 'unknown' on any failure). */
async function pendingWithMembership(platform: Readonly<App.Platform> | undefined, db: LiveDb) {
  const rows = await listPendingRequests(db, 100);
  const apiSecret = readLiveEnv(platform, 'RELAY_API_SECRET');
  const enabled = readLiveEnv(platform, 'MEMBERSHIP_ENABLED')?.toLowerCase() === 'true';
  return Promise.all(
    rows.map(async (r) => {
      let membership: 'active' | 'inactive' | 'unknown' = 'unknown';
      if (enabled && apiSecret) {
        try {
          membership = (await checkMembership(r.pubkey, apiSecret)).state;
        } catch {
          /* stays unknown */
        }
      }
      return { ...r, membership };
    })
  );
}

export const GET: RequestHandler = async ({ request, platform }) => {
  const auth = await verifyNip98(request, { expectedPubkey: ADMIN_PUBKEY });
  if (!auth.ok) {
    console.warn(`[Live admin] NIP-98 rejected (${auth.reason}) on GET`);
    return forbidden();
  }
  const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
  if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
  try {
    return json(
      {
        off: await isLiveOff(platform),
        mode: await getHostingMode(platform),
        mode_set: await lastModeSet(db),
        sessions: await listSessionsForAdmin(db, 100),
        approved: await listApprovedHosts(db),
        requests: await pendingWithMembership(platform, db),
        blocked: await listBlockedHosts(db),
        incidents: await listIncidents(db),
        actions: await listActions(db, 100)
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error(`[Live admin] list failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};

export const POST: RequestHandler = async ({ request, platform }) => {
  // Small cap, enforced while reading, before any signature work.
  const bodyBytes = await readBodyCapped(request, MAX_BODY_BYTES);
  if (bodyBytes === 'too_large') {
    return json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
  }
  if (bodyBytes === 'unreadable') return bad();
  const auth = await verifyNip98(request, { expectedPubkey: ADMIN_PUBKEY, bodyBytes });
  if (!auth.ok) {
    console.warn(`[Live admin] NIP-98 rejected (${auth.reason}) on POST`);
    return forbidden();
  }
  const actor = auth.pubkey.toLowerCase();

  const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
  if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bodyBytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    body = parsed as Record<string, unknown>;
  } catch {
    return bad();
  }

  try {
    const cfg = readStreamConfig(platform);
    const reply = (data: Record<string, unknown>, logged: boolean) =>
      json(logged ? data : { ...data, logged: false }, { headers: NO_STORE });

    switch (body.action) {
      case 'end': {
        if (!isLiveSessionId(body.id)) return bad();
        const session = await getSession(db, body.id);
        if (!session) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
        const outcome = await endAndRemove(db, cfg, body.id, 'admin');
        console.log(`[Live admin] end session=${body.id} ended=${outcome.ended} input=${outcome.input}`);
        const logged = await logAction(db, {
          actor,
          action: 'end',
          sessionId: body.id,
          targetPubkey: session.host_pubkey,
          detail: outcome.ended ? '' : 'already ended; input delete retried'
        });
        return reply({ id: body.id, status: 'ended', ...outcome }, logged);
      }

      case 'off': {
        if (typeof body.on !== 'boolean') return bad();
        const flagWritten = await setLiveOff(platform, body.on);
        let ended = 0;
        let inputsPending = 0;
        if (body.on) ({ ended, inputsPending } = await endAllOpen(db, cfg, 'admin'));
        console.log(
          `[Live admin] off=${body.on} flag_written=${flagWritten} ended=${ended} inputs_pending=${inputsPending}`
        );
        const logged = await logAction(db, {
          actor,
          action: 'off',
          detail: `${body.on ? 'switched off' : 'switched on'}; ended ${ended}${flagWritten ? '' : '; flag NOT written'}`
        });
        return reply(
          { off: body.on, flag_written: flagWritten, ended, inputs_pending: inputsPending },
          logged
        );
      }

      case 'mode': {
        if (body.mode !== 'approved' && body.mode !== 'members') return bad();
        const before = await getHostingMode(platform);
        const written = await setHostingMode(platform, body.mode);
        if (!written) {
          return json({ error: 'not_written' }, { status: 503, headers: NO_STORE });
        }
        console.log(`[Live admin] mode ${before} -> ${body.mode}`);
        const logged = await logAction(db, {
          actor,
          action: 'mode',
          detail: `${before} -> ${body.mode}`
        });
        return reply({ mode: body.mode }, logged);
      }

      case 'approve':
      case 'unapprove': {
        const pubkey = readPubkey(body.pubkey);
        if (!pubkey) return bad();
        const approve = body.action === 'approve';
        const changed = await setHostApproved(db, pubkey, approve, actor);
        if (approve) await resolvePendingAsApproved(db, pubkey);
        console.log(`[Live admin] ${body.action} host=${pubkey} changed=${changed}`);
        const logged = await logAction(db, {
          actor,
          action: approve ? 'approve' : 'unapprove',
          targetPubkey: pubkey,
          detail: changed ? '' : approve ? 'already approved' : 'was not approved'
        });
        return reply({ pubkey, approved: approve, changed }, logged);
      }

      case 'approve_request':
      case 'decline_request': {
        if (typeof body.id !== 'string' || !UUID_RE.test(body.id)) return bad();
        const approve = body.action === 'approve_request';
        const row = await decideRequest(db, body.id, approve ? 'approved' : 'declined', actor);
        if (!row) return json({ error: 'not_pending' }, { status: 409, headers: NO_STORE });
        console.log(`[Live admin] ${body.action} host=${row.pubkey}`);
        const logged = await logAction(db, {
          actor,
          action: approve ? 'approve' : 'decline',
          targetPubkey: row.pubkey,
          detail: 'access request'
        });
        return reply({ id: body.id, pubkey: row.pubkey, status: row.status }, logged);
      }

      case 'block':
      case 'unblock': {
        const pubkey = readPubkey(body.pubkey);
        if (!pubkey) return bad();
        if (body.action === 'unblock') {
          await setHostBlocked(db, pubkey, false);
          console.log(`[Live admin] unblock host=${pubkey}`);
          const logged = await logAction(db, { actor, action: 'unblock', targetPubkey: pubkey });
          return reply({ pubkey, blocked: false }, logged);
        }
        const { ended, inputsPending } = await blockHost(db, cfg, pubkey);
        console.log(`[Live admin] block host=${pubkey} ended=${ended} inputs_pending=${inputsPending}`);
        const logged = await logAction(db, {
          actor,
          action: 'block',
          targetPubkey: pubkey,
          detail: `ended ${ended} open session${ended === 1 ? '' : 's'}`
        });
        return reply({ pubkey, blocked: true, ended, inputs_pending: inputsPending }, logged);
      }

      case 'release':
      case 'release_hold': {
        if (!isLiveSessionId(body.id)) return bad();
        const released = await releaseHold(db, body.id, actor);
        console.log(`[Live admin] release session=${body.id} released=${released}`);
        const logged = await logAction(db, {
          actor,
          action: 'release_hold',
          sessionId: body.id,
          detail: released ? '' : 'no open hold'
        });
        return reply({ id: body.id, released }, logged);
      }

      default:
        return bad();
    }
  } catch (err) {
    console.error(`[Live admin] action failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
