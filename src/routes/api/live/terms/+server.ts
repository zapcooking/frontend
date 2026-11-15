/**
 * Go live — the hosting agreement ("I'm 18+, agree and go live").
 *
 * POST /api/live/terms
 *   Auth: NIP-98 over this exact request; the signer is the one agreeing.
 *   Body: { version: string }   the LIVE_TERMS_VERSION the dialog showed
 *   Records (pubkey, version, time) in live_terms_acceptance. A repeat
 *   keeps the first time.
 *   200: { ok: true, version }
 *   400 bad_request, 401 auth_failed, 403 membership_required,
 *   409 terms_changed { version }   the terms moved on: show them again,
 *   413 too_large, 503 membership_unavailable.
 *
 * Only active members can record one (hosting is for members), so the
 * table cannot be filled by throwaway keys. Whether the signer has agreed
 * to the current version is part of GET /api/live/hosting, and the create
 * route (POST /api/live) refuses with terms_required until they have.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { checkMembership } from '$lib/membershipApi.server';
import { verifyNip98 } from '$lib/nip98.server';
import { authFailedResponse } from '$lib/scheduleApi.server';
import { LIVE_TERMS_VERSION } from '$lib/live/config';
import { readBodyCapped } from '$lib/live/body.server';
import { readLiveEnv } from '$lib/live/env.server';
import { nowSeconds, type LiveDb } from '$lib/live/sessions.server';
import { recordTermsAcceptance } from '$lib/live/terms.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 512;

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    const bytes = await readBodyCapped(request, MAX_BODY_BYTES);
    if (bytes === 'too_large')
      return json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
    if (bytes === 'unreadable')
      return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
    const auth = await verifyNip98(request, { bodyBytes: bytes });
    if (!auth.ok) return authFailedResponse(auth.reason);
    const pubkey = auth.pubkey.toLowerCase();

    let version: unknown;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
      version = (parsed as Record<string, unknown>).version;
    } catch {
      return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
    }
    if (typeof version !== 'string' || !version) {
      return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
    }
    if (version !== LIVE_TERMS_VERSION) {
      return json(
        { error: 'terms_changed', version: LIVE_TERMS_VERSION },
        { status: 409, headers: NO_STORE }
      );
    }

    // Tri-state membership: an outage is "try again", never "not a member".
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

    await recordTermsAcceptance(db, pubkey, LIVE_TERMS_VERSION, nowSeconds());
    console.info(`[Live] hosting terms accepted version=${LIVE_TERMS_VERSION}`);
    return json({ ok: true, version: LIVE_TERMS_VERSION }, { headers: NO_STORE });
  } catch (err) {
    console.error(`[Live] terms acceptance failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
