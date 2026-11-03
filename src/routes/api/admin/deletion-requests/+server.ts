/**
 * /api/admin/deletion-requests — staff queue for account deletion.
 *
 * GET  ?status=pending|completed (default pending) → { requests: [...] },
 *      oldest first, so the list reads as the order they are due in.
 *      Each pending row carries needs_billing_check: true whenever its
 *      Stripe result is not 'cancelled' — staff checks Stripe by hand.
 * POST { pubkey } → marks that pending request completed, after staff
 *      has removed membership + credits (member-relay) and Pantry events.
 *
 * NIP-98 gated to ADMIN_PUBKEY, same as /api/admin/promos.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { verifyNip98 } from '$lib/nip98.server';
import {
  completeDeletionRequest,
  listDeletionRequests,
  needsBillingCheck
} from '$lib/accountDeletion.server';

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const auth = await verifyNip98(request, { expectedPubkey: ADMIN_PUBKEY });
  if (!auth.ok) {
    console.warn('[admin.deletion-requests.auth-failed]', { method: 'GET', reason: auth.reason });
    return json({ error: 'forbidden' }, { status: 403 });
  }

  const db = platform?.env?.SCHEDULER_DB;
  if (!db) return json({ error: 'not_configured' }, { status: 500 });

  const status = url.searchParams.get('status') === 'completed' ? 'completed' : 'pending';
  const requests = (await listDeletionRequests(db, status)).map((row) => ({
    ...row,
    needs_billing_check: row.status === 'pending' && needsBillingCheck(row)
  }));
  return json({ requests });
};

export const POST: RequestHandler = async ({ request, platform }) => {
  const bodyBytes = new Uint8Array(await request.arrayBuffer());
  const auth = await verifyNip98(request, { expectedPubkey: ADMIN_PUBKEY, bodyBytes });
  if (!auth.ok) {
    console.warn('[admin.deletion-requests.auth-failed]', { method: 'POST', reason: auth.reason });
    return json({ error: 'forbidden' }, { status: 403 });
  }

  const db = platform?.env?.SCHEDULER_DB;
  if (!db) return json({ error: 'not_configured' }, { status: 500 });

  let pubkey: unknown;
  try {
    ({ pubkey } = JSON.parse(new TextDecoder().decode(bodyBytes)));
  } catch {
    return json({ error: 'bad_request' }, { status: 400 });
  }
  if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    return json({ error: 'bad_request' }, { status: 400 });
  }

  const done = await completeDeletionRequest(db, pubkey.toLowerCase(), Math.floor(Date.now() / 1000));
  if (!done) return json({ error: 'not_found' }, { status: 404 });
  return json({ ok: true });
};
