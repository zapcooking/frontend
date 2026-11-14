/**
 * Go live — admin kill switch.
 *
 * Auth for every call: NIP-98 signed by ADMIN_PUBKEY (the same gate as
 * /api/admin/promos and /api/admin/deletion-requests). Nothing else is
 * accepted: not a host token, not another member's signature.
 *
 * GET /api/admin/live
 *   200: { off: boolean, sessions: [...] }
 *     Sessions that have not ended, plus ended ones that still have an
 *     input waiting to be deleted. No input id, token or lock is included.
 *
 * POST /api/admin/live   { "action": "end", "id": "<session id>" }
 *   Ends that session and deletes its Cloudflare input.
 *   200: { id, status: 'ended', ended: boolean, input: 'none'|'deleted'|'pending' }
 *     `ended: false` means it had already ended; the delete is retried
 *     all the same. `input: 'pending'` means Cloudflare did not confirm
 *     the delete; the sweep retries it.
 *
 * POST /api/admin/live   { "action": "off", "on": true | false }
 *   on: true  sets the global off flag (create, publish and join then
 *             refuse) AND ends every open session, deleting its input.
 *   on: false clears the flag. Nothing is restarted.
 *   200: { off, flag_written, ended, inputs_pending }
 *     The flag can take up to about a minute to be seen everywhere (KV).
 *     Ending the open sessions takes effect at once.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { verifyNip98 } from '$lib/nip98.server';
import { endAllOpen, endAndRemove } from '$lib/live/admin.server';
import { readBodyCapped } from '$lib/live/body.server';
import { isLiveOff, setLiveOff } from '$lib/live/killSwitch.server';
import {
  getSession,
  isLiveSessionId,
  listSessionsForAdmin,
  type LiveDb
} from '$lib/live/sessions.server';
import { readStreamConfig } from '$lib/live/stream.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 1024;
const forbidden = () => json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });

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
      { off: await isLiveOff(platform), sessions: await listSessionsForAdmin(db, 100) },
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
  if (bodyBytes === 'unreadable') {
    return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
  }
  const auth = await verifyNip98(request, { expectedPubkey: ADMIN_PUBKEY, bodyBytes });
  if (!auth.ok) {
    console.warn(`[Live admin] NIP-98 rejected (${auth.reason}) on POST`);
    return forbidden();
  }

  const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
  if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bodyBytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
  }

  try {
    const cfg = readStreamConfig(platform);

    if (body.action === 'end') {
      if (!isLiveSessionId(body.id)) {
        return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
      }
      if (!(await getSession(db, body.id))) {
        return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
      }
      const outcome = await endAndRemove(db, cfg, body.id, 'admin');
      console.log(
        `[Live admin] end session=${body.id} ended=${outcome.ended} input=${outcome.input}`
      );
      return json({ id: body.id, status: 'ended', ...outcome }, { headers: NO_STORE });
    }

    if (body.action === 'off') {
      if (typeof body.on !== 'boolean') {
        return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
      }
      const flagWritten = await setLiveOff(platform, body.on);
      let ended = 0;
      let inputsPending = 0;
      if (body.on) ({ ended, inputsPending } = await endAllOpen(db, cfg, 'admin'));
      console.log(
        `[Live admin] off=${body.on} flag_written=${flagWritten} ended=${ended} inputs_pending=${inputsPending}`
      );
      return json(
        { off: body.on, flag_written: flagWritten, ended, inputs_pending: inputsPending },
        { headers: NO_STORE }
      );
    }

    return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
  } catch (err) {
    console.error(`[Live admin] action failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
