/**
 * Cheffy Fridge Scanner API (route kept at /api/zappy/scan for
 * backwards-compatibility; the public feature is "Cheffy").
 *
 * Uses OpenAI GPT-4 Vision to analyze fridge/pantry images and detect ingredients.
 * Included with any active membership (Cook+, Pro Kitchen, Founders).
 *
 * POST /api/zappy/scan
 * Requires NIP-98 HTTP auth (kind-27235 Authorization header with
 * body-hash payload binding — the note-review / ask-photo pattern).
 *
 * Body:
 * {
 *   image: string (base64 encoded image)
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
 * The membership gate used to read a `pubkey` off this endpoint's own
 * request body. A body pubkey is an identity claim, not an identity —
 * npubs are public by construction, so one member npub read off a relay
 * bought free vision calls. The pubkey now comes back verified from
 * `verifyNip98` and the body field is gone; ask-photo already refused to
 * repeat the old shape (see its header comment).
 *
 * The fail-OPEN posture on membership-service errors is UNCHANGED here —
 * unlike note-review and ask-photo, which fail closed. That divergence is
 * tracked in https://github.com/zapcooking/frontend/issues/512 and is a
 * separate decision from authentication.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { CHEFFY_VISION_MODEL } from '$lib/cheffyPrompt.server';
import { verifyNip98 } from '$lib/nip98.server';
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

    // Read the body ONCE as raw bytes — the same bytes feed the NIP-98
    // payload-hash check and the JSON parse (note-review / ask-photo
    // pattern; `request.json()` here would consume it first).
    let bodyBytes: Uint8Array;
    try {
      bodyBytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes)) as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const { image } = body ?? {};

    // Validate request
    if (!image || typeof image !== 'string') {
      return json({ ok: false, error: 'Image data is required' }, { status: 400 });
    }

    // Check image size (rough estimate: base64 is ~33% larger than binary)
    // Limit to ~10MB original = ~13MB base64
    if (image.length > 13 * 1024 * 1024) {
      return json(
        { ok: false, error: 'Image too large. Please use a smaller image.' },
        { status: 400 }
      );
    }

    // NIP-98: proves key control and binds the header to this exact
    // body. Uniform 401 regardless of failure reason (no info leak); the
    // reason is logged for greppable diagnostics.
    const verification = await verifyNip98(request, { bodyBytes });
    if (!verification.ok) {
      console.warn(`[Zappy Scan] NIP-98 rejected (${verification.reason})`);
      return json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const pubkey = verification.pubkey;

    // Check membership status (any active membership). The "no pubkey"
    // 403 that used to sit here is gone: verifyNip98 above cannot succeed
    // without one, so it was unreachable rather than removed.
    const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
    if (MEMBERSHIP_ENABLED?.toLowerCase() === 'true') {
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
          // Fail open ONLY for membership-service outages. An
          // unauthenticated caller never gets this far — the 401 above
          // is not subject to this.
        }
      }
    }

    // Per-IP cap on the vision model. Sits above the OpenAI call so a
    // limited request costs nothing, and below the membership gate so a
    // non-member's 403 doesn't consume a member's quota.
    //
    // STILL keyed on the client address, NOT on the (now verified)
    // pubkey — and that is deliberate, not a leftover.
    //
    // note-review and ask-photo key on the pubkey because a verified
    // pubkey is a strictly better identity than an IP, and both fail
    // CLOSED on any membership problem, so reaching their limiter at all
    // means somebody paid. This endpoint fails OPEN (see the header
    // comment and issue #512), and when MEMBERSHIP_ENABLED is off it has
    // no membership gate at all. In either of those states a keypair is
    // free to mint, so a pubkey-keyed bucket would be no ceiling on the
    // vision spend whatsoever. The IP bucket is the only cost ceiling
    // that survives a membership outage.
    //
    // Move this to the pubkey when — and only when — this endpoint fails
    // closed like its siblings. The two go together.
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
