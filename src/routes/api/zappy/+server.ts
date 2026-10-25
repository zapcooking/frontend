/**
 * Cheffy API (route kept at /api/zappy for backwards-compatibility — the
 * public feature is "Cheffy"; the internal endpoint name is unchanged so
 * no env vars, analytics, or deployed routes break).
 *
 * Uses OpenAI gpt-4.1-mini to power Cheffy, Zap Cooking's kitchen
 * companion. Included with any active membership (Cook+, Pro Kitchen, Founders).
 *
 * POST /api/zappy
 *
 * Body:
 * {
 *   prompt: string,
 *   mode?: "prompt" | "chat" | "hungry" | "format",
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
import { verifyNip98 } from '$lib/nip98.server';
import { checkMembership } from '$lib/membershipApi.server';
import { CHEFFY_TRIAL_LIMIT, CHEFFY_TRIAL_PROMPT_CHARS } from '$lib/cheffyTrial';
import {
  reserveTrial,
  finishTrial,
  releaseTrial,
  validTrialRequestId,
  type TrialDatabase
} from '$lib/cheffyTrial.server';

// "Surprise Me" — asks Cheffy for a complete, ready-to-cook recipe so
// the strict format kicks in.
const HUNGRY_PROMPT = `Surprise me with a complete recipe! It could be any cuisine, any meal type — breakfast, lunch, dinner, snack, or dessert. Make it practical, achievable for a home cook, and use ingredients most people have or can easily get. Give me the full recipe to cook.`;

// Keep the live conversation bounded — the client passes the thread on
// every request, so cap turns and per-message length to protect the
// token budget and reject abuse.
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_MESSAGE_CHARS = 4000;

// Free accounts can try three text replies. The signed account, not a
// browser cookie, owns the atomic lifetime quota. Photos/formatting stay paid.
const EXPERIENCE_MAX_HISTORY = 6;
const EXPERIENCE_MAX_TOKENS = 700;

export const POST: RequestHandler = async ({ request, platform }) => {
  let reservation: { db: TrialDatabase; pubkey: string; requestId: string } | null = null;
  let completed = false;
  try {
    // Check for OpenAI API key
    const OPENAI_API_KEY = (platform?.env as any)?.OPENAI_API_KEY || env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return json(
        { ok: false, error: 'Cheffy is temporarily unavailable. Please try again later.' },
        { status: 500 }
      );
    }

    // Read the body ONCE as bytes: NIP-98 hashes the exact payload, and
    // request.json() here would consume the stream before verifyNip98 sees
    // it. Same pattern as /api/zappy/scan.
    let bodyBytes: Uint8Array;
    try {
      bodyBytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }

    let body: any;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }

    const { prompt, mode = 'prompt' } = body;
    const isExperience = body.experience === true;

    // Every trial belongs to a verified account. Body identity is ignored.
    const verification = await verifyNip98(request, { bodyBytes });
    if (!verification.ok) {
      return json(
        { ok: false, code: 'SIGN_IN_REQUIRED', error: 'Sign in to try Cheffy.' },
        { status: 401 }
      );
    }
    const authPubkey = verification.pubkey;

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

    let experienceGranted = false;
    const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true' || !API_SECRET) {
      return json(
        { ok: false, error: 'Cheffy access could not be checked. Please try again later.' },
        { status: 503 }
      );
    }
    // The boolean helper treats an outage as false; use the tri-state result
    // so unknown membership cannot consume samples or grant paid access.
    const membership = await checkMembership(authPubkey, API_SECRET);
    if (membership.state === 'unknown') {
      return json(
        { ok: false, error: 'Cheffy access could not be checked. Please try again later.' },
        { status: 503 }
      );
    }
    if (membership.state !== 'active') {
      if (!isExperience || !['chat', 'prompt', 'hungry'].includes(mode)) {
        return json(
          {
            ok: false,
            error: 'Cheffy is available to Cook+ members. Try your free text messages first.'
          },
          { status: 403 }
        );
      }
      if (!validTrialRequestId(body.trialRequestId)) {
        return json({ ok: false, error: 'Refresh and try your message again.' }, { status: 400 });
      }
      experienceGranted = true;
    }

    // Limit prompt length. Experience previews are capped tighter; format
    // mode allows longer input for pasted recipes.
    const maxPromptLength = experienceGranted
      ? CHEFFY_TRIAL_PROMPT_CHARS
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

    if (experienceGranted) {
      const db = platform?.env?.SCHEDULER_DB;
      if (!db)
        return json(
          { ok: false, error: 'Free samples are temporarily unavailable. Please try again later.' },
          { status: 503 }
        );
      let result: Awaited<ReturnType<typeof reserveTrial>>;
      try {
        result = await reserveTrial(db, authPubkey, body.trialRequestId);
      } catch {
        return json(
          { ok: false, error: 'Free samples are temporarily unavailable. Please try again later.' },
          { status: 503 }
        );
      }
      if (result === 'exhausted') {
        return json(
          {
            ok: false,
            code: 'CHEFFY_EXPERIENCE_USED',
            error:
              'You have used your three free messages. Join Cook+ to keep cooking with Cheffy.',
            trial: { remaining: 0, limit: CHEFFY_TRIAL_LIMIT }
          },
          { status: 429 }
        );
      }
      if (result !== 'reserved') {
        return json(
          {
            ok: false,
            code: result === 'pending' ? 'TRIAL_REQUEST_IN_PROGRESS' : 'TRIAL_REQUEST_COMPLETED',
            error:
              result === 'pending'
                ? 'That message is still being answered. Please wait before trying again.'
                : 'That message was already answered. Start a new message to continue.'
          },
          { status: 409 }
        );
      }
      reservation = { db, pubkey: authPubkey, requestId: body.trialRequestId };
    }

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(45000),
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

    if (typeof output !== 'string' || !output.trim()) {
      return json(
        { ok: false, error: 'Cheffy went quiet for a second. Please try again.' },
        { status: 500 }
      );
    }

    let trial: { remaining: number; limit: number } | undefined;
    if (reservation) {
      const remaining = await finishTrial(
        reservation.db,
        reservation.pubkey,
        reservation.requestId
      );
      completed = true;
      trial = { remaining, limit: CHEFFY_TRIAL_LIMIT };
    }
    return json(
      { ok: true, output: output.trim(), ...(trial ? { trial } : {}) },
      { headers: { 'cache-control': 'private, no-store' } }
    );
  } catch (error: any) {
    console.error('[Cheffy] Error:', error);
    return json(
      { ok: false, error: 'Cheffy could not finish that one. Please try again.' },
      { status: 500 }
    );
  } finally {
    if (reservation && !completed) {
      try {
        await releaseTrial(reservation.db, reservation.pubkey, reservation.requestId);
      } catch {
        console.error('[Cheffy] Could not release a failed trial reservation');
      }
    }
  }
};
