/**
 * Cheffy Note Photo Review API.
 *
 * A Pro Kitchen member points Cheffy at a food photo in a kind-1 feed
 * note; Cheffy drafts either a warm reply-comment or a reverse-
 * engineered recipe. The draft is ONLY a draft — the member edits and
 * signs the eventual reply themselves (client-side, via postComment).
 * Nothing this endpoint returns is ever published automatically.
 *
 * POST /api/zappy/note-review
 * Requires NIP-98 HTTP auth (kind-27235 Authorization header with
 * body-hash payload binding — same pattern as /api/extract-recipe).
 * No legacy body-pubkey fallback: this endpoint has no pre-NIP-98 callers.
 *
 * Body:
 * {
 *   imageUrl: string,          // https image URL from the note (OpenAI fetches it — we never do)
 *   mode: "comment" | "recipe",
 *   noteText?: string,         // note content for context; untrusted, capped
 *   noteId?: string,           // event id hex, logging only
 *   experience?: true          // non-member preview request (HttpOnly cookie budget)
 * }
 *
 * Returns:
 *   { ok: true, output: string, mode: string }
 *   { ok: false, error: string, code?: "NOT_MEMBER" | "PREVIEW_USED" |
 *     "MEMBERSHIP_UNAVAILABLE" | "RATE_LIMITED" | "NOT_FOOD" | "IMAGE_UNREADABLE" }
 *
 * DELIBERATE DEVIATION (decision D5, 2026-07): this endpoint fails
 * CLOSED when the membership service is unreachable (503
 * MEMBERSHIP_UNAVAILABLE), unlike /api/zappy, /api/zappy/scan, and
 * /api/extract-recipe, which all fail open. New endpoint, no legacy
 * callers to strand, and vision calls cost money. Revisiting fail-open
 * consistency across all four endpoints is tracked in
 * https://github.com/zapcooking/frontend/issues/512.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifyNip98 } from '$lib/nip98.server';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';
import { isImageUrl } from '$lib/imageUrls';
import {
  CHEFFY_VISION_MODEL,
  NOTE_REVIEW_COMMENT_INSTRUCTION,
  NOTE_REVIEW_RECIPE_INSTRUCTION,
  NOT_FOOD_PREFIX,
  buildNoteReviewUserText
} from '$lib/cheffyPrompt.server';

// The note author's text is context, not a prompt — cap it hard.
const NOTE_TEXT_MAX_CHARS = 1000;
const IMAGE_URL_MAX_CHARS = 2048;

// Per-pubkey budget (NIP-98 gives us a verified identity, so the key is
// the pubkey — not the caller's IP). Mirrors the extract-recipe caps.
// Regenerates share the same budget.
const PER_HOUR = 8;
const PER_DAY = 30;

// Draft size caps: a reply-comment is a few sentences; a recipe needs
// room for the full structured format.
const COMMENT_MAX_TOKENS = 600;
const RECIPE_MAX_TOKENS = 1200;

// Non-member preview — same pattern as Cheffy chat (3 success-counted
// turns per device via HttpOnly cookie) with a dedicated cookie so the
// two features' budgets never collide.
const EXPERIENCE_COOKIE = 'zapcooking_cheffy_note_review_experience_used';
const EXPERIENCE_MAX_TURNS = 3;
const EXPERIENCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // ~180 days

export const POST: RequestHandler = async ({ request, platform, cookies, url }) => {
  try {
    const OPENAI_API_KEY = (platform?.env as any)?.OPENAI_API_KEY || env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return json({ ok: false, error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Read the body ONCE as raw bytes — the same bytes feed the NIP-98
    // payload-hash check and the JSON parse (extract-recipe pattern).
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

    const { imageUrl, mode, noteText, noteId } = body ?? {};
    const isExperience = body?.experience === true;

    if (mode !== 'comment' && mode !== 'recipe') {
      return json(
        { ok: false, error: 'Invalid mode. Must be "comment" or "recipe"' },
        { status: 400 }
      );
    }

    // Image URL validation. OpenAI fetches the image, never our infra,
    // so this is not an SSRF guard — it keeps the endpoint from being a
    // free relay for arbitrary-URL prompts and fails fast on obvious
    // non-images.
    if (typeof imageUrl !== 'string' || imageUrl.length === 0) {
      return json({ ok: false, error: 'imageUrl is required' }, { status: 400 });
    }
    if (imageUrl.length > IMAGE_URL_MAX_CHARS) {
      return json({ ok: false, error: 'imageUrl is too long' }, { status: 400 });
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      return json({ ok: false, error: 'imageUrl is not a valid URL' }, { status: 400 });
    }
    if (parsedUrl.protocol !== 'https:') {
      return json({ ok: false, error: 'imageUrl must be https' }, { status: 400 });
    }
    if (!isImageUrl(imageUrl)) {
      return json({ ok: false, error: 'imageUrl does not look like an image' }, { status: 400 });
    }

    // Untrusted note context: trim + hard cap. Never an error — a long
    // note just loses its tail.
    const contextText =
      typeof noteText === 'string' ? noteText.trim().slice(0, NOTE_TEXT_MAX_CHARS) : undefined;

    // Logging key only — never load-bearing for auth or gating.
    const logNoteId =
      typeof noteId === 'string' && /^[0-9a-f]{64}$/i.test(noteId) ? noteId : 'unknown';

    // NIP-98: proves key control and binds the header to this exact
    // body. Uniform 401 regardless of failure reason (no info leak);
    // the reason is logged for greppable diagnostics.
    const verification = await verifyNip98(request, { bodyBytes });
    if (!verification.ok) {
      console.warn(`[Note Review] NIP-98 rejected (${verification.reason}) note=${logNoteId}`);
      return json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }
    const authPubkey = verification.pubkey;

    // Membership gate (Pro Kitchen) with the non-member preview path.
    // FAILS CLOSED on membership-service problems — see header comment
    // and issue #512 before "fixing" this to match the other endpoints.
    let experienceGranted = false;
    let experienceCount = 0;
    const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
    if (MEMBERSHIP_ENABLED?.toLowerCase() === 'true') {
      const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
      let isMember = false;
      if (!API_SECRET) {
        // Gating on but no secret is a deploy misconfiguration; treat it
        // like an outage rather than silently waving callers through.
        console.error('[Note Review] MEMBERSHIP_ENABLED without RELAY_API_SECRET');
        return json(
          {
            ok: false,
            code: 'MEMBERSHIP_UNAVAILABLE',
            error: "Cheffy can't check your membership right now. Please try again shortly."
          },
          { status: 503 }
        );
      }
      try {
        const { hasActiveMembership } = await import('$lib/membershipApi.server');
        isMember = await hasActiveMembership(authPubkey, API_SECRET);
      } catch (err) {
        console.error('[Note Review] Membership check failed (failing closed):', err);
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
        if (!isExperience) {
          return json(
            {
              ok: false,
              code: 'NOT_MEMBER',
              error: 'Cheffy photo review is available to Pro Kitchen members.'
            },
            { status: 403 }
          );
        }
        const prior = parseInt(cookies.get(EXPERIENCE_COOKIE) || '0', 10);
        experienceCount = Number.isFinite(prior) && prior > 0 ? prior : 0;
        if (experienceCount >= EXPERIENCE_MAX_TURNS) {
          return json(
            {
              ok: false,
              code: 'PREVIEW_USED',
              error: 'Unlock Pro Kitchen to keep asking Cheffy about dishes on the feed.'
            },
            { status: 429 }
          );
        }
        experienceGranted = true;
      }
    }

    // Per-pubkey rate limit. The helper's `ip` param is just the string
    // that gets salted + hashed into the bucket key — a verified pubkey
    // is a strictly better identity for it than an IP here.
    const kv = platform?.env?.NOURISH_FLAGS;
    const rl = await checkPerIpRateLimit(kv, {
      ip: authPubkey,
      scope: 'note-review',
      perHour: PER_HOUR,
      perDay: PER_DAY
    });
    if (rl.limited) {
      return json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: "Cheffy needs a breather — you've hit the photo-review limit for now.",
          retryAfter: rl.body.retryAfter
        },
        { status: 429 }
      );
    }

    const isComment = mode === 'comment';
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
            role: 'system',
            content: isComment ? NOTE_REVIEW_COMMENT_INSTRUCTION : NOTE_REVIEW_RECIPE_INSTRUCTION
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: buildNoteReviewUserText(contextText, mode) },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                  detail: 'low' // scanner precedent: cheaper, plenty for a dish photo
                }
              }
            ]
          }
        ],
        max_tokens: isComment ? COMMENT_MAX_TOKENS : RECIPE_MAX_TOKENS,
        // Comments want personality; recipes want structural discipline.
        temperature: isComment ? 0.8 : 0.4
      })
    });

    if (!openaiResponse.ok) {
      const errorData: any = await openaiResponse.json().catch(() => ({}));
      const errCode = errorData?.error?.code || '';
      const errMessage = errorData?.error?.message || '';
      // OpenAI couldn't fetch or decode the image (dead link, hotlink-
      // blocked host, not actually an image). Typed so the client can
      // render Cheffy's "couldn't get a good look" dead-end.
      if (
        errCode.includes('image') ||
        /downloading|image_url|unsupported image|invalid image/i.test(errMessage)
      ) {
        console.warn(`[Note Review] Image unreadable note=${logNoteId}: ${errCode} ${errMessage}`);
        return json(
          {
            ok: false,
            code: 'IMAGE_UNREADABLE',
            error: "Cheffy couldn't get a good look at that photo. The link may be broken."
          },
          { status: 422 }
        );
      }
      console.error('[Note Review] OpenAI API error:', errorData);
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

    // Prompt-level refusal: the photo isn't food. Typed dead-end — the
    // playful line is display copy, never a postable draft.
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

    // Count a preview turn only on a successful draft (chat precedent:
    // failures never burn the visitor's budget).
    if (experienceGranted) {
      const isHttps =
        url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
      cookies.set(EXPERIENCE_COOKIE, String(experienceCount + 1), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps,
        maxAge: EXPERIENCE_COOKIE_MAX_AGE
      });
    }

    return json({ ok: true, output: trimmed, mode });
  } catch (error: any) {
    console.error('[Note Review] Error:', error);
    return json(
      { ok: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    );
  }
};
