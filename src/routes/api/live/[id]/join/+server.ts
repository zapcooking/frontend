/**
 * Go live — play relay and guest cap.
 *
 * POST /api/live/<id>/join
 *   Auth: none needed. Anyone can watch.
 *         Optional `Authorization: Nostr <NIP-98>` signed over this exact
 *         request (URL, method and the SDP body): a confirmed ACTIVE
 *         MEMBER is admitted without using a guest slot.
 *   Body: the browser's SDP offer, Content-Type: application/sdp
 *   201:  the SDP answer, Content-Type: application/sdp
 *
 * The viewer's browser never holds a Cloudflare URL: this route relays
 * the offer to the session's play address and returns the status and the
 * SDP answer ONLY. Cloudflare's Location header (it contains the input
 * id, which is all anyone needs to play), ETag and Link are never
 * forwarded, and neither they, the play address nor any SDP is logged.
 *
 * Guest cap. Everyone who is not a confirmed active member is a guest:
 * no signature, a bad signature, a non-member, and a member whose
 * membership could not be checked right now. Guests are admitted until
 * the session has had LIVE_GUEST_CAP guest joins (default 200), counted
 * per session with one conditional update. A guest turned away gets 403
 * `full` and is counted in a per-session refusal total.
 *
 * Rejoin pass. Every viewer admitted gets a short-lived pass in the
 * `Live-Pass` response header (when LIVE_PASS_SECRET is set). Presenting
 * it on a later join for the same session admits them without taking a
 * new guest slot, so a guest can get back in after the host reconnects
 * even at a full cap. See $lib/live/pass.server.
 *
 * A pass can be copied, so pass rejoins have a per-session ceiling: 3x
 * the guest cap, counted in one more integer on the session row
 * (pass_rejoins). Past it a pass is not honoured and the viewer is
 * treated as a new guest (a member who signed is still a member).
 *
 * NOTHING about a viewer is stored: no address, no key, no session
 * handle. The cap and the pass ceiling are integers on the session row. A viewer leaving
 * is therefore not detected, and a guest who reloads uses another slot.
 *
 * Replies:
 *   201                          watching; body is the SDP answer
 *   400 bad_offer                empty body, or not SDP
 *   403 full                     the guest cap is reached
 *   404 not_found                unknown or malformed id
 *   409 not_live *               the session is not broadcasting right now
 *                                (not started, or the host is reconnecting)
 *   410 ended                    the session has ended
 *   413 too_large                offer over the size cap
 *   415 unsupported_media_type   Content-Type is not application/sdp
 *   422 offer_rejected           Cloudflare refused this offer
 *   503 stream_unavailable *     Cloudflare failed or did not answer
 *   503 live_off                 Go live is switched off (admin). No retry flag.
 *   500 not_configured           the database is not bound
 * Replies marked * mean "try again": they carry `retry: true` and a
 * Retry-After header.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { verifyNip98 } from '$lib/nip98.server';
import { checkMembership } from '$lib/membershipApi.server';
import {
  LIVE_OFFER_MAX_BYTES,
  LIVE_RETRY_AFTER_SECONDS,
  parseGuestCap,
  passRejoinCeiling
} from '$lib/live/config';
import { readBodyCapped } from '$lib/live/body.server';
import { readLiveEnv } from '$lib/live/env.server';
import { issuePass, LIVE_PASS_HEADER, verifyPass } from '$lib/live/pass.server';
import { isLiveOff } from '$lib/live/killSwitch.server';
import {
  countCapRefusal,
  getRelayState,
  returnGuestSlot,
  returnPassRejoin,
  takeGuestSlot,
  takePassRejoin,
  type LiveDb
} from '$lib/live/sessions.server';
import { relayOffer } from '$lib/live/stream.server';

const NO_STORE = { 'Cache-Control': 'no-store' };
const RETRY = { ...NO_STORE, 'Retry-After': String(LIVE_RETRY_AFTER_SECONDS) };

const tryAgain = (error: string, status: number) =>
  json({ error, retry: true }, { status, headers: RETRY });

/**
 * True only for a request that carries a valid NIP-98 signature over
 * these exact bytes, from a pubkey the membership service confirms as
 * active right now. Every other outcome, including "could not check",
 * is false: the viewer is then a guest. Never throws.
 */
async function isConfirmedMember(
  request: Request,
  bodyBytes: Uint8Array,
  platform: Readonly<App.Platform> | undefined
): Promise<boolean> {
  if (!(request.headers.get('Authorization') ?? '').startsWith('Nostr ')) return false;
  try {
    const auth = await verifyNip98(request, { bodyBytes });
    if (!auth.ok) return false;
    const enabled = readLiveEnv(platform, 'MEMBERSHIP_ENABLED')?.toLowerCase() === 'true';
    const apiSecret = readLiveEnv(platform, 'RELAY_API_SECRET');
    if (!enabled || !apiSecret) return false;
    const membership = await checkMembership(auth.pubkey.toLowerCase(), apiSecret);
    return membership.state === 'active';
  } catch {
    return false;
  }
}

export const POST: RequestHandler = async ({ request, params, platform }) => {
  try {
    const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
    if (!db) {
      console.error('[Live] SCHEDULER_DB not configured');
      return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
    }

    // Global off switch: nobody joins while it is set.
    if (await isLiveOff(platform)) {
      return json({ error: 'live_off' }, { status: 503, headers: NO_STORE });
    }

    const id = params.id ?? '';
    const state = await getRelayState(db, id);
    if (!state) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
    if (state.status === 'ended') {
      return json({ error: 'ended' }, { status: 410, headers: NO_STORE });
    }
    if (state.status !== 'live' || !state.cf_play_url) return tryAgain('not_live', 409);

    const contentType = (request.headers.get('Content-Type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/sdp') {
      return json({ error: 'unsupported_media_type' }, { status: 415, headers: NO_STORE });
    }

    const offer = await readBodyCapped(request, LIVE_OFFER_MAX_BYTES);
    if (offer === 'too_large') {
      return json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
    }
    if (offer === 'unreadable' || offer.length < 4) {
      return json({ error: 'bad_offer' }, { status: 400, headers: NO_STORE });
    }
    // Every SDP description starts with the version line "v=0".
    if (!(offer[0] === 0x76 && offer[1] === 0x3d && offer[2] === 0x30)) {
      return json({ error: 'bad_offer' }, { status: 400, headers: NO_STORE });
    }

    // Member or guest. The answer is used for this decision only and is
    // not stored anywhere.
    const passSecret = readLiveEnv(platform, 'LIVE_PASS_SECRET');
    const cap = parseGuestCap(readLiveEnv(platform, 'LIVE_GUEST_CAP'));
    // A viewer who was admitted before (and is rejoining after the host
    // reconnected, or after a dropped connection) carries a pass. A valid
    // pass for this session admits them without another guest slot, while
    // the session is under its pass-rejoin ceiling. Past the ceiling the
    // pass is ignored and the viewer goes through the guest cap like a new
    // one.
    const passValid =
      !!passSecret && (await verifyPass(passSecret, id, request.headers.get(LIVE_PASS_HEADER)));
    const passHolder = passValid && (await takePassRejoin(db, id, passRejoinCeiling(cap)));
    // Only ask about membership when the pass does not already settle it:
    // a signed member join is checked against the membership service.
    const member = !passHolder && (await isConfirmedMember(request, offer, platform));
    let slotTaken = false;
    if (!member && !passHolder) {
      if (!(await takeGuestSlot(db, id, cap))) {
        // No slot: either the cap is reached, or the session stopped
        // being live between the read above and now.
        const now = await getRelayState(db, id);
        if (!now) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
        if (now.status === 'ended') {
          return json({ error: 'ended' }, { status: 410, headers: NO_STORE });
        }
        if (now.status !== 'live') return tryAgain('not_live', 409);
        await countCapRefusal(db, id);
        return json({ error: 'full' }, { status: 403, headers: NO_STORE });
      }
      slotTaken = true;
    }

    const relayed = await relayOffer(state.cf_play_url, offer, 'play');
    if (relayed.ok) {
      // Status and SDP only. No header from Cloudflare is copied. Our own
      // rejoin pass goes along when the pass secret is configured.
      const headers: Record<string, string> = { 'Content-Type': 'application/sdp', ...NO_STORE };
      if (passSecret) headers[LIVE_PASS_HEADER] = await issuePass(passSecret, id);
      return new Response(relayed.answer, { status: 201, headers });
    }

    // The viewer did not get in: the slot, or the pass rejoin, goes back.
    if (slotTaken) await returnGuestSlot(db, id);
    if (passHolder) await returnPassRejoin(db, id);

    // Cloudflare answers 409 while a broadcast has not started (or its
    // input was just replaced by a reconnect) and 404 once the input is
    // gone. Both mean "not broadcasting right now"; say what the session
    // itself now says.
    if (relayed.reason === 'rejected' && (relayed.status === 409 || relayed.status === 404)) {
      const now = await getRelayState(db, id);
      if (now?.status === 'ended') {
        return json({ error: 'ended' }, { status: 410, headers: NO_STORE });
      }
      return tryAgain('not_live', 409);
    }
    if (relayed.reason === 'rejected') {
      return json({ error: 'offer_rejected' }, { status: 422, headers: NO_STORE });
    }
    return tryAgain('stream_unavailable', 503);
  } catch (err) {
    // Name only: an error message could quote a URL or part of a body.
    console.error(`[Live] join failed: ${(err as Error)?.name ?? 'error'}`);
    return tryAgain('stream_unavailable', 503);
  }
};
