/**
 * Cheffy Note Photo Review — client logic (Phase 2).
 *
 * State machine and request plumbing for CheffyNoteReview.svelte, kept
 * in a plain module so it is unit-testable (repo convention: logic in
 * .ts, no Svelte component tests). The server contract lives at
 * POST /api/zappy/note-review (NIP-98 auth, body-hash bound).
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { signNip98AuthHeader } from './nip98';
import { pickLine } from './cheffy';
import { postComment, PostCommentError } from './comments/postComment';
import { buildInboxAwareRelaySet } from './nip65Routing';

/**
 * Post-button flag, flipped ON in Phase 3 alongside the postComment()
 * wiring. Kept (rather than deleted) as the kill switch for the publish
 * path; the flag-guard in checks.yaml now asserts it stays true so an
 * accidental un-flip can't silently dark-ship posting either.
 */
export const NOTE_REVIEW_POST_ENABLED = true;

export type NoteReviewMode = 'comment' | 'recipe';

export type NoteReviewPhase =
  | 'choose' // mode selection
  | 'signing' // waiting on the user's signer (NIP-46 round trips are slow)
  | 'loading' // request in flight
  | 'draft' // editable draft ready
  | 'posting' // publish in flight — Post disabled, no double-post
  | 'post-timeout' // signed but relay round-trip timed out — retry without re-signing
  | 'posted' // published — success state with a link to the reply
  | 'dead-end' // friendly stop — nothing postable (unclear/unreadable photo)
  | 'upsell' // NOT_MEMBER — the membership-or-sats payment card
  | 'paying' // 21-sat invoice active: Alby modal open, status polling
  | 'error'; // retryable failure

/** The only phase a publish may start from — the double-post guard. */
export function canPost(phase: NoteReviewPhase): boolean {
  return phase === 'draft';
}

export type NoteReviewResult =
  | { ok: true; output: string; creditsRemaining?: number }
  | { ok: false; code?: string; error?: string; status?: number };

// Mirrors the server cap — a longer note just loses its tail.
export const NOTE_TEXT_MAX_CHARS = 1000;

/**
 * Hedged dead-end copy pool. Phase 1 finding: the server's NOT_FOOD path
 * also fires for CDN fallback images served in place of dead links
 * (e.g. nostr.build never 404s), so every line here must stay in the
 * "couldn't get a good look" register — never a confident "that's not
 * food", and the model's line is never echoed. Rotated via pickLine so
 * regenerate attempts don't repeat the same dead-end verbatim.
 */
export const DEAD_END_LINES = [
  "Cheffy couldn't get a good look at that photo. It might be a broken link — or just not clearly a dish.",
  "That photo's playing hard to get — Cheffy can't quite make out a dish in it.",
  "Cheffy squinted, but couldn't spot a dish in there. The photo may not have come through.",
  "Hmm — Cheffy couldn't see this one clearly. The link may be stale, or the dish is camera-shy."
];

export const SIGN_FAILED_LINE =
  "Cheffy couldn't get your signer's autograph. Check your signer and try again.";

const GENERIC_ERROR_LINE = 'Cheffy could not finish that one. Please try again.';

/**
 * Map a request result to the modal phase and its display message.
 * Pure — this is the tested core of the modal's state machine.
 */
export function phaseForResult(result: NoteReviewResult): {
  phase: NoteReviewPhase;
  message: string;
} {
  if (result.ok) return { phase: 'draft', message: '' };
  switch (result.code) {
    case 'NOT_MEMBER':
      return { phase: 'upsell', message: '' };
    case 'NOT_FOOD':
    case 'IMAGE_UNREADABLE':
      // Deliberately ignore the server-provided line here — it can be a
      // confident "that's a cat" while the truth is a dead link.
      return { phase: 'dead-end', message: pickLine(DEAD_END_LINES) };
    case 'SIGN_FAILED':
      return { phase: 'error', message: SIGN_FAILED_LINE };
    default:
      return { phase: 'error', message: result.error || GENERIC_ERROR_LINE };
  }
}

export interface NoteReviewRequestOpts {
  ndk: NDK;
  imageUrl: string;
  mode: NoteReviewMode;
  /** Raw note content — trimmed and capped here, wrapped as untrusted context server-side. */
  noteText?: string;
  /** Event id hex, server logging only. */
  noteId?: string;
  /** Called once the NIP-98 header is signed, before the fetch — flips signing → loading. */
  onSigned?: () => void;
  /** Test injection points. */
  signHeader?: typeof signNip98AuthHeader;
  fetchFn?: typeof fetch;
  origin?: string;
}

/**
 * Sign and send a note-review request. Never throws — every failure
 * mode comes back as a NoteReviewResult for phaseForResult to map.
 */
export async function requestNoteReview(opts: NoteReviewRequestOpts): Promise<NoteReviewResult> {
  const {
    ndk,
    imageUrl,
    mode,
    noteId,
    onSigned,
    signHeader = signNip98AuthHeader,
    fetchFn = fetch
  } = opts;

  const noteText = opts.noteText?.trim().slice(0, NOTE_TEXT_MAX_CHARS);
  const body: Record<string, unknown> = { imageUrl, mode };
  if (noteText) body.noteText = noteText;
  if (noteId) body.noteId = noteId;
  // The signed payload hash and the fetch body must be the same string.
  const bodyString = JSON.stringify(body);

  const origin =
    opts.origin ?? (typeof location !== 'undefined' ? location.origin : 'https://zap.cooking');

  let authorization: string;
  try {
    authorization = await signHeader(ndk, {
      method: 'POST',
      url: `${origin}/api/zappy/note-review`,
      bodyString
    });
  } catch (err) {
    return {
      ok: false,
      code: 'SIGN_FAILED',
      error: err instanceof Error ? err.message : 'Signing failed'
    };
  }

  onSigned?.();

  try {
    const resp = await fetchFn('/api/zappy/note-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: bodyString
    });
    const data: Record<string, unknown> = await resp.json().catch(() => ({}));
    if (resp.ok && data.ok === true && typeof data.output === 'string') {
      return {
        ok: true,
        output: data.output,
        // Additive server field on credit-spending requests only.
        ...(typeof data.creditsRemaining === 'number'
          ? { creditsRemaining: data.creditsRemaining }
          : {})
      };
    }
    return {
      ok: false,
      code: typeof data.code === 'string' ? data.code : undefined,
      error: typeof data.error === 'string' ? data.error : undefined,
      status: resp.status
    };
  } catch (err) {
    return {
      ok: false,
      code: 'NETWORK',
      error: err instanceof Error ? err.message : 'Network error'
    };
  }
}

// ---------------------------------------------------------------------------
// Publish path (Phase 3) — Post → postComment() with the kind-1 parent
// ---------------------------------------------------------------------------

export const POST_TIMEOUT_LINE =
  "The relays are taking their time. Your reply is signed and may already be out there — give it another push, and Cheffy won't ask your signer twice.";

export const PUBLISH_FAILED_LINE =
  "The relays didn't take that one. Your draft is safe — give it another go.";

export type PublishOutcome =
  | { ok: true; event: NDKEvent; noteLink: string }
  | { ok: false; code: 'publish-timeout'; message: string; signedEvent: NDKEvent }
  | {
      ok: false;
      code: 'sign-failed' | 'publish-failed' | 'invalid-parent' | 'unknown';
      message: string;
    };

/**
 * Thread-view link for a published reply. House pattern: nevent with
 * author + kind hints, falling back to a bare note1 encoding.
 */
export function noteLinkFor(event: NDKEvent): string {
  try {
    return '/' + nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind ?? 1 });
  } catch {
    return '/' + nip19.noteEncode(event.id);
  }
}

export interface PublishNoteReviewOpts {
  ndk: NDK;
  /** The kind-1 note being replied to. */
  parentEvent: NDKEvent;
  /** The member-edited draft (D1: never raw model output on auto-pilot). */
  content: string;
  /** Test injection. */
  postCommentFn?: typeof postComment;
}

/**
 * Publish the edited draft as a NIP-10 reply, signed by the member.
 * postComment owns tagging (NIP-10 via buildNip22CommentTags), the
 * NIP-89 client tag, inbox-aware relay routing, and signing. Never
 * throws — every PostCommentError code maps to a typed outcome so the
 * modal can branch in Cheffy voice, including the publish-timeout
 * signed-event recovery path.
 */
export async function publishNoteReviewReply(opts: PublishNoteReviewOpts): Promise<PublishOutcome> {
  const { ndk, parentEvent, content, postCommentFn = postComment } = opts;
  try {
    const { event } = await postCommentFn(ndk, {
      parentEvent,
      content,
      signingStrategy: 'explicit-with-timeout'
    });
    return { ok: true, event, noteLink: noteLinkFor(event) };
  } catch (err) {
    if (err instanceof PostCommentError) {
      switch (err.code) {
        case 'sign-failed':
          return { ok: false, code: 'sign-failed', message: SIGN_FAILED_LINE };
        case 'publish-timeout':
          if (err.signedEvent) {
            return {
              ok: false,
              code: 'publish-timeout',
              message: POST_TIMEOUT_LINE,
              signedEvent: err.signedEvent
            };
          }
          return { ok: false, code: 'publish-failed', message: PUBLISH_FAILED_LINE };
        case 'publish-failed':
          return { ok: false, code: 'publish-failed', message: PUBLISH_FAILED_LINE };
        case 'invalid-parent':
          return {
            ok: false,
            code: 'invalid-parent',
            message: "Cheffy lost track of the note you're replying to. Close and try again."
          };
      }
    }
    return {
      ok: false,
      code: 'unknown',
      message: err instanceof Error ? err.message : PUBLISH_FAILED_LINE
    };
  }
}

const RETRY_PUBLISH_TIMEOUT_MS = 15_000;

export interface RetryPublishOpts {
  ndk: NDK;
  /** The already-signed event from a publish-timeout outcome. */
  signedEvent: NDKEvent;
  timeoutMs?: number;
  /** Test injection. */
  buildRelaySetFn?: typeof buildInboxAwareRelaySet;
}

/**
 * Recovery path for publish-timeout: re-publish the ALREADY-SIGNED
 * event (same id, no second signer round trip) to the inbox-aware
 * relay set. Relays deduplicate by event id, so if the first attempt
 * actually landed this is a harmless no-op.
 */
export async function retryPublishSignedEvent(opts: RetryPublishOpts): Promise<PublishOutcome> {
  const {
    ndk,
    signedEvent,
    timeoutMs = RETRY_PUBLISH_TIMEOUT_MS,
    buildRelaySetFn = buildInboxAwareRelaySet
  } = opts;
  try {
    const relaySet = await buildRelaySetFn({ event: signedEvent, ndk });
    await Promise.race([
      signedEvent.publish(relaySet ?? undefined),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('publish retry timed out')), timeoutMs)
      )
    ]);
    return { ok: true, event: signedEvent, noteLink: noteLinkFor(signedEvent) };
  } catch {
    // Still no relay ack — keep the signed event so the member can try
    // again or safely close (it may have landed regardless).
    return { ok: false, code: 'publish-timeout', message: POST_TIMEOUT_LINE, signedEvent };
  }
}

// ---------------------------------------------------------------------------
// Disclosure footer (Phase 4) — optional "via Cheffy" attribution
// ---------------------------------------------------------------------------

/**
 * Appended at publish time when the member's toggle is on — NEVER
 * embedded in the editable textarea (the modal shows it as a separate
 * non-editable preview). Exact string is part of the product spec.
 */
export const DISCLOSURE_FOOTER = '⚡🍳 via Cheffy · zap.cooking';

/**
 * Build the publish content: the member's draft, untouched, plus the
 * footer on its own line after one blank line when the toggle is on.
 * Trailing whitespace on the draft is normalized so the footer never
 * drifts more than one blank line away.
 */
export function withDisclosureFooter(draft: string, on: boolean): string {
  if (!on) return draft;
  return `${draft.replace(/\s+$/, '')}\n\n${DISCLOSURE_FOOTER}`;
}

// Per-mode preference, house pattern: zapcooking_* localStorage keys.
// Defaults differ by mode: a recipe is Cheffy's structured work product
// (attribution on), a comment is the member's own voice (off).
const DISCLOSURE_PREF_KEYS: Record<NoteReviewMode, string> = {
  comment: 'zapcooking_note_review_disclosure_comment',
  recipe: 'zapcooking_note_review_disclosure_recipe'
};

export const DISCLOSURE_DEFAULTS: Record<NoteReviewMode, boolean> = {
  comment: false,
  recipe: true
};

/**
 * The stored preference seeds the toggle only on the initial mode
 * selection (from the choose phase). Regenerate / try-again re-runs
 * must preserve the member's in-session toggle — reloading would reset
 * it to the default wherever localStorage can't persist (private
 * mode), and the live toggle state is the fresher signal anyway.
 */
export function shouldSeedDisclosureFromPref(phase: NoteReviewPhase): boolean {
  return phase === 'choose';
}

export function loadDisclosurePref(mode: NoteReviewMode): boolean {
  if (typeof localStorage === 'undefined') return DISCLOSURE_DEFAULTS[mode];
  try {
    const raw = localStorage.getItem(DISCLOSURE_PREF_KEYS[mode]);
    return raw === null ? DISCLOSURE_DEFAULTS[mode] : raw === '1';
  } catch {
    return DISCLOSURE_DEFAULTS[mode];
  }
}

export function saveDisclosurePref(mode: NoteReviewMode, on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DISCLOSURE_PREF_KEYS[mode], on ? '1' : '0');
  } catch {
    // Storage unavailable (private mode) — the toggle still works for
    // the session; it just won't be remembered.
  }
}

// ---------------------------------------------------------------------------
// Credit purchase (Phase 5) — 21 sats per draft for non-members
// ---------------------------------------------------------------------------

export const CREDIT_PRICE_SATS = 21;

/** Chip + card copy: credits follow the key, not the device. */
export const CREDITS_CROSS_DEVICE_LINE = 'Tied to your Nostr key — works on any device.';

/**
 * Static example shown on the payment card (D5) so first-timers see
 * output quality before the 21-sat ask. Comment-mode length, hardcoded.
 */
export const PAYMENT_CARD_EXAMPLE_DRAFT =
  "That crust has the kind of golden edge you only get from a properly hot pan — and the basil on top says you weren't rushing. Beautiful work.";

export type CreditInvoiceResult =
  | { ok: true; invoiceId: string; bolt11: string; expiresAt: number }
  | { ok: false; code?: string; error?: string };

export type CreditStatusResult =
  | { ok: true; status: 'paid' | 'pending' | 'expired'; balance: number }
  | { ok: false; code?: string; error?: string };

interface CreditApiOpts {
  ndk: NDK;
  signHeader?: typeof signNip98AuthHeader;
  fetchFn?: typeof fetch;
  origin?: string;
}

function apiOrigin(origin?: string): string {
  return origin ?? (typeof location !== 'undefined' ? location.origin : 'https://zap.cooking');
}

/** Buy one draft: create a 21-sat invoice bound to the signed-in key. */
export async function requestCreditInvoice(opts: CreditApiOpts): Promise<CreditInvoiceResult> {
  const { ndk, signHeader = signNip98AuthHeader, fetchFn = fetch } = opts;
  const bodyString = '{}';
  let authorization: string;
  try {
    authorization = await signHeader(ndk, {
      method: 'POST',
      url: `${apiOrigin(opts.origin)}/api/zappy/note-review/credit-invoice`,
      bodyString
    });
  } catch (err) {
    return { ok: false, code: 'SIGN_FAILED', error: err instanceof Error ? err.message : '' };
  }
  try {
    const resp = await fetchFn('/api/zappy/note-review/credit-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: bodyString
    });
    const data: Record<string, unknown> = await resp.json().catch(() => ({}));
    if (
      resp.ok &&
      data.ok === true &&
      typeof data.invoiceId === 'string' &&
      typeof data.bolt11 === 'string'
    ) {
      return {
        ok: true,
        invoiceId: data.invoiceId,
        bolt11: data.bolt11,
        expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : 0
      };
    }
    return {
      ok: false,
      code: typeof data.code === 'string' ? data.code : undefined,
      error: typeof data.error === 'string' ? data.error : undefined
    };
  } catch (err) {
    return { ok: false, code: 'NETWORK', error: err instanceof Error ? err.message : '' };
  }
}

/**
 * Poll one invoice. The NIP-98 u-tag is signed without the query string
 * — normalizeUrl strips it on both sides, so signature and URL match.
 */
export async function checkCreditStatus(
  opts: CreditApiOpts & { invoiceId: string }
): Promise<CreditStatusResult> {
  const { ndk, invoiceId, signHeader = signNip98AuthHeader, fetchFn = fetch } = opts;
  let authorization: string;
  try {
    authorization = await signHeader(ndk, {
      method: 'GET',
      url: `${apiOrigin(opts.origin)}/api/zappy/note-review/credit-status`
    });
  } catch (err) {
    return { ok: false, code: 'SIGN_FAILED', error: err instanceof Error ? err.message : '' };
  }
  try {
    const resp = await fetchFn(
      `/api/zappy/note-review/credit-status?id=${encodeURIComponent(invoiceId)}`,
      { method: 'GET', headers: { Authorization: authorization } }
    );
    const data: Record<string, unknown> = await resp.json().catch(() => ({}));
    if (
      resp.ok &&
      data.ok === true &&
      (data.status === 'paid' || data.status === 'pending' || data.status === 'expired')
    ) {
      return {
        ok: true,
        status: data.status,
        balance: typeof data.balance === 'number' ? data.balance : 0
      };
    }
    return {
      ok: false,
      code: typeof data.code === 'string' ? data.code : undefined,
      error: typeof data.error === 'string' ? data.error : undefined
    };
  } catch (err) {
    return { ok: false, code: 'NETWORK', error: err instanceof Error ? err.message : '' };
  }
}

/** What the 3s poll loop does with each status observation. */
export function pollActionForStatus(status: 'paid' | 'pending' | 'expired'): {
  action: 'credited' | 'expired' | 'continue';
} {
  if (status === 'paid') return { action: 'credited' };
  if (status === 'expired') return { action: 'expired' };
  return { action: 'continue' };
}

// ── Pending-invoice persistence (resume flow) ────────────────────────
// If the payer closes the modal between paying and the poll observing
// COMPLETED, the invoice id survives here; the next modal open polls it
// once and credits them (server metadata stays creditable for 48h).

const PENDING_INVOICE_KEY = 'zapcooking_note_review_pending_invoice';

export interface PendingInvoice {
  invoiceId: string;
  /** Present since the object format — lets a live invoice be REUSED
   * instead of overwritten by a fresh purchase (an overwrite would
   * orphan a just-paid invoice's credit client-side). */
  bolt11?: string;
  expiresAt?: number;
}

export function storePendingInvoice(invoice: PendingInvoice): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PENDING_INVOICE_KEY, JSON.stringify(invoice));
  } catch {
    // Private mode — resume just won't work across closes this session.
  }
}

export function loadPendingInvoice(): PendingInvoice | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PENDING_INVOICE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.invoiceId === 'string') return parsed as PendingInvoice;
    } catch {
      // Legacy bare-string format from the first 5.2 iteration.
      return { invoiceId: raw };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearPendingInvoice(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(PENDING_INVOICE_KEY);
  } catch {
    // Nothing to clean if storage is unavailable.
  }
}

export type ResumeOutcome =
  | { outcome: 'absent' }
  | { outcome: 'paid'; balance: number }
  | { outcome: 'pending'; invoice: PendingInvoice }
  | { outcome: 'expired' };

/**
 * One-shot resume check on modal open. paid → cleared + acknowledged;
 * expired → cleared silently; pending → kept for the next open;
 * check failure → kept (never destroys a potentially-paid invoice).
 */
export async function resumePendingInvoice(opts: CreditApiOpts): Promise<ResumeOutcome> {
  const pending = loadPendingInvoice();
  if (!pending) return { outcome: 'absent' };
  const result = await checkCreditStatus({ ...opts, invoiceId: pending.invoiceId });
  if (!result.ok) return { outcome: 'pending', invoice: pending }; // transient — keep, retry next open
  if (result.status === 'paid') {
    clearPendingInvoice();
    return { outcome: 'paid', balance: result.balance };
  }
  if (result.status === 'expired') {
    clearPendingInvoice();
    return { outcome: 'expired' };
  }
  return { outcome: 'pending', invoice: pending };
}
