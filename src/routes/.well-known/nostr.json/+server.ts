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

// Static names that should always be included
const STATIC_NAMES: Record<string, string> = {
  "jack": "c5fb6ecc876e0458e3eca9918e370cbcd376901c58460512fe537a46e58c38bb",
  "_": "319ad3e790634dbe86f14db9c2995b26ee3c6228be55f89c4c7fea9acc01d50a",
  "seth": "a723805cda67251191c8786f4da58f797e6977582301354ba8e91bcb0342dc9c",
  "daniel": "ee6ea13ab9fe5c4a68eaf9b1a34fe014a66b40117c50ee2a614f4cda959b6e74"
};

export const GET: RequestHandler = async ({ setHeaders }) => {
  // Set CORS headers for NIP-05 compliance
  setHeaders({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
  });

  try {
    // Fetch dynamic NIP-05 mappings from pantry.zap.cooking
    const membersRes = await fetch('https://pantry.zap.cooking/.well-known/nostr.json', {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    let dynamicNames: Record<string, string> = {};

    if (membersRes.ok) {
      try {
        const membersData = await membersRes.json();
        if (membersData.names && typeof membersData.names === 'object') {
          dynamicNames = membersData.names;
        }
      } catch (e) {
        console.error('[NIP-05] Error parsing members nostr.json:', e);
        // Continue with static names only if fetch fails
      }
    } else {
      console.warn('[NIP-05] Members API returned non-OK status:', membersRes.status);
      // Continue with static names only if fetch fails
    }

    // Merge static names with dynamic names (static names take precedence)
    const mergedNames = {
      ...dynamicNames,
      ...STATIC_NAMES
    };

    return json({
      names: mergedNames
    });

  } catch (error: any) {
    console.error('[NIP-05] Error fetching nostr.json:', error);
    
    // Fallback to static names only if fetch fails
    return json({
      names: STATIC_NAMES
    });
  }
};