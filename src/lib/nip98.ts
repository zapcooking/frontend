/**
 * NIP-98 HTTP Auth — client-side helpers + shared primitives.
 *
 * Callers sign a short-lived kind-27235 event bound to a specific
 * URL, method, and (optionally) request-body hash, then send the
 * base64-encoded event in the `Authorization: Nostr <…>` header.
 * See src/lib/nip98.server.ts for the matching verifier.
 *
 * Pattern mirrors the existing client usage (nostr.build uploads in
 * mediaUpload.ts, nip29.ts, etc.) and factors out URL normalization
 * + payload hashing so client and server agree on the exact strings
 * being signed.
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk';

/**
 * Canonicalize a URL for NIP-98 `u` tag matching. Uses origin +
 * pathname, drops query string and fragment, strips trailing slash
 * on non-root paths. Client and server call this same helper so both
 * sides agree on the exact string — mismatches here produce
 * `url-mismatch` failures that would be painful to debug otherwise.
 */
export function normalizeUrl(url: string): string {
  const u = new URL(url);
  let pathname = u.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  return `${u.origin}${pathname}`;
}

/** Lowercase-hex SHA-256 of raw bytes — NIP-98 `payload` tag format. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build + sign a NIP-98 Authorization header value for a single
 * request. Returns the full header string (including the "Nostr "
 * prefix) so callers can drop it directly into `headers.Authorization`.
 *
 * When `bodyString` is provided, the event includes a `payload` tag
 * with the hex SHA-256 of its UTF-8 bytes — the server verifier
 * compares this against the actual received body, preventing
 * body-swap replay while reusing the same auth header.
 *
 * Callers should pass the exact string they'll send as the fetch
 * body (rather than an object the helper stringifies internally) so
 * there's a single source of truth for what the signature covers.
 *
 * Throws if the NDK instance has no signer set.
 */
export async function signNip98AuthHeader(
  ndk: NDK,
  opts: { method: string; url: string; bodyString?: string }
): Promise<string> {
  if (!ndk.signer) {
    throw new Error('NIP-98 signing requires an NDK signer (not logged in?)');
  }

  const template = new NDKEvent(ndk);
  template.kind = 27235;
  template.created_at = Math.floor(Date.now() / 1000);
  template.content = '';
  const tags: string[][] = [
    ['u', normalizeUrl(opts.url)],
    ['method', opts.method.toUpperCase()]
  ];
  if (opts.bodyString !== undefined) {
    const hex = await sha256Hex(new TextEncoder().encode(opts.bodyString));
    tags.push(['payload', hex]);
  }
  template.tags = tags;

  await template.sign();

  const authEvent = {
    id: template.id,
    pubkey: template.pubkey,
    created_at: template.created_at,
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    sig: template.sig
  };

  return `Nostr ${btoa(JSON.stringify(authEvent))}`;
}
