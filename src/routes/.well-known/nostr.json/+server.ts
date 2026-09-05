/**
 * NIP-05 nostr.json endpoint
 *
 * Serves the NIP-05 mapping file at /.well-known/nostr.json
 * Fetches dynamic NIP-05 mappings from pantry.zap.cooking and merges with static names
 *
 * GET /.well-known/nostr.json
 *
 * Returns:
 * {
 *   names: {
 *     username: pubkey (hex),
 *     ...
 *   }
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { STATIC_NAMES, loadHandleDirectory } from '$lib/handleDirectory.server';

export const GET: RequestHandler = async ({ setHeaders }) => {
  // Set CORS headers for NIP-05 compliance
  setHeaders({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
  });

  // Static names take precedence over dynamic member names (see
  // loadHandleDirectory); on pantry failure the static names still serve.
  const names = await loadHandleDirectory();
  return json({ names });
};
