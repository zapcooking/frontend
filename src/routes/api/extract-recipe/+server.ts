/**
 * POST /api/extract-recipe — authenticated recipe import.
 *
 * Accepts image (vision), text, or URL input and returns a normalized
 * recipe via `parseRecipe`. Gating rules changed in the free-URL-import
 * rollout:
 *
 *   - type: 'url'          — free for everyone (anon + members). The
 *                            anon-hero entry point lives at the sibling
 *                            `/api/extract-recipe/public` endpoint, which
 *                            is stricter (URL only, per-IP cap, no
 *                            pubkey field). This endpoint also accepts
 *                            URL for logged-in callers as a convenience
 *                            so the souschef page doesn't need a split.
 *                            The same per-IP rate limit applies so this
 *                            endpoint can't be used as a quieter bypass
 *                            of /public's cap.
 *   - type: 'image'|'text' — requires active membership (any tier).
 *                            Identity is proven via NIP-98 HTTP Auth
 *                            (kind-27235 Authorization header). Legacy
 *                            body-pubkey auth remains behind
 *                            EXTRACT_LEGACY_AUTH for rollout compatibility.
 *
 * The "pubkey optional" part: for URL imports `pubkey` is no longer
 * required in the request body. The field is still accepted so existing
 * callers (souschef page) don't need a simultaneous change, but its
 * presence is no longer load-bearing for URL.
 *
 * Response shape is unchanged from prior versions.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { parseRecipe, type ParseInput } from '$lib/parseRecipe.server';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import { verifyNip98 } from '$lib/nip98.server';

// URL imports on this endpoint share the same per-IP cap as the public
// sibling so a caller can't route around /public/'s rate limit by
// hitting this route without a pubkey. Image/text don't need a cap
// here — they're already gated to active members above.
const URL_PER_HOUR = 8;
const URL_PER_DAY = 30;

export const POST: RequestHandler = async ({ request, getClientAddress, platform }) => {
  try {
    const OPENAI_API_KEY = platform?.env?.OPENAI_API_KEY || env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return json({ success: false, error: 'OpenAI API key not configured' }, { status: 500 });
    }

    let bodyBytes: Uint8Array;
    try {
      bodyBytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes)) as Record<string, unknown>;
    } catch {
      return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const { type, imageData, url, pubkey, textData } = body ?? {};

    if (type !== 'image' && type !== 'url' && type !== 'text') {
      return json(
        { success: false, error: 'Invalid type. Must be "image", "url", or "text"' },
        { status: 400 }
      );
    }

    // Gate — image/text remain premium, URL is free for everyone.
    if (type === 'image' || type === 'text') {
      let authPubkey: string;

      if (request.headers.get('Authorization')) {
        const verification = await verifyNip98(request, { bodyBytes });
        if (!verification.ok) {
          return json(
            { success: false, error: 'Authentication required for AI recipe extraction' },
            { status: 401 }
          );
        }
        authPubkey = verification.pubkey;
      } else {
        const legacyAuth = platform?.env?.EXTRACT_LEGACY_AUTH || env.EXTRACT_LEGACY_AUTH;
        if (legacyAuth?.toLowerCase() === 'true') {
          console.log('extract-recipe: legacy body-pubkey auth used');
          if (typeof pubkey !== 'string' || pubkey.trim().length === 0) {
            return json(
              { success: false, error: 'Authentication required for AI recipe extraction' },
              { status: 401 }
            );
          }
          authPubkey = pubkey.trim();
        } else {
          return json(
            { success: false, error: 'Authentication required for AI recipe extraction' },
            { status: 401 }
          );
        }
      }

      const MEMBERSHIP_ENABLED =
        platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
      if (MEMBERSHIP_ENABLED?.toLowerCase() === 'true') {
        const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
        if (API_SECRET) {
          try {
            const { hasActiveMembership } = await import('$lib/membershipApi.server');
            const isActive = await hasActiveMembership(authPubkey, API_SECRET);
            if (!isActive) {
              return json(
                { success: false, error: 'Premium membership required for AI recipe extraction' },
                { status: 403 }
              );
            }
          } catch (err) {
            console.error('[Extract Recipe] Error checking membership:', err);
            // Fail open on membership-API outage — better than stranding
            // legitimate paid members.
          }
        }
      }
    }

    let input: ParseInput;
    if (type === 'image') {
      if (typeof imageData !== 'string' || imageData.length === 0) {
        return json(
          { success: false, error: 'Image data is required for image extraction' },
          { status: 400 }
        );
      }
      input = { type: 'image', imageData };
    } else if (type === 'url') {
      if (typeof url !== 'string' || url.trim().length === 0) {
        return json(
          { success: false, error: 'URL is required for URL extraction' },
          { status: 400 }
        );
      }

      // Per-IP cap — prevents this endpoint from being used as a
      // quieter bypass of /api/extract-recipe/public's rate limit.
      let ip = '127.0.0.1';
      try {
        ip = getClientAddress();
      } catch {
        // Local dev / missing CF headers.
      }
      const kv = platform?.env?.NOURISH_FLAGS;
      const rl = await checkPerIpRateLimit(kv, {
        ip,
        scope: 'extract-url',
        perHour: URL_PER_HOUR,
        perDay: URL_PER_DAY
      });
      if (rl.limited) {
        return json(rl.body, { status: 429 });
      }

      input = { type: 'url', url };
    } else {
      if (typeof textData !== 'string' || textData.trim().length === 0) {
        return json({ success: false, error: 'Recipe text is required' }, { status: 400 });
      }
      input = { type: 'text', textData };
    }

    const result = await parseRecipe(OPENAI_API_KEY, input);
    if (!result.ok) {
      return json({ success: false, error: result.error }, { status: result.status });
    }

    return json({ success: true, recipe: result.recipe });
  } catch (err) {
    console.error('[Extract Recipe] Error:', err);
    const message = err instanceof Error ? err.message : 'An unexpected error occurred';
    return json({ success: false, error: message }, { status: 500 });
  }
};
