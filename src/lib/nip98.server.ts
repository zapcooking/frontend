/**
 * NIP-98 HTTP Auth — server-side verifier.
 *
 * Paired with `signNip98AuthHeader` in src/lib/nip98.ts. Decodes the
 * `Authorization: Nostr <base64>` header, verifies the signed
 * kind-27235 event, and checks that the event binds to this specific
 * request (URL, method, recent timestamp, and — when a body is
 * present — its exact bytes via a `payload` tag hash).
 *
 * Returns a discriminated result with one of a fixed set of failure
 * reasons so callers can `console.warn` them for greppable logs while
 * uniformly returning `403 { error: 'forbidden' }` to clients (no
 * information leak about which check failed).
 */

import { verifyEvent, type Event as NostrEvent } from 'nostr-tools';
import { normalizeUrl, sha256Hex } from './nip98';

export type Nip98FailureReason =
  | 'missing-header'
  | 'malformed-header'
  | 'invalid-signature'
  | 'wrong-kind'
  | 'stale-timestamp'
  | 'url-mismatch'
  | 'method-mismatch'
  | 'payload-mismatch'
  | 'missing-payload-tag'
  | 'pubkey-mismatch';

export type Nip98Verification =
  | { ok: true; pubkey: string }
  | { ok: false; reason: Nip98FailureReason };

const DEFAULT_MAX_SKEW_SECONDS = 60;

/**
 * Verify a NIP-98 Authorization header against the current request.
 *
 * Caller reads the request body ONCE (via `request.arrayBuffer()` or
 * equivalent) and passes the bytes in `bodyBytes` — avoids the
 * `request.clone().arrayBuffer()` pattern which has subtle
 * body-consumption semantics on Cloudflare Workers. Callers that
 * parse the body themselves after this verifier returns should reuse
 * the same bytes rather than touching `request.json()`.
 *
 * A `bodyBytes` value of undefined means "no body to verify" (GET-
 * style). For POST/PUT/PATCH with a JSON body, always pass the bytes
 * — a missing `payload` tag is a verification failure (prevents a
 * caller from signing a header for an empty body and replaying it
 * against a request with a real body).
 */
export async function verifyNip98(
  request: Request,
  opts: {
    expectedPubkey: string;
    bodyBytes?: Uint8Array;
    maxSkewSeconds?: number;
  }
): Promise<Nip98Verification> {
  const header = request.headers.get('Authorization');
  if (!header) return { ok: false, reason: 'missing-header' };
  if (!header.startsWith('Nostr ')) {
    return { ok: false, reason: 'malformed-header' };
  }
  const encoded = header.slice('Nostr '.length).trim();

  let event: NostrEvent;
  try {
    const decoded = atob(encoded);
    event = JSON.parse(decoded);
  } catch {
    return { ok: false, reason: 'malformed-header' };
  }

  if (event.kind !== 27235) return { ok: false, reason: 'wrong-kind' };

  // Signature verification uses @noble/secp256k1 + @noble/hashes under
  // the hood — pure JS, works on Cloudflare Workers. Same crypto
  // substrate as publishNourishEvent's finalizeEvent.
  let valid = false;
  try {
    valid = verifyEvent(event);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'invalid-signature' };

  // Timestamp skew — ±60s default.
  const now = Math.floor(Date.now() / 1000);
  const maxSkew = opts.maxSkewSeconds ?? DEFAULT_MAX_SKEW_SECONDS;
  if (Math.abs(now - (event.created_at || 0)) > maxSkew) {
    return { ok: false, reason: 'stale-timestamp' };
  }

  // URL match — both sides use normalizeUrl from the shared module
  // so any discrepancy is a real mismatch, not a normalization bug.
  const uTag = event.tags.find((t) => t[0] === 'u')?.[1];
  if (!uTag) return { ok: false, reason: 'url-mismatch' };
  if (normalizeUrl(uTag) !== normalizeUrl(request.url)) {
    return { ok: false, reason: 'url-mismatch' };
  }

  // Method match.
  const methodTag = event.tags.find((t) => t[0] === 'method')?.[1];
  if (!methodTag || methodTag.toUpperCase() !== request.method.toUpperCase()) {
    return { ok: false, reason: 'method-mismatch' };
  }

  // Payload binding — required when the caller passes bodyBytes.
  // Missing tag is a distinct failure reason from mismatch so admin
  // logs can tell "attacker stripped the tag" from "attacker swapped
  // the body."
  if (opts.bodyBytes !== undefined) {
    const payloadTag = event.tags.find((t) => t[0] === 'payload')?.[1];
    if (!payloadTag) return { ok: false, reason: 'missing-payload-tag' };
    const expected = await sha256Hex(opts.bodyBytes);
    if (payloadTag.toLowerCase() !== expected.toLowerCase()) {
      return { ok: false, reason: 'payload-mismatch' };
    }
  }

  // Identity gate — only the expected pubkey is authorized for this
  // endpoint. Signature was valid (the caller proved they hold some
  // key), but only ADMIN_PUBKEY is allowed to rescore.
  if (event.pubkey !== opts.expectedPubkey) {
    return { ok: false, reason: 'pubkey-mismatch' };
  }

  return { ok: true, pubkey: event.pubkey };
}
