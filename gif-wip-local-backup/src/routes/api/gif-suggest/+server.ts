import type { RequestHandler } from './$types';
import { proxyGifRequest } from '$lib/gifProxy.server';

/**
 * GET /api/gif-suggest?q= — search-term suggestions against
 * gifs.nostr.build, proxied so the API key stays server-side
 * (see gifProxy.server.ts).
 */
export const GET: RequestHandler = ({ url }) => proxyGifRequest('suggest', url.searchParams);
