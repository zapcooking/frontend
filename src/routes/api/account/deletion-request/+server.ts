/**
 * Account deletion request.
 *
 * POST /api/account/deletion-request
 *   Body: { source?: 'web' | 'ios' | 'android' }   (send `{}` if nothing)
 *   Records a deletion request for the pubkey that signed the NIP-98
 *   header, stops Stripe renewal and deletes scheduled posts at once
 *   (see $lib/accountDeletion.server), and leaves the rest for staff.
 *   Idempotent while pending: a repeat folds into the same row.
 *   → 202 { status: 'pending', requested_at, billing, scheduled_posts_removed }
 *   requested_at is the FIRST pending request's time — the 30-day clock.
 *
 * GET /api/account/deletion-request
 *   The caller's own request, or 404 { error: 'not_found' }.
 *
 * Identity is the NIP-98 signer and nothing else — there is no pubkey
 * in the body to disagree with it. A pubkey is public on Nostr, so
 * accepting one as a field would let anyone file deletion (and cancel
 * billing) for anyone. This is the endpoint /delete-account's button
 * and the mobile apps' in-app deletion call, so App Store Guideline
 * 5.1.1(v) is satisfied without the member ever writing an email.
 *
 * Auth failures return the same coarse 401 as /api/schedule.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifyNip98 } from '$lib/nip98.server';
import { authFailedResponse } from '$lib/scheduleApi.server';
import {
  cancelStripeRenewal,
  getDeletionRequest,
  parseDeletionSource,
  purgeScheduledPosts,
  upsertDeletionRequest
} from '$lib/accountDeletion.server';

export const POST: RequestHandler = async ({ request, platform }) => {
  const db = platform?.env?.SCHEDULER_DB;
  if (!db) {
    console.error('[Account Deletion] SCHEDULER_DB not configured');
    return json({ error: 'not_configured' }, { status: 500 });
  }

  // Body read ONCE — the same bytes feed the payload-hash check and the parse.
  let bodyBytes: Uint8Array;
  try {
    bodyBytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return json({ error: 'bad_request' }, { status: 400 });
  }

  const auth = await verifyNip98(request, { bodyBytes });
  if (!auth.ok) {
    console.warn(`[Account Deletion] NIP-98 rejected (${auth.reason}) on POST`);
    return authFailedResponse(auth.reason);
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return json({ error: 'bad_request' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'bad_request' }, { status: 400 });
  }

  const pubkey = auth.pubkey.toLowerCase();
  const source = parseDeletionSource((body as { source?: unknown }).source);

  try {
    const stripeKey = platform?.env?.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY;
    const billing = await cancelStripeRenewal(pubkey, stripeKey);
    const scheduledPostsRemoved = await purgeScheduledPosts(db, pubkey);
    const now = Math.floor(Date.now() / 1000);
    await upsertDeletionRequest(
      db,
      { pubkey, source, billing, scheduled_posts_removed: scheduledPostsRemoved },
      now
    );
    console.log(
      `[Account Deletion] request recorded source=${source} billing=${billing} scheduled=${scheduledPostsRemoved}`
    );
    // A repeat while pending keeps the first requested_at (the 30-day
    // clock), so report the stored value rather than `now`.
    const row = await getDeletionRequest(db, pubkey);
    return json(
      {
        status: 'pending',
        requested_at: row?.requested_at ?? now,
        billing,
        scheduled_posts_removed: scheduledPostsRemoved
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[Account Deletion] failed to record request:', error);
    return json({ error: 'server_error' }, { status: 500 });
  }
};

export const GET: RequestHandler = async ({ request, platform }) => {
  const db = platform?.env?.SCHEDULER_DB;
  if (!db) {
    console.error('[Account Deletion] SCHEDULER_DB not configured');
    return json({ error: 'not_configured' }, { status: 500 });
  }

  const auth = await verifyNip98(request, {});
  if (!auth.ok) {
    console.warn(`[Account Deletion] NIP-98 rejected (${auth.reason}) on GET`);
    return authFailedResponse(auth.reason);
  }

  try {
    const row = await getDeletionRequest(db, auth.pubkey.toLowerCase());
    if (!row) return json({ error: 'not_found' }, { status: 404 });
    return json({
      status: row.status,
      requested_at: row.requested_at,
      completed_at: row.completed_at,
      billing: row.billing
    });
  } catch (error) {
    console.error('[Account Deletion] failed to read request:', error);
    return json({ error: 'server_error' }, { status: 500 });
  }
};
