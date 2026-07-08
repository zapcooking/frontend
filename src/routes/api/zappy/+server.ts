/**
 * Cheffy API (route kept at /api/zappy for backwards-compatibility — the
 * public feature is "Cheffy"; the internal endpoint name is unchanged so
 * no env vars, analytics, or deployed routes break).
 *
 * Uses OpenAI gpt-4.1-mini to power Cheffy, Zap Cooking's kitchen
 * companion. Premium feature for Pro Kitchen members.
 *
 * POST /api/zappy
 *
 * Body:
 * {
 *   prompt: string,
 *   mode?: "prompt" | "chat" | "hungry" | "format",
 *   pubkey?: string,
 *   // Optional prior turns for session multi-turn conversation. Not
 *   // persisted server-side; the client passes the live thread each
 *   // request. Ignored for "format" (single-shot reformatting).
 *   messages?: { role: "user" | "assistant"; content: string }[]
 * }
 *
 * Returns:
 * {
 *   ok: true,
 *   output: string
 * }
 * or
 * {
 *   ok: false,
 *   error: string
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
// Cheffy's personality and rules live in the shared prompt module (also
// consumed by /api/zappy/note-review) — edit voice there, not here.
import { SYSTEM_INSTRUCTION, FORMAT_SYSTEM_INSTRUCTION } from '$lib/cheffyPrompt.server';

// "Surprise Me" — asks Cheffy for a complete, ready-to-cook recipe so
// the strict format kicks in.
const HUNGRY_PROMPT = `Surprise me with a complete recipe! It could be any cuisine, any meal type — breakfast, lunch, dinner, snack, or dessert. Make it practical, achievable for a home cook, and use ingredients most people have or can easily get. Give me the full recipe to cook.`;

// Keep the live conversation bounded — the client passes the thread on
// every request, so cap turns and per-message length to protect the
// token budget and reject abuse.
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_MESSAGE_CHARS = 4000;

// First-use "experience" — a short controlled preview chat for
// non-members, initiated from the /explore invite. Deliberately NOT a
// "free question" or "trial": it is a handful of smaller discovery
// answers so the visitor gets a real back-and-forth. The turn count is
// enforced with an HttpOnly cookie (localStorage alone is not trusted).
// The endpoint fails CLOSED — non-members get nothing unless the request
// is an explicit, allowed experience request.
const EXPERIENCE_COOKIE = 'zapcooking_cheffy_experience_used';
const EXPERIENCE_MAX_TURNS = 3;
const EXPERIENCE_MAX_HISTORY = 6; // ~3 prior exchanges of context
const EXPERIENCE_MAX_PROMPT_CHARS = 750;
const EXPERIENCE_MAX_TOKENS = 700;
const EXPERIENCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // ~180 days

export const POST: RequestHandler = async ({ request, platform, cookies, url }) => {
  try {
    // Check for OpenAI API key
    const OPENAI_API_KEY = (platform?.env as any)?.OPENAI_API_KEY || env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return json({ ok: false, error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { prompt, mode = 'prompt', pubkey } = body;
    const isExperience = body.experience === true;

    // Validate mode. "chat" and "prompt" are aliases for the
    // conversational path; "prompt" is kept for any older callers.
    const supportedModes = ['prompt', 'chat', 'hungry', 'format'];
    if (!supportedModes.includes(mode)) {
      return json({ ok: false, error: 'Invalid mode' }, { status: 400 });
    }

    const isFormatMode = mode === 'format';
    const isHungry = mode === 'hungry';

    // Validate request (hungry supplies its own prompt server-side)
    if (!isHungry && (!prompt || typeof prompt !== 'string')) {
      return json(
        { ok: false, error: isFormatMode ? 'Recipe text is required' : 'Message is required' },
        { status: 400 }
      );
    }

    // Membership gate (Cheffy is a Pro Kitchen feature) with a single
    // controlled "experience" preview for non-members. Members are
    // unaffected. The experience path is the ONLY way a non-member can
    // reach Cheffy — and only once per device. `experienceGranted` stays
    // false for members, so their answers keep full depth.
    let experienceGranted = false;
    let experienceCount = 0; // preview turns already spent on this device
    const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
    if (MEMBERSHIP_ENABLED?.toLowerCase() === 'true') {
      // Best-effort membership determination. Fail OPEN only for a
      // verifiable, pubkey-bearing caller during a membership-service
      // outage (preserves prior behavior); never for a missing pubkey.
      let isMember = false;
      if (pubkey && typeof pubkey === 'string' && pubkey.trim()) {
        const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
        if (!API_SECRET) {
          // No secret configured — preserve prior fall-through (allow).
          isMember = true;
        } else {
          try {
            const { hasActiveMembership } = await import('$lib/membershipApi.server');
            isMember = await hasActiveMembership(pubkey, API_SECRET);
          } catch (err) {
            console.error('[Cheffy] Error checking membership:', err);
            isMember = true; // outage: fail open for a pubkey-bearing caller
          }
        }
      }

      if (!isMember) {
        // Non-members get the controlled discovery preview only — never
        // recipe formatting, image scanning, or other advanced tools.
        const experienceModeAllowed = mode === 'chat' || mode === 'prompt' || mode === 'hungry';
        if (!isExperience || !experienceModeAllowed) {
          return json(
            { ok: false, error: 'Cheffy is available to Pro Kitchen members.' },
            { status: 403 }
          );
        }
        // A few preview turns per device (HttpOnly cookie counter — not
        // client-trusted). Once spent, invite them to convert.
        const prior = parseInt(cookies.get(EXPERIENCE_COOKIE) || '0', 10);
        experienceCount = Number.isFinite(prior) && prior > 0 ? prior : 0;
        if (experienceCount >= EXPERIENCE_MAX_TURNS) {
          return json(
            {
              ok: false,
              code: 'CHEFFY_EXPERIENCE_USED',
              error: 'Create your free kitchen or unlock Kitchen+ to keep cooking with Cheffy.'
            },
            { status: 429 }
          );
        }
        experienceGranted = true;
      }
    }

    // Limit prompt length. Experience previews are capped tighter; format
    // mode allows longer input for pasted recipes.
    const maxPromptLength = experienceGranted
      ? EXPERIENCE_MAX_PROMPT_CHARS
      : isFormatMode
        ? 10000
        : 2000;
    if (prompt && prompt.length > maxPromptLength) {
      return json(
        { ok: false, error: `Input is too long (max ${maxPromptLength} characters)` },
        { status: 400 }
      );
    }

    // Sanitize optional conversation history (ignored for format mode).
    // The preview keeps a short window so Cheffy can follow the chat.
    let history: { role: 'user' | 'assistant'; content: string }[] = [];
    if (!isFormatMode && Array.isArray(body.messages)) {
      const turnLimit = experienceGranted ? EXPERIENCE_MAX_HISTORY : MAX_HISTORY_TURNS;
      history = body.messages
        .filter(
          (m: any) =>
            m &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            m.content.trim().length > 0
        )
        .slice(-turnLimit)
        .map((m: any) => ({
          role: m.role,
          content: String(m.content).slice(0, MAX_HISTORY_MESSAGE_CHARS)
        }));
    }

    // Determine the user prompt and system instruction based on mode
    const userPrompt = isHungry
      ? HUNGRY_PROMPT
      : isFormatMode
        ? `Please reformat this recipe:\n\n${prompt}`
        : prompt;
    const systemInstruction = isFormatMode ? FORMAT_SYSTEM_INSTRUCTION : SYSTEM_INSTRUCTION;

    // Assemble messages: system + prior turns + this turn.
    const messages = [
      { role: 'system', content: systemInstruction },
      ...history,
      { role: 'user', content: userPrompt }
    ];

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages,
        // Previews stay useful but intentionally lighter than full depth.
        max_tokens: experienceGranted ? EXPERIENCE_MAX_TOKENS : 2048,
        temperature: isFormatMode ? 0.3 : 0.8
      })
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json().catch(() => ({}));
      console.error('[Cheffy] OpenAI API error:', errorData);
      return json(
        { ok: false, error: 'Cheffy could not finish that one. Please try again.' },
        { status: 500 }
      );
    }

    const openaiData = await openaiResponse.json();
    const output = openaiData.choices?.[0]?.message?.content;

    if (!output) {
      return json(
        { ok: false, error: 'Cheffy went quiet for a second. Please try again.' },
        { status: 500 }
      );
    }

    // Count a preview turn only on a successful answer, so a failed
    // attempt never burns the visitor's experience. Derive `secure` from
    // the request protocol so the turn cap also holds over plain HTTP
    // (local dev / staging) while staying Secure in production.
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

    return json({
      ok: true,
      output: output.trim()
    });
  } catch (error: any) {
    console.error('[Cheffy] Error:', error);
    return json(
      { ok: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    );
  }
};
