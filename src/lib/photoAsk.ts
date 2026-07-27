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

/**
 * Byte signatures for the image formats the Cheffy vision path reads.
 *
 * This replaced a picker `accept` filter, and the reason is the whole
 * point of the check: `accept` is a HINT to a file picker we do not
 * ship, and so is `file.type` — the browser derives it from the
 * filename, so a HEIC named `.jpg` reports `image/jpeg`. Neither is
 * something we received. The bytes are. This reads them.
 *
 * The list is NOT a server fact, though it was described as one while
 * it lived in `accept`. Nothing in our code decides whether a photo is
 * readable: both endpoints only LABEL the format from a base64 prefix
 * and default anything unrecognised to image/jpeg, with no rejection
 * branch (ask-photo/+server.ts, scan/+server.ts). The actual authority
 * is OpenAI's decoder. So this table is our best statement of what the
 * vision model reads, and the endpoints' tables are another statement
 * of the same guess.
 *
 * A GATE HERE IS A NARROWING, NOT A GUARANTEE. A WAV also starts
 * `RIFF`, an animated GIF also starts `GIF8`, and a truncated JPEG has
 * a perfect header — all three pass this check and fail at the model.
 * `IMAGE_UNREADABLE` and NON_RETRYABLE_CODES below are the PERMANENT
 * backstop behind this function, never scaffolding it replaces. Do not
 * read "we validate the format at pick time now" as making the server
 * error path dead code; it is the only thing covering everything this
 * table cannot see.
 *
 * Base64 prefixes were never the fact — they are what you get when you
 * happen to be holding base64. 16 bytes is enough for all four,
 * including WEBP's second marker.
 */
const PHOTO_SIGNATURES: ReadonlyArray<{ mime: string; match: (b: Uint8Array) => boolean }> = [
  // FF D8 FF
  { mime: 'image/jpeg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  // 89 P N G CR LF ^Z LF
  {
    mime: 'image/png',
    match: (b) =>
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a
  },
  // "GIF8" — matches 87a and 89a alike, animation included.
  {
    mime: 'image/gif',
    match: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38
  },
  // "RIFF" at 0-3 AND "WEBP" at 8-11. RIFF alone is also WAV and AVI,
  // so the second marker is what makes this a WEBP check.
  {
    mime: 'image/webp',
    match: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50
  }
];

/** Bytes to read off the front of a file to run every signature above. */
export const PHOTO_SIGNATURE_BYTES = 16;

/**
 * The image format `bytes` opens with, or null if no signature matches.
 *
 * Null is the rejection: it means we cannot name the format, not that
 * the file is corrupt. A HEIC straight off an iPhone lands here — an
 * ISO-BMFF file opens with the size of its `ftyp` box, a small integer,
 * so its first bytes are `00 00 00` and match nothing in the table.
 */
export function identifyPhotoFormat(bytes: Uint8Array): string | null {
  for (const sig of PHOTO_SIGNATURES) {
    if (sig.match(bytes)) return sig.mime;
  }
  return null;
}

/**
 * Read a picked file's leading bytes and identify it. Returns null when
 * the format is unknown OR the read itself fails — a file we cannot
 * read is one we cannot send, so both are the same answer to the caller.
 */
export async function identifyPhotoFile(file: File): Promise<string | null> {
  try {
    const head = await file.slice(0, PHOTO_SIGNATURE_BYTES).arrayBuffer();
    return identifyPhotoFormat(new Uint8Array(head));
  } catch {
    return null;
  }
}

export type PhotoAskResult =
  | { ok: true; output: string }
  | { ok: false; code?: string; error?: string; status?: number };

/**
 * Failure codes where re-sending the IDENTICAL request cannot succeed,
 * so offering "Try again" would be an enabled button that is guaranteed
 * to fail. The error bubble reads this to decide whether to render one.
 *
 * The test is: CAN AN UNCHANGED REPLAY OF THIS EXACT REQUEST EVER SUCCEED?
 * Not "is it deterministic" (a 503 isn't deterministic either way), and not
 * "is the resolving control on this screen" — that one misclassifies the
 * failure it most needs to get right, because a signer rejection is resolved
 * in the signer app, off screen, and still wants this button.
 *
 * Under the replay test all five sort cleanly. A 429 succeeds after time, a
 * 503 after the upstream recovers, a signer rejection after a second approval,
 * and NOT_MEMBER after the member renews in another tab — for that last one
 * this button is the only way back without losing the turn to a reload. All
 * keep it. Off-screen resolution is not disqualifying; the button is how the
 * member resumes once the resolution has happened.
 *
 * Only IMAGE_UNREADABLE fails. The photo travels as an inline base64 `data:`
 * URI (ask-photo/+server.ts), so there is no download that could fail
 * transiently: same bytes, same rejection, every press. Resolving it requires
 * a DIFFERENT input, which is the one thing a replay cannot supply. The copy
 * already points at the composer ("Try another one?"), the step that works.
 *
 * Anything unrecognised is treated as retryable: an unknown failure is
 * exactly the case where one more attempt is a reasonable thing to offer.
 */
const NON_RETRYABLE_CODES = new Set(['IMAGE_UNREADABLE']);

export function isPhotoAskRetryable(code?: string): boolean {
  return !code || !NON_RETRYABLE_CODES.has(code);
}

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
