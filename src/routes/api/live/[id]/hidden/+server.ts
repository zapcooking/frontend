/**
 * Go live — commenters hidden from a stream's chat.
 *
 * GET /api/live/<id>/hidden
 *   No auth. The commenters left out of this session's chat:
 *   { hidden: [{ pubkey, scope: 'host' | 'global' }] }
 *   'host' = hidden by this session's host (in all their streams);
 *   'global' = hidden by the admin in every Go live chat.
 *
 * POST /api/live/<id>/hidden
 *   Auth: NIP-98 over this exact request (URL, method and body).
 *   Body: JSON { pubkey: <64 hex>, hidden: boolean, scope?: 'host' | 'global' }
 *   scope 'host' (default): the session's host, or the admin, hides or
 *     unhides in the HOST's list.
 *   scope 'global': the admin only.
 *   200: { pubkey, hidden, scope }
 *
 * Only commenters' public keys are stored; nothing about viewers. The
 * host's own private mute list is separate and keeps applying to what the
 * host sees.
 *
 * Replies:
 *   400 bad_request   body not JSON, bad pubkey, hiding the host themself
 *   401 auth_failed   no or bad NIP-98
 *   403 forbidden     not the host (host scope) / not the admin (global)
 *   404 not_found     unknown session
 *   409 full          the list is at its maximum
 *   413 too_large     body over 1 KB
 *   500 not_configured
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { verifyNip98 } from '$lib/nip98.server';
import { authFailedResponse } from '$lib/scheduleApi.server';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { readBodyCapped } from '$lib/live/body.server';
import {
  getSession,
  HIDDEN_GLOBAL_SCOPE,
  listHiddenForHost,
  setHiddenAuthor,
  type LiveDb
} from '$lib/live/sessions.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 1024;
const HEX64 = /^[0-9a-f]{64}$/;

function dbOf(platform: Readonly<App.Platform> | undefined): LiveDb | undefined {
  return platform?.env?.SCHEDULER_DB as LiveDb | undefined;
}

export const GET: RequestHandler = async ({ params, platform }) => {
  try {
    const db = dbOf(platform);
    if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    const row = await getSession(db, params.id ?? '');
    if (!row) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
    return json({ hidden: await listHiddenForHost(db, row.host_pubkey) }, { headers: NO_STORE });
  } catch (err) {
    console.error(`[Live] hidden read failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};

export const POST: RequestHandler = async ({ request, params, platform }) => {
  try {
    const db = dbOf(platform);
    if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    const row = await getSession(db, params.id ?? '');
    if (!row) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });

    const body = await readBodyCapped(request, MAX_BODY_BYTES);
    if (body === 'too_large') {
      return json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
    }
    if (body === 'unreadable') {
      return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
    }
    const auth = await verifyNip98(request, { bodyBytes: body });
    if (!auth.ok) {
      console.warn(`[Live] NIP-98 rejected (${auth.reason}) on hidden`);
      return authFailedResponse(auth.reason);
    }
    const signer = auth.pubkey.toLowerCase();

    let input: { pubkey?: unknown; hidden?: unknown; scope?: unknown } = {};
    try {
      input = JSON.parse(new TextDecoder().decode(body)) ?? {};
    } catch {
      return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
    }
    const pubkey = typeof input.pubkey === 'string' ? input.pubkey : '';
    const scope = input.scope === undefined ? 'host' : input.scope;
    if (
      !HEX64.test(pubkey) ||
      typeof input.hidden !== 'boolean' ||
      (scope !== 'host' && scope !== 'global') ||
      (input.hidden && (pubkey === row.host_pubkey || pubkey === ADMIN_PUBKEY))
    ) {
      return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
    }

    const isAdmin = signer === ADMIN_PUBKEY;
    if (scope === 'global' ? !isAdmin : !(isAdmin || signer === row.host_pubkey)) {
      return json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
    }

    const key = scope === 'global' ? HIDDEN_GLOBAL_SCOPE : row.host_pubkey;
    if ((await setHiddenAuthor(db, key, pubkey, input.hidden)) === 'full') {
      return json({ error: 'full' }, { status: 409, headers: NO_STORE });
    }
    return json({ pubkey, hidden: input.hidden, scope }, { headers: NO_STORE });
  } catch (err) {
    console.error(`[Live] hidden write failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
