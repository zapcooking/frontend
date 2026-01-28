/**
 * GET /api/debug-shortlink/:code - Debug endpoint to check KV lookup
 * Returns the raw KV lookup result for debugging
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import type { ShortenedURL } from '$lib/shortlinks/types';
import { normalizeShortCode } from '$lib/shortlinks/code';

export const GET: RequestHandler = async ({ params, platform }) => {
  const kv = platform?.env?.SHORTLINKS;
  
  const debug = {
    code: params?.code,
    normalizedCode: params?.code ? normalizeShortCode(params.code) : null,
    kvAvailable: !!kv,
    record: null as ShortenedURL | null,
    error: null as string | null
  };

  if (!kv) {
    debug.error = 'KV not available';
    return json(debug);
  }

  try {
    const key = normalizeShortCode(params?.code || '');
    debug.normalizedCode = key;
    
    const record = await kv.get(key, 'json') as ShortenedURL | null;
    debug.record = record;
    
    if (!record) {
      debug.error = 'Record not found in KV';
    }
  } catch (err) {
    debug.error = `KV lookup error: ${err instanceof Error ? err.message : String(err)}`;
  }

  return json(debug);
};
