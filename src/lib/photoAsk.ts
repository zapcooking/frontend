/**
 * Cheffy "Ask about a photo" — client request plumbing.
 *
 * Kept in a plain module (not a component) so it is unit-testable —
 * repo convention: logic in .ts, no Svelte component tests. The server
 * contract lives at POST /api/zappy/ask-photo (NIP-98 auth, body-hash
 * bound); `requestNoteReview` in noteReview.ts is the template this
 * mirrors.
 */

import type NDK from '@nostr-dev-kit/ndk';
import { signNip98AuthHeader } from './nip98';
import { PHOTO_SIGN_FAILED_LINE, PHOTO_NETWORK_ERROR_LINE } from './cheffy';

/** Mirrors the server cap — a longer question just loses its tail. */
export const QUESTION_MAX_CHARS = 500;

/**
 * Client-side file cap, matching the existing scan composer's check and
 * the "try one under 10MB" line the composer shows. The endpoint's wire
 * cap is sized to hold the base64 expansion of this — see the comment
 * on IMAGE_MAX_CHARS in ask-photo/+server.ts.
 */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export type PhotoAskResult =
  | { ok: true; output: string }
  | { ok: false; code?: string; error?: string; status?: number };

export interface PhotoAskRequestOpts {
  ndk: NDK;
  /** Base64 image data, no `data:` prefix — see fileToBase64. */
  imageBase64: string;
  /** The member's own question. Trimmed and capped here; defaulted server-side when empty. */
  question?: string;
  /** Called once the NIP-98 header is signed, before the fetch (NIP-46 round trips are slow). */
  onSigned?: () => void;
  /** Test injection points. */
  signHeader?: typeof signNip98AuthHeader;
  fetchFn?: typeof fetch;
  origin?: string;
}

/**
 * Read a File as base64 with the `data:` prefix stripped — the shape
 * both photo endpoints take on the wire.
 *
 * Single copy on purpose. This existed as three-line duplicates inside
 * CheffyMessenger.svelte and /cheffy/+page.svelte; both now import it
 * from here.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Sign and send a photo-ask request. Never throws — every failure mode
 * comes back typed, so the caller renders a Cheffy line rather than an
 * exception.
 */
export async function askAboutPhoto(opts: PhotoAskRequestOpts): Promise<PhotoAskResult> {
  const { ndk, imageBase64, onSigned, signHeader = signNip98AuthHeader, fetchFn = fetch } = opts;

  const question = opts.question?.trim().slice(0, QUESTION_MAX_CHARS);
  const body: Record<string, unknown> = { image: imageBase64 };
  if (question) body.question = question;
  // The signed payload hash and the fetch body must be the same string.
  const bodyString = JSON.stringify(body);

  const origin =
    opts.origin ?? (typeof location !== 'undefined' ? location.origin : 'https://zap.cooking');

  let authorization: string;
  try {
    authorization = await signHeader(ndk, {
      method: 'POST',
      url: `${origin}/api/zappy/ask-photo`,
      bodyString
    });
  } catch (err) {
    // `error` is rendered verbatim inside a Cheffy bubble, so it is copy,
    // not a stack trace: an unhandled signer message put "User rejected
    // the request." in Cheffy's voice. The real one is diagnostic.
    console.warn('[Photo Ask] signing failed:', err);
    return { ok: false, code: 'SIGN_FAILED', error: PHOTO_SIGN_FAILED_LINE };
  }

  onSigned?.();

  try {
    const resp = await fetchFn('/api/zappy/ask-photo', {
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
    console.warn('[Photo Ask] request failed:', err);
    return { ok: false, code: 'NETWORK', error: PHOTO_NETWORK_ERROR_LINE };
  }
}
