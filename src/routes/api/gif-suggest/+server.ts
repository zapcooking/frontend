import type { RequestHandler } from './$types';
import { proxyGifRequest } from '$lib/gifProxy.server';

/**
 * GET /api/gif-suggest?q= — search-term suggestions against
 * gifs.nostr.build, proxied so the API key stays server-side and callers are
 * rate-limited per IP (see gifProxy.server.ts).
 */
export const GET: RequestHandler = ({ url, platform, getClientAddress }) => {
  let ip = '127.0.0.1';
  try {
    ip = getClientAddress();
  } catch {
    // Local dev / missing CF headers.
  }
  return proxyGifRequest('suggest', url.searchParams, { ip, kv: platform?.env?.NOURISH_FLAGS });
};
