/**
 * Go live — create a session.
 *
 * POST /api/live
 *   Auth: NIP-98 (the signer is the host; there is no pubkey in the body).
 *   Body: { title: string, recipe_a?: string }
 *     recipe_a is the attached recipe's address, '<kind>:<pubkey>:<d>'.
 *     It may be the host's own recipe or another cook's.
 *   201: { id, status: 'created', host_token }
 *     host_token is returned exactly once. It authorizes publish and End
 *     for this session, is stored only as a hash, and stops working when
 *     the session ends. Send it as `Authorization: Bearer <host_token>`.
 *
 * This route makes no Cloudflare Stream call: the live input is created
 * when the host publishes.
 *
 * Checks, in order, fail-fast:
 *   database bound                         → 500 not_configured
 *   Go live switched off (admin)           → 503 live_off
 *   body over 4 KB (enforced while reading) → 413 too_large
 *   NIP-98                                 → 401 auth_failed (coarse; reason logged only)
 *   body shape, title, recipe address      → 400 bad_request | bad_title | bad_recipe
 *   signer is on the host list             → 403 not_allowed
 *   membership could not be checked        → 503 membership_unavailable
 *   signer is not an active member         → 403 membership_required
 *   host already has a session not ended   → 409 already_active (with its id)
 *   create rate limit (atomic with insert) → 429 rate_limited
 *
 * A membership outage is never reported as "not a member": `unknown`
 * from the tri-state check is a 503, and only a real `inactive` is a 403.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { verifyNip98 } from '$lib/nip98.server';
import { authFailedResponse } from '$lib/scheduleApi.server';
import { checkMembership } from '$lib/membershipApi.server';
import { isLiveHost } from '$lib/live/config';
import { readBodyCapped } from '$lib/live/body.server';
import { readLiveEnv } from '$lib/live/env.server';
import { isLiveOff } from '$lib/live/killSwitch.server';
import {
  createSession,
  getActiveSessionForHost,
  parseRecipeAddress,
  parseTitle,
  type LiveDb
} from '$lib/live/sessions.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 4 * 1024;

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) {
      console.error('[Live] SCHEDULER_DB not configured');
      return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    }

    // Global off switch. Checked before anything is read.
    if (await isLiveOff(platform)) {
      return json({ error: 'live_off' }, { status: 503, headers: NO_STORE });
    }

    // Size cap FIRST, and enforced while the body is read: nothing over
    // the cap is ever buffered, hashed or parsed, signed or not. The same
    // bytes then feed the NIP-98 payload-hash check and the JSON parse.
    const bodyBytes = await readBodyCapped(request, MAX_BODY_BYTES);
    if (bodyBytes === 'too_large') {
      return json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
    }
    if (bodyBytes === 'unreadable') {
      return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
    }

    const auth = await verifyNip98(request, { bodyBytes });
    if (!auth.ok) {
      console.warn(`[Live] NIP-98 rejected (${auth.reason}) on create`);
      return authFailedResponse(auth.reason);
    }
    const hostPubkey = auth.pubkey.toLowerCase();

    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bodyBytes));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
    }

    const title = parseTitle(body.title);
    if (!title) return json({ error: 'bad_title' }, { status: 400, headers: NO_STORE });

    const recipeA = parseRecipeAddress(body.recipe_a);
    if (recipeA === 'invalid') {
      return json({ error: 'bad_recipe' }, { status: 400, headers: NO_STORE });
    }

    if (!isLiveHost(hostPubkey)) {
      return json({ error: 'not_allowed' }, { status: 403, headers: NO_STORE });
    }

    // Tri-state membership. The boolean helper reads an outage as "not a
    // member"; this route must not.
    const membershipEnabled = readLiveEnv(platform, 'MEMBERSHIP_ENABLED')?.toLowerCase() === 'true';
    const apiSecret = readLiveEnv(platform, 'RELAY_API_SECRET');
    if (!membershipEnabled || !apiSecret) {
      console.error('[Live] membership check not configured');
      return json({ error: 'membership_unavailable' }, { status: 503, headers: NO_STORE });
    }
    const membership = await checkMembership(hostPubkey, apiSecret);
    if (membership.state === 'unknown') {
      console.warn(`[Live] membership unknown on create (${membership.reason})`);
      return json({ error: 'membership_unavailable' }, { status: 503, headers: NO_STORE });
    }
    if (membership.state !== 'active') {
      return json({ error: 'membership_required' }, { status: 403, headers: NO_STORE });
    }

    const existing = await getActiveSessionForHost(db, hostPubkey);
    if (existing) {
      return json({ error: 'already_active', id: existing.id }, { status: 409, headers: NO_STORE });
    }

    const created = await createSession(db, { hostPubkey, title, recipeA });
    if (!created.ok) {
      if (created.reason === 'rate_limited') {
        return json({ error: 'rate_limited' }, { status: 429, headers: NO_STORE });
      }
      // Lost a race with a simultaneous create from the same host.
      const winner = await getActiveSessionForHost(db, hostPubkey);
      return json(
        { error: 'already_active', ...(winner ? { id: winner.id } : {}) },
        { status: 409, headers: NO_STORE }
      );
    }

    return json(
      { id: created.session.id, status: created.session.status, host_token: created.hostToken },
      { status: 201, headers: NO_STORE }
    );
  } catch (err) {
    console.error('[Live] create failed:', err);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
