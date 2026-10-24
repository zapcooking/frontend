/**
 * Cheffy fridge scan — client request plumbing.
 *
 * Kept in a plain module (not a component) so it is unit-testable —
 * repo convention: logic in .ts, no Svelte component tests. The server
 * contract lives at POST /api/zappy/scan (NIP-98 auth, body-hash bound);
 * `askAboutPhoto` in photoAsk.ts is the template this mirrors.
 *
 * This existed as an inline fetch duplicated in CheffyMessenger.svelte
 * and /cheffy/+page.svelte. Both now call this, because the signing step
 * is the part that must not be written twice.
 */

import type NDK from '@nostr-dev-kit/ndk';
import { signNip98AuthHeader } from './nip98';
import { PHOTO_SIGN_FAILED_LINE } from './cheffy';

export interface ScanRequestOpts {
  ndk: NDK;
  /** Base64 image data, no `data:` prefix — see fileToBase64 in photoAsk.ts. */
  imageBase64: string;
  /** Called once the NIP-98 header is signed, before the fetch (NIP-46 round trips are slow). */
  onSigned?: () => void;
  /** Test injection points. */
  signHeader?: typeof signNip98AuthHeader;
  fetchFn?: typeof fetch;
  origin?: string;
}

export type ScanResult =
  | { ok: true; ingredients: string[] }
  | { ok: false; code?: string; error?: string; status?: number };

/**
 * Sign and send a fridge-scan request.
 *
 * DELIBERATELY UNLIKE `askAboutPhoto`, this does NOT catch a failed
 * fetch. Both call sites already wrap the call in try/catch and render
 * `err.message`, and converting a dropped connection into a typed result
 * would change the sentence a member reads — that is copy, and it is not
 * this change's to make. Signing failure is the one new failure mode
 * here, and it reuses the line ask-photo already ships for exactly it.
 */
export async function scanFridgePhoto(opts: ScanRequestOpts): Promise<ScanResult> {
  const { ndk, imageBase64, onSigned, signHeader = signNip98AuthHeader, fetchFn = fetch } = opts;

  // The signed payload hash and the fetch body must be the same string.
  const bodyString = JSON.stringify({ image: imageBase64 });

  const origin =
    opts.origin ?? (typeof location !== 'undefined' ? location.origin : 'https://zap.cooking');

  let authorization: string;
  try {
    authorization = await signHeader(ndk, {
      method: 'POST',
      url: `${origin}/api/zappy/scan`,
      bodyString
    });
  } catch (err) {
    // The real message is diagnostic, not copy — an unhandled signer
    // string put "User rejected the request." on screen in Cheffy's voice.
    console.warn('[Zappy Scan] signing failed:', err);
    return { ok: false, code: 'SIGN_FAILED', error: PHOTO_SIGN_FAILED_LINE };
  }

  onSigned?.();

  const resp = await fetchFn('/api/zappy/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authorization },
    body: bodyString
  });
  const data: Record<string, unknown> = await resp.json().catch(() => ({}));
  if (resp.ok && data.ok === true) {
    const ingredients = Array.isArray(data.ingredients)
      ? (data.ingredients as unknown[]).filter((i): i is string => typeof i === 'string')
      : [];
    return { ok: true, ingredients };
  }
  return {
    ok: false,
    code: typeof data.code === 'string' ? data.code : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
    status: resp.status
  };
}
