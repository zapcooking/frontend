/**
 * Cheffy "Ask about a photo" API.
 *
 * A member attaches a photo in the Cheffy composer, types a question,
 * and Cheffy answers it in the thread. One vision call per attached
 * photo. The image arrives base64-in-request and is never stored, never
 * added to conversation history, and never reaches /api/zappy.
 *
 * This is the general path the attach menu always promised. The
 * ingredient scanner (/api/zappy/scan) keeps its own narrow job:
 * fridge/pantry photo in, ingredient list out.
 *
 * POST /api/zappy/ask-photo
 * Requires NIP-98 HTTP auth (kind-27235 Authorization header with
 * body-hash payload binding — the note-review / extract-recipe pattern).
 *
 * Body:
 * {
 *   image: string,     // base64, no data: prefix
 *   question?: string  // the member's own question; defaults server-side
 * }
 *
 * Returns:
 *   { ok: true, output: string }
 *   { ok: false, error: string, code?: "NOT_MEMBER" |
 *     "MEMBERSHIP_UNAVAILABLE" | "RATE_LIMITED" | "NOT_FOOD" | "IMAGE_UNREADABLE" }
 *
 * DELIBERATE DEVIATION from /api/zappy/scan, the closest sibling: this
 * endpoint authenticates with NIP-98 rather than gating on a pubkey
 * supplied in its own request body. A body pubkey is an identity claim,
 * not an identity — npubs are public by construction, so one member npub
 * read off a relay would buy free vision calls. Fixing scan's gate is a
 * separate, real piece of work; this endpoint simply does not repeat it.
 *
 * Like note-review (decision D5), this fails CLOSED when the membership
 * service is unreachable (503 MEMBERSHIP_UNAVAILABLE) — vision calls
 * cost money and there are no legacy callers to strand. Fail-open
 * consistency across the zappy endpoints is tracked in
 * https://github.com/zapcooking/frontend/issues/512.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifyNip98 } from '$lib/nip98.server';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import {
  CHEFFY_VISION_MODEL,
  CHEFFY_PHOTO_ASK_INSTRUCTION,
  PHOTO_ASK_DEFAULT_QUESTION,
  NOT_FOOD_PREFIX
} from '$lib/cheffyPrompt.server';

// The member's own question — trimmed and capped, never an error. A
// longer question just loses its tail. Unexported on purpose: SvelteKit
// only allows handler exports from +server.ts. Client mirror: photoAsk.ts.
const QUESTION_MAX_CHARS = 500;

// The client cap is 10 MiB of FILE (photoAsk.PHOTO_MAX_BYTES), and the
// composer tells the member "try one under 10MB". Base64 is 4/3 of the
// input, so a file at exactly that cap encodes to ~13.33 MiB. Sized here
// to actually cover the promise rather than estimated.
//
// scan/+server.ts had the same gap with a 13 MiB cap and a comment that
// claimed otherwise; it now matches this number, for this reason.
const IMAGE_MAX_CHARS = 14 * 1024 * 1024;

// Per-pubkey budget. NIP-98 gives a verified identity, so the bucket key
// is the pubkey rather than the caller's IP. Same caps as note-review.
const PER_HOUR = 8;
const PER_DAY = 30;

// "How do I make this?" answers with a full structured recipe, so the
// cap matches note-review's recipe mode rather than its comment mode.
const MAX_TOKENS = 1200;

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const OPENAI_API_KEY = (platform?.env as any)?.OPENAI_API_KEY || env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return json({ ok: false, error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Read the body ONCE as raw bytes — the same bytes feed the NIP-98
    // payload-hash check and the JSON parse (note-review pattern).
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

    const { image, question } = body ?? {};

    if (typeof image !== 'string' || image.length === 0) {
      return json({ ok: false, error: 'Image data is required' }, { status: 400 });
    }
    if (image.length > IMAGE_MAX_CHARS) {
      return json(
        { ok: false, error: 'Image too large. Please use a smaller image.' },
        { status: 400 }
      );
    }

    // Empty or absent question → the server-side default, so the model
    // always gets a real ask and the wire never carries an empty turn.
    const askedQuestion =
      typeof question === 'string' && question.trim()
        ? question.trim().slice(0, QUESTION_MAX_CHARS)
        : PHOTO_ASK_DEFAULT_QUESTION;

    // NIP-98: proves key control and binds the header to this exact
    // body. Uniform 401 regardless of failure reason (no info leak); the
    // reason is logged for greppable diagnostics.
    const verification = await verifyNip98(request, { bodyBytes });
    if (!verification.ok) {
      console.warn(`[Photo Ask] NIP-98 rejected (${verification.reason})`);
      return json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const authPubkey = verification.pubkey;

    // Membership gate (any active membership). FAILS CLOSED on
    // membership-service problems — see the header comment and issue
    // #512 before "fixing" this to match scan.
    const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
    if (MEMBERSHIP_ENABLED?.toLowerCase() === 'true') {
      const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
      if (!API_SECRET) {
        // Gating on but no secret is a deploy misconfiguration; treat it
        // like an outage rather than silently waving callers through.
        console.error('[Photo Ask] MEMBERSHIP_ENABLED without RELAY_API_SECRET');
        return json(
          {
            ok: false,
            code: 'MEMBERSHIP_UNAVAILABLE',
            error: "Cheffy can't check your membership right now. Please try again shortly."
          },
          { status: 503 }
        );
      }
      let isMember = false;
      try {
        const { hasActiveMembership } = await import('$lib/membershipApi.server');
        isMember = await hasActiveMembership(authPubkey, API_SECRET);
      } catch (err) {
        console.error('[Photo Ask] Membership check failed (failing closed):', err);
        return json(
          {
            ok: false,
            code: 'MEMBERSHIP_UNAVAILABLE',
            error: "Cheffy can't check your membership right now. Please try again shortly."
          },
          { status: 503 }
        );
      }
      if (!isMember) {
        return json(
          { ok: false, code: 'NOT_MEMBER', error: 'Cheffy is available to Cook+ members.' },
          { status: 403 }
        );
      }
    }

    // Per-pubkey rate limit, backed by the NOURISH_FLAGS KV namespace.
    // The helper's `ip` param is just the string salted + hashed into
    // the bucket key — a verified pubkey is a strictly better identity
    // for it than an IP. checkPerIpRateLimit fails open silently when no
    // KV is bound; be loud about it here so a missing binding shows up
    // in logs instead of quietly unmetering the endpoint.
    //
    // This is the cost ceiling for the whole feature: 8/hour, 30/day per
    // member, one vision call each.
    const kv = platform?.env?.NOURISH_FLAGS;
    if (!kv) {
      console.warn('[Photo Ask] NOURISH_FLAGS KV not bound — photo-ask rate limiting is disabled');
    }
    const rl = await checkPerIpRateLimit(kv, {
      ip: authPubkey,
      scope: 'photo-ask',
      perHour: PER_HOUR,
      perDay: PER_DAY
    });
    if (rl.limited) {
      return json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          // "Give it a little while" is load-bearing, and NOT because
          // this is the only line on screen — a rate-limited photo turn
          // keeps its Try again button (isPhotoAskRetryable), and that
          // button is the reason the clause has to be here: it is the
          // only thing telling the member that pressing it right now
          // won't help. No number — two limits can fire (PER_HOUR,
          // PER_DAY) and the response doesn't say which, so a count
          // would be a claim we can't source per-hit.
          error:
            "Cheffy needs a breather — you've hit the photo limit for now. Give it a little while and try again.",
          retryAfter: rl.body.retryAfter
        },
        { status: 429 }
      );
    }

    // Detect image type from the base64 header or default to jpeg
    // (scan's detection, unchanged).
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

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: CHEFFY_VISION_MODEL,
        messages: [
          { role: 'system', content: CHEFFY_PHOTO_ASK_INSTRUCTION },
          {
            role: 'user',
            content: [
              { type: 'text', text: askedQuestion },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${image}`,
                  // 'high', unlike scan and note-review. Enumerating jars
                  // on a shelf works at low detail; identifying a plated
                  // dish does not, and identifying the dish is the whole
                  // feature. This is the single knob that moves per-call
                  // cost — the usage log below is how we measure it.
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: MAX_TOKENS,
        temperature: 0.7
      })
    });

    if (!openaiResponse.ok) {
      const errorData: any = await openaiResponse.json().catch(() => ({}));
      const errCode = errorData?.error?.code || '';
      const errMessage = errorData?.error?.message || '';
      // OpenAI couldn't decode the image (corrupt file, unsupported
      // format that slipped past the client's mime check). Typed so the
      // client can render a friendly dead-end rather than a raw error.
      if (
        errCode.includes('image') ||
        /downloading|image_url|unsupported image|invalid image/i.test(errMessage)
      ) {
        console.warn(`[Photo Ask] Image unreadable: ${errCode} ${errMessage}`);
        return json(
          {
            ok: false,
            code: 'IMAGE_UNREADABLE',
            error: "Cheffy couldn't get a good look at that photo. Try another one?"
          },
          { status: 422 }
        );
      }
      console.error('[Photo Ask] OpenAI API error:', errorData);
      return json(
        { ok: false, error: 'Cheffy could not finish that one. Please try again.' },
        { status: 500 }
      );
    }

    const openaiData = await openaiResponse.json();
    const output: string | undefined = openaiData.choices?.[0]?.message?.content;
    if (!output || !output.trim()) {
      return json(
        { ok: false, error: 'Cheffy went quiet for a second. Please try again.' },
        { status: 500 }
      );
    }

    // Measured, not modelled. `detail: 'high'` is the one variable in
    // this feature's cost, so every completed call reports its token
    // usage from day one — week-one logs give a real per-call number
    // instead of an estimate. Deliberately above the NOT_FOOD check: a
    // refusal still spent a vision call and still belongs in the total.
    if (openaiData.usage) {
      const u = openaiData.usage;
      console.log(
        `[Photo Ask] usage model=${CHEFFY_VISION_MODEL} detail=high prompt=${u.prompt_tokens} completion=${u.completion_tokens} total=${u.total_tokens}`
      );
    }

    // Prompt-level refusal: the photo isn't food. Typed so the client
    // can land Cheffy's playful line in the thread as an answer rather
    // than as an error bubble.
    const trimmed = output.trim();
    if (trimmed.startsWith(NOT_FOOD_PREFIX)) {
      const line = trimmed.slice(NOT_FOOD_PREFIX.length).trim();
      return json(
        {
          ok: false,
          code: 'NOT_FOOD',
          error: line || "That doesn't look like food to Cheffy — try a photo of a dish."
        },
        { status: 422 }
      );
    }

    return json({ ok: true, output: trimmed });
  } catch (error: any) {
    console.error('[Photo Ask] Error:', error);
    return json(
      { ok: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    );
  }
};
