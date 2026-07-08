/**
 * Cheffy Note Review — credit invoice status + idempotent crediting.
 *
 * GET /api/zappy/note-review/credit-status?id={receiveRequestId}
 * NIP-98 auth (GET-style, no payload tag; the u tag matches because
 * normalizeUrl strips query strings on both sides).
 *
 * Polled by the modal every few seconds while the payer sits on the
 * invoice (D3: polling, mirroring the genesis flow — no new webhook).
 * On the first observed COMPLETED receive, increments the pubkey's
 * credit balance exactly once (idempotency mark on the invoice id —
 * refresh spam can't double-credit).
 *
 * Returns: { ok: true, status: 'paid' | 'pending' | 'expired', balance }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { verifyNip98 } from '$lib/nip98.server';
import { getReceiveRequestReceives } from '$lib/strikeService.server';
import {
  getCreditInvoice,
  creditInvoicePaid,
  getCreditBalance
} from '$lib/noteReviewCredits.server';

export const GET: RequestHandler = async ({ request, url, platform }) => {
  try {
    const verification = await verifyNip98(request, {});
    if (!verification.ok) {
      console.warn(`[NR Credit Status] NIP-98 rejected (${verification.reason})`);
      return json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const authPubkey = verification.pubkey;

    const invoiceId = url.searchParams.get('id')?.trim();
    if (!invoiceId) {
      return json({ ok: false, error: 'id is required' }, { status: 400 });
    }

    const kv = platform?.env?.GATED_CONTENT;
    const metadata = await getCreditInvoice(kv, invoiceId);
    if (!metadata) {
      // Unknown or TTL'd-out invoice — the client treats expired as
      // "offer a fresh invoice"; no distinction leaked.
      return json({
        ok: true,
        status: 'expired',
        balance: await getCreditBalance(kv, authPubkey)
      });
    }
    if (metadata.pubkey !== authPubkey.toLowerCase()) {
      return json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }

    // getReceiveRequestReceives returns a plain Receive[] (it unwraps
    // Strike's items envelope itself).
    let receives: Array<{ state?: string }> = [];
    try {
      receives = await getReceiveRequestReceives(invoiceId, platform);
    } catch (err) {
      console.error('[NR Credit Status] Strike lookup failed:', err);
      return json(
        { ok: false, error: 'Payment check hiccuped — trying again shortly.' },
        { status: 503 }
      );
    }

    const paid = receives.some((r) => r?.state === 'COMPLETED');
    if (paid) {
      const { balance } = await creditInvoicePaid(kv, invoiceId, authPubkey);
      return json({ ok: true, status: 'paid', balance });
    }

    const status = Date.now() > metadata.expiresAt ? 'expired' : 'pending';
    return json({
      ok: true,
      status,
      balance: await getCreditBalance(kv, authPubkey)
    });
  } catch (error: unknown) {
    console.error('[NR Credit Status] Error:', error);
    return json({ ok: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
};
