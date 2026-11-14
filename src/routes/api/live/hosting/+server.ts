/**
 * Go live — staged rollout: can this account host, and asking for access.
 *
 * GET /api/live/hosting?pubkey=<64 hex>
 *   No auth. { mode: 'approved' | 'members', approved: boolean }
 *   `approved` is true in 'members' mode, and in 'approved' mode when the
 *   account is on the approved-hosts list. It decides what the host page
 *   SHOWS ("Live hosting is rolling out"); the create route enforces the
 *   same rule. Blocks and suspensions are not disclosed here.
 *
 * POST /api/live/hosting   (Request access)
 *   Auth: NIP-98 over this exact request; the signer is the requester.
 *   Body: { name?: string, nip05?: string }  as the requester's client read
 *     them from their own profile; shown to the admin as such, unverified.
 *   DMs the admin the request with the account's npub and profile link.
 *   No queue is kept. One request per account per day.
 *   200: { ok: true }   sent, or the account is already approved
 *        ({ ok: true, approved: true }, nothing sent)
 *   401 auth_failed, 403 membership_required, 409 already_requested,
 *   413 too_large, 400 bad_request, 503 membership_unavailable.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { checkMembership } from '$lib/membershipApi.server';
import { verifyNip98 } from '$lib/nip98.server';
import { authFailedResponse } from '$lib/scheduleApi.server';
import { LIVE_ACCESS_REQUEST_THROTTLE_SECONDS } from '$lib/live/config';
import { readBodyCapped } from '$lib/live/body.server';
import { readLiveEnv } from '$lib/live/env.server';
import { buildAccessRequest, sendAdminDm } from '$lib/live/reportAlert.server';
import { getHostingMode } from '$lib/live/safety.server';
import { isHostApproved, type LiveDb } from '$lib/live/sessions.server';
import { publishEventRaw } from '$lib/rawPublish';

const NO_STORE = { 'Cache-Control': 'no-store' };
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_BODY_BYTES = 1024;
const ACCESS_REQUEST_PREFIX = 'live:access:';

/** Printable text only, trimmed and capped: it ends up in a DM. */
function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value.trim()) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }
  return out.slice(0, max);
}

export const GET: RequestHandler = async ({ url, platform }) => {
  const pubkey = (url.searchParams.get('pubkey') ?? '').toLowerCase();
  if (!HEX64.test(pubkey)) return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
  const db = platform?.env?.SCHEDULER_DB as LiveDb | undefined;
  if (!db) return json({ error: 'not_configured' }, { status: 500, headers: NO_STORE });
  try {
    const mode = await getHostingMode(platform);
    const approved = mode === 'members' || (await isHostApproved(db, pubkey));
    return json({ mode, approved }, { headers: NO_STORE });
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
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
    } catch {
      return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
    }

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

    const kv = platform?.env?.GATED_CONTENT;
    const throttleKey = ACCESS_REQUEST_PREFIX + pubkey;
    try {
      if (kv && (await kv.get(throttleKey, 'text'))) {
        return json({ error: 'already_requested' }, { status: 409, headers: NO_STORE });
      }
    } catch {
      /* a KV failure must not block the request */
    }

    const sent = await sendAdminDm(
      buildAccessRequest({
        pubkey,
        name: clean(body.name, 80),
        nip05: clean(body.nip05, 120),
        origin: new URL(request.url).origin
      }),
      {
        senderKey: readLiveEnv(platform, 'NOTIFICATION_PRIVATE_KEY'),
        recipientPubkey: ADMIN_PUBKEY,
        publish: publishEventRaw
      }
    );
    if (sent !== 'sent') {
      return json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
    }
    try {
      await kv?.put(throttleKey, '1', { expirationTtl: LIVE_ACCESS_REQUEST_THROTTLE_SECONDS });
    } catch {
      /* worst case a second request goes through */
    }
    console.info('[Live] access request sent');
    return json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error(`[Live] access request failed: ${(err as Error)?.name ?? 'error'}`);
    return json({ error: 'internal' }, { status: 500, headers: NO_STORE });
  }
};
