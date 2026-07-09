/**
 * Cheffy Note Review — credit purchase invoice (Phase 5).
 *
 * POST /api/zappy/note-review/credit-invoice
 * NIP-98 auth (body-hash bound; body is `{}` — the identity IS the
 * correlation: the invoice is bound to the authed pubkey in KV, and
 * credit-status only pays out to that same pubkey).
 *
 * Creates a Strike receive request for exactly 21 sats (BTC-denominated,
 * 10-minute expiry) and stores {receiveRequestId → pubkey} metadata in
 * GATED_CONTENT. Rate-limited per pubkey — invoice creation is free to
 * us but spammable.
 *
 * Returns: { ok: true, invoiceId, bolt11, expiresAt }  (expiresAt: ms epoch)
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifyNip98 } from '$lib/nip98.server';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import { createInvoice, isStrikeConfigured } from '$lib/strikeService.server';
import {
  NOTE_REVIEW_CREDIT_BTC,
  NOTE_REVIEW_CREDIT_SATS,
  CREDIT_INVOICE_EXPIRY_SECONDS,
  storeCreditInvoice
} from '$lib/noteReviewCredits.server';

const PER_HOUR = 6;
const PER_DAY = 20;

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    // Never sell credits while drafting is free: with membership gating
    // off, note-review serves everyone at no charge, so a purchased
    // credit would buy nothing. 409 — the request conflicts with the
    // current access state, and a healthy client never sends it (the
    // payment card only renders after a 403 NOT_MEMBER).
    const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
    if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
      return json(
        {
          ok: false,
          code: 'CREDITS_NOT_NEEDED',
          error: 'Drafting is currently free — no credits needed.'
        },
        { status: 409 }
      );
    }

    if (!isStrikeConfigured(platform)) {
      return json(
        { ok: false, error: 'Lightning payments are not available right now.' },
        { status: 503 }
      );
    }

    let bodyBytes: Uint8Array;
    try {
      bodyBytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }
    // The expected body is `{}` — cap it before spending CPU on the
    // NIP-98 payload hash.
    if (bodyBytes.length > 1024) {
      return json({ ok: false, error: 'Request body too large' }, { status: 413 });
    }

    const verification = await verifyNip98(request, { bodyBytes });
    if (!verification.ok) {
      console.warn(`[NR Credit Invoice] NIP-98 rejected (${verification.reason})`);
      return json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const authPubkey = verification.pubkey;

    // Per-pubkey cap (rate-limit buckets stay in NOURISH_FLAGS with the
    // rl: convention; the credit LEDGER lives in GATED_CONTENT).
    const rlKv = platform?.env?.NOURISH_FLAGS;
    if (!rlKv) {
      // checkPerIpRateLimit fails open silently — be loud so an
      // unmetered invoice endpoint shows up in logs.
      console.warn(
        '[NR Credit Invoice] NOURISH_FLAGS KV not bound — invoice rate limiting is disabled'
      );
    }
    const rl = await checkPerIpRateLimit(rlKv, {
      ip: authPubkey,
      scope: 'note-review-invoice',
      perHour: PER_HOUR,
      perDay: PER_DAY
    });
    if (rl.limited) {
      return json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: 'Too many invoices — give the last one a moment.',
          retryAfter: rl.body.retryAfter
        },
        { status: 429 }
      );
    }

    const strikeResponse = await createInvoice(
      NOTE_REVIEW_CREDIT_BTC,
      'BTC',
      `Cheffy note review draft (${NOTE_REVIEW_CREDIT_SATS} sats) — zap.cooking`,
      platform,
      CREDIT_INVOICE_EXPIRY_SECONDS
    );

    // Strike nests the BOLT11 under bolt11; tolerate top-level for
    // compatibility (same extraction as the membership flow).
    const bolt11Data = (strikeResponse as { bolt11?: Record<string, unknown> }).bolt11;
    const bolt11 = (bolt11Data?.invoice ?? (strikeResponse as { invoice?: string }).invoice) as
      | string
      | undefined;
    const invoiceId = (strikeResponse as { receiveRequestId?: string }).receiveRequestId;
    if (!bolt11 || !invoiceId) {
      console.error('[NR Credit Invoice] Strike response missing invoice/id');
      return json(
        { ok: false, error: 'Could not create the invoice. Please try again.' },
        { status: 502 }
      );
    }

    const expiresString = (bolt11Data?.expires ??
      (strikeResponse as { expires?: string }).expires) as string | undefined;
    const expiresAt = expiresString
      ? new Date(expiresString).getTime()
      : Date.now() + CREDIT_INVOICE_EXPIRY_SECONDS * 1000;

    await storeCreditInvoice(platform?.env?.GATED_CONTENT, invoiceId, authPubkey, expiresAt);

    return json({ ok: true, invoiceId, bolt11, expiresAt });
  } catch (error: unknown) {
    // Upstream Strike failures (auth rejection, 4xx/5xx) are a typed
    // 502, not a bare 500 — the client shows a retry line and the real
    // reason stays in the server log. strikeService throws with this
    // exact message prefix for every non-ok Strike response.
    if (error instanceof Error && error.message.startsWith('Strike API error')) {
      console.error('[NR Credit Invoice] Strike rejected the request:', error.message);
      return json(
        {
          ok: false,
          code: 'STRIKE_ERROR',
          error: 'Lightning payments are having trouble right now. Please try again shortly.'
        },
        { status: 502 }
      );
    }
    console.error('[NR Credit Invoice] Error:', error);
    return json(
      { ok: false, error: 'Could not create the invoice. Please try again.' },
      { status: 500 }
    );
  }
};
