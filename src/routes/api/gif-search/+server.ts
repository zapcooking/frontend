import type { RequestHandler } from './$types';
import { proxyGifRequest } from '$lib/gifProxy.server';

/**
 * GET /api/gif-search?q=&limit=&offset= — GIF search against
 * gifs.nostr.build, proxied so the API key stays server-side
 * (see gifProxy.server.ts).
 */
export const GET: RequestHandler = ({ url }) => proxyGifRequest('search', url.searchParams);
