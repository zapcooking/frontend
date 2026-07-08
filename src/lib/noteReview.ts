/**
 * Cheffy Note Photo Review — client logic (Phase 2).
 *
 * State machine and request plumbing for CheffyNoteReview.svelte, kept
 * in a plain module so it is unit-testable (repo convention: logic in
 * .ts, no Svelte component tests). The server contract lives at
 * POST /api/zappy/note-review (NIP-98 auth, body-hash bound).
 */

import type NDK from '@nostr-dev-kit/ndk';
import { signNip98AuthHeader } from './nip98';

/**
 * Ship-dark flag: the Post button in CheffyNoteReview renders only when
 * this is true. Publish wiring (postComment) is Phase 3 — flipping this
 * before Phase 3 lands shows a button that does nothing. Guarded by CI
 * (flag-guard in checks.yaml) so a stray flip can't reach main.
 */
export const NOTE_REVIEW_POST_ENABLED = false;

export type NoteReviewMode = 'comment' | 'recipe';

export type NoteReviewPhase =
  | 'choose' // mode selection
  | 'signing' // waiting on the user's signer (NIP-46 round trips are slow)
  | 'loading' // request in flight
  | 'draft' // editable draft ready
  | 'dead-end' // friendly stop — nothing postable (unclear/unreadable photo)
  | 'upsell' // NOT_MEMBER — membership gate
  | 'preview-used' // preview turns spent — conversion nudge
  | 'error'; // retryable failure

export type NoteReviewResult =
  | { ok: true; output: string }
  | { ok: false; code?: string; error?: string; status?: number };

// Mirrors the server cap — a longer note just loses its tail.
export const NOTE_TEXT_MAX_CHARS = 1000;

/**
 * Hedged dead-end copy. Phase 1 finding: the server's NOT_FOOD path also
 * fires for CDN fallback images served in place of dead links (e.g.
 * nostr.build never 404s), so the client must never confidently claim
 * "that's not food" — and never echo the model's confident line.
 */
export const PHOTO_UNCLEAR_LINE =
  "Cheffy couldn't get a good look at that photo. It might be a broken link — or just not clearly a dish.";

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
    case 'PREVIEW_USED':
      return { phase: 'preview-used', message: '' };
    case 'NOT_FOOD':
    case 'IMAGE_UNREADABLE':
      // Deliberately ignore the server-provided line here — it can be a
      // confident "that's a cat" while the truth is a dead link.
      return { phase: 'dead-end', message: PHOTO_UNCLEAR_LINE };
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
  /** Non-member preview request (server enforces the cookie budget). */
  experience?: boolean;
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
    experience,
    onSigned,
    signHeader = signNip98AuthHeader,
    fetchFn = fetch
  } = opts;

  const noteText = opts.noteText?.trim().slice(0, NOTE_TEXT_MAX_CHARS);
  const body: Record<string, unknown> = { imageUrl, mode };
  if (noteText) body.noteText = noteText;
  if (noteId) body.noteId = noteId;
  if (experience) body.experience = true;
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
      return { ok: true, output: data.output };
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
