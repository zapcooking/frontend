import type NDK from '@nostr-dev-kit/ndk';
import { signNip98AuthHeader } from '$lib/nip98';

/**
 * Headers for a Nourish API call. Identity travels as a NIP-98 signature
 * over the exact request (method, absolute URL, body hash); the server
 * derives the caller's pubkey from it and ignores any `pubkey` in the body.
 *
 * Without a signer (signed out) the call goes out unsigned and the server
 * answers 401 when the membership gate is on — the UI already treats a
 * failed compute as "sign in / become a member".
 */
export async function nourishRequestHeaders(
  ndk: NDK,
  path: string,
  bodyString: string
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!ndk.signer) return headers;
  headers.Authorization = await signNip98AuthHeader(ndk, {
    method: 'POST',
    url: new URL(path, window.location.origin).toString(),
    bodyString
  });
  return headers;
}
