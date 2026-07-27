/**
 * Cheffy Fridge Scanner API (route kept at /api/zappy/scan for
 * backwards-compatibility; the public feature is "Cheffy").
 *
 * Uses OpenAI GPT-4 Vision to analyze fridge/pantry images and detect ingredients.
 * Included with any active membership (Cook+, Pro Kitchen, Founders).
 *
 * POST /api/zappy/scan
 *
 * Body:
 * {
 *   image: string (base64 encoded image),
 *   pubkey?: string
 * }
 *
 * Returns:
 * {
 *   ok: true,
 *   ingredients: string[]
 * }
 * or
 * {
 *   ok: false,
 *   error: string
 * }
 * or, at the per-IP cap:
 *   429 { ok: false, code: 'RATE_LIMITED', error: string, retryAfter: number }
 *
 * NOT authenticated. The `pubkey` in the body is unverified — it gates
 * membership but is not proof of identity, so the rate limit below keys
 * on the client address instead. Adding NIP-98 here would change the
 * contract on both callers and is deliberately out of scope.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { CHEFFY_VISION_MODEL } from '$lib/cheffyPrompt.server';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import { SCAN_RATE_LIMIT_LINE } from '$lib/cheffy';

// Same per-IP cap extract-recipe uses for its paid-model path.
const SCAN_PER_HOUR = 8;
const SCAN_PER_DAY = 30;

const SCAN_PROMPT = `You are analyzing a photo of a refrigerator, pantry, or food items for the Zap Cooking app.

Your task is to identify all visible food ingredients and items that could be used in cooking.

Rules:
1. List ONLY actual food ingredients you can clearly see
2. Be specific but practical (e.g., "chicken breast" not just "meat", "cheddar cheese" not just "cheese" if identifiable)
3. Include condiments, sauces, and seasonings if visible
4. Include beverages only if they're commonly used in cooking (milk, wine, beer, etc.)
5. Ignore non-food items, packaging, and containers unless the food inside is identifiable
6. If you can't identify something clearly, skip it
7. Keep ingredient names simple and commonly used (e.g., "eggs" not "large grade A eggs")

Respond with ONLY a JSON array of ingredient names, nothing else. Example:
["eggs", "milk", "butter", "cheddar cheese", "bacon", "spinach", "tomatoes", "garlic"]

If no food items are clearly visible, respond with an empty array: []`;

export const POST: RequestHandler = async ({ request, getClientAddress, platform }) => {
  try {
    // Check for OpenAI API key
    const OPENAI_API_KEY = (platform?.env as any)?.OPENAI_API_KEY || env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return json({ ok: false, error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { image, pubkey } = body;

    // Validate request
    if (!image || typeof image !== 'string') {
      return json({ ok: false, error: 'Image data is required' }, { status: 400 });
    }

    // Sized to hold the base64 expansion of the client's own file cap,
    // rather than estimated. Both scan surfaces reject above
    // PHOTO_MAX_BYTES (10 MiB) and say "try one under 10MB"; base64 is
    // 4/3 of the input, so a file at exactly that cap encodes to ~13.33
    // MiB. The previous 13 MiB wire cap was fractionally SMALLER than
    // what the client lets through, so the top ~2.5% of allowed files
    // uploaded and were then rejected here — after the wait, with a
    // sentence that contradicts the one the composer just showed.
    //
    // A size limit is a chain, not a number: the gate a member meets
    // first has to be the strictest, and every gate downstream strictly
    // looser. ask-photo/+server.ts already sizes IMAGE_MAX_CHARS this
    // way for the same reason.
    if (image.length > 14 * 1024 * 1024) {
      return json(
        { ok: false, error: 'Image too large. Please use a smaller image.' },
        { status: 400 }
      );
    }

    // Check membership status (any active membership). Fail CLOSED when
    // gating is enabled but the caller sent no pubkey — otherwise a
    // non-member could reach this paid endpoint just by omitting it.
    const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
    if (MEMBERSHIP_ENABLED?.toLowerCase() === 'true') {
      if (!pubkey || typeof pubkey !== 'string' || !pubkey.trim()) {
        return json(
          { ok: false, error: 'Cheffy is available to Cook+ members.' },
          { status: 403 }
        );
      }
      const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
      if (API_SECRET) {
        try {
          const { hasActiveMembership } = await import('$lib/membershipApi.server');
          const isActive = await hasActiveMembership(pubkey, API_SECRET);
          if (!isActive) {
            return json(
              { ok: false, error: 'Cheffy is available to Cook+ members.' },
              { status: 403 }
            );
          }
        } catch (err) {
          console.error('[Zappy Scan] Error checking membership:', err);
          // Fail open ONLY for membership-service outages, not for a
          // missing pubkey (handled above).
        }
      }
    }

    // Per-IP cap on the vision model. Sits above the OpenAI call so a
    // limited request costs nothing, and below the membership gate so a
    // non-member's 403 doesn't consume a member's quota.
    //
    // Keyed on the client address, NOT on `pubkey`. Unlike note-review —
    // where the pubkey comes back verified from `verifyNip98` and is a
    // strictly better identity than an IP — the `pubkey` here is an
    // unverified string off the request body (see the destructure above).
    // A pubkey-keyed bucket would be reset by typing a different pubkey,
    // which is the exact hole this is meant to close.
    let ip = '127.0.0.1';
    try {
      ip = getClientAddress();
    } catch {
      // Local dev / missing CF headers.
    }
    // checkPerIpRateLimit fails open silently when no KV is bound; be
    // loud about it here so a missing binding shows up in logs instead
    // of quietly leaving this endpoint unmetered.
    const kv = platform?.env?.NOURISH_FLAGS;
    if (!kv) {
      console.warn('[Zappy Scan] NOURISH_FLAGS KV not bound — scan rate limiting is disabled');
    }
    const rl = await checkPerIpRateLimit(kv, {
      ip,
      scope: 'zappy-scan',
      perHour: SCAN_PER_HOUR,
      perDay: SCAN_PER_DAY
    });
    if (rl.limited) {
      // Not the limiter's bare body: both callers render `data.error`
      // straight into the scan error UI (CheffyMessenger.svelte:232,
      // cheffy/+page.svelte:560), so `rl.body.error` would put the raw
      // token `rate_limited` on screen. Same `ok:false` + `code` shape
      // note-review uses for its 429.
      return json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: SCAN_RATE_LIMIT_LINE,
          retryAfter: rl.body.retryAfter
        },
        { status: 429 }
      );
    }

    // Detect image type from base64 header or default to jpeg
    let mimeType = 'image/jpeg';
    if (image.startsWith('/9j/')) {
      mimeType = 'image/jpeg';
    } else if (image.startsWith('iVBOR')) {
      mimeType = 'image/png';
    } else if (image.startsWith('R0lGOD')) {
      mimeType = 'image/gif';
    } else if (image.startsWith('UklGR')) {
      mimeType = 'image/webp';
    }

    // Call OpenAI Vision API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: CHEFFY_VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: SCAN_PROMPT
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${image}`,
                  detail: 'low' // Use low detail for faster/cheaper processing
                }
              }
            ]
          }
        ],
        max_tokens: 500,
        temperature: 0.3 // Lower temperature for more consistent results
      })
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json().catch(() => ({}));
      console.error('[Zappy Scan] OpenAI API error:', errorData);
      return json(
        { ok: false, error: 'Failed to analyze image. Please try again.' },
        { status: 500 }
      );
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content;

    if (!content) {
      return json({ ok: false, error: 'No response from AI. Please try again.' }, { status: 500 });
    }

    // Parse the JSON array from the response
    let ingredients: string[] = [];
    try {
      // Try to extract JSON array from the response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        ingredients = JSON.parse(jsonMatch[0]);
      }

      // Validate it's an array of strings
      if (!Array.isArray(ingredients)) {
        ingredients = [];
      }

      // Filter to only strings and clean up
      ingredients = ingredients
        .filter((i: any) => typeof i === 'string')
        .map((i: string) => i.trim().toLowerCase())
        .filter((i: string) => i.length > 0 && i.length < 50);

      // Remove duplicates
      ingredients = [...new Set(ingredients)];
    } catch (parseErr) {
      console.error('[Zappy Scan] Failed to parse ingredients:', parseErr, content);
      return json(
        { ok: false, error: 'Failed to parse detected ingredients. Please try again.' },
        { status: 500 }
      );
    }

    return json({
      ok: true,
      ingredients
    });
  } catch (error: any) {
    console.error('[Zappy Scan] Error:', error);
    return json(
      { ok: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    );
  }
};
