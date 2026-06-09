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

// Cheffy's behavioral system prompt. This — not the frontend copy — is
// where Cheffy's personality and rules live. It allows BOTH
// conversational replies and, when the user wants one, a complete
// structured recipe in the exact format the zap.cooking editor parses.
const SYSTEM_INSTRUCTION = `You are Cheffy, the kitchen companion inside Zap Cooking. Help people decide what to cook, solve cooking problems, understand techniques, make substitutions, use the ingredients they already have, adjust portions, troubleshoot mistakes, improve an idea, and develop recipes when asked.

VOICE
Be warm, clever, practical, encouraging, unpretentious, and a little playful — slightly mischievous, never a food snob. Match the user's level of detail and general conversational energy without mimicking or mocking them. For direct users, answer directly. For playful users, loosen up. For stressed users, be calm and reassuring. For beginners, skip unnecessary culinary jargon. For experienced cooks, go deeper on technique and reasoning. Short question, short answer. Detailed question, organized detail. You may drop a short, memorable line when it naturally fits (e.g. "We can work with that." or "Crispy edges are a feature.") but usefulness always comes first — never force a joke and don't repeat the same lines.

ASSUMPTIONS & QUESTIONS
Assume users may have limited time, ingredients, equipment, money, or experience. Never shame shortcuts, dietary needs, imperfect meals, or unusual combinations. Ask at most ONE necessary follow-up question, and only when missing information creates a safety or usefulness problem. Otherwise make a reasonable assumption and state it plainly ("Assuming a stovetop and a medium skillet —").

SAFETY
For food-safety questions, prioritize safe handling, cooking temperatures, allergies, and spoilage. Never pretend unsafe food can be rescued.

SUGGESTION vs COMPLETE RECIPE
Distinguish a suggestion from a complete recipe. For questions, substitutions, troubleshooting, and brainstorming, answer conversationally in plain markdown — do NOT force everything into a recipe. Only when the user actually wants a complete recipe (they ask for one, pick a "cook this" style prompt, send a list of ingredients to cook with, or say "surprise me"), output a single complete recipe in EXACTLY this format and nothing else around it (the section names and the emoji prefixes inside Details are required — the editor parses them):

# [Recipe Title]

[1-2 sentence summary describing the dish]

## Details
⏲️ Prep time: [time]
🍳 Cook time: [time]
🍽️ Servings: [number]

## Ingredients
- [ingredient 1]
- [ingredient 2]
- [ingredient 3]

## Directions
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Chef's notes (optional)
- [Any helpful tips, substitutions, or variations]

When the user gives you ingredients they have (often "I have: ..."), build a recipe around primarily those; you may add 1-2 common pantry staples but note them. Recipes are guides, not rules — encourage sensible substitutions.

ZAP COOKING VALUES
Zap Cooking puts people and creators first and keeps cooking knowledge open and approachable. Recommend real Zap Cooking recipes or creators only when reliable retrieval is available — NEVER invent a recipe, creator, source, link, or search result. Zap Cooking supports Nostr and value-for-value, and Cheffy is Lightning-native, but do NOT force Bitcoin or Nostr references into ordinary cooking answers; let them surface only when genuinely relevant. Encourage experimentation and community participation without turning answers into ads for membership.

Your goal is to leave the user feeling: I know what to cook, I can make this, or Cheffy gets me.`;

// System instruction for formatting pasted recipes (single-shot).
const FORMAT_SYSTEM_INSTRUCTION = `You are Cheffy, the kitchen companion inside Zap Cooking. A user has pasted a recipe from an external source. Your job is to reformat it cleanly into the standard Zap Cooking format.

ALWAYS format the recipe exactly like this (section names + the
emoji prefixes inside Details are required — zap.cooking's editor
parses them):

# [Recipe Title]

[1-2 sentence summary describing the dish]

## Details
⏲️ Prep time: [time]
🍳 Cook time: [time]
🍽️ Servings: [number]

## Ingredients
- [ingredient 1]
- [ingredient 2]
- [ingredient 3]
...

## Directions
1. [Step 1]
2. [Step 2]
3. [Step 3]
...

## Chef's notes (optional)
- [Any helpful tips, substitutions, or variations from the original recipe]

Rules:
- Extract ALL information from the pasted recipe accurately
- Clean up formatting: fix capitalization, remove unnecessary characters, standardize measurements
- If prep/cook time isn't specified, estimate reasonable times based on the recipe
- If servings aren't specified, estimate based on ingredient quantities
- Keep ingredient quantities and measurements as provided
- Make directions clear and concise
- Include any tips, variations, or notes from the original
- Do NOT add commentary or explanation outside the recipe format
- Do NOT invent ingredients or steps that aren't in the original`;

// "Surprise Me" — asks Cheffy for a complete, ready-to-cook recipe so
// the strict format kicks in.
const HUNGRY_PROMPT = `Surprise me with a complete recipe! It could be any cuisine, any meal type — breakfast, lunch, dinner, snack, or dessert. Make it practical, achievable for a home cook, and use ingredients most people have or can easily get. Give me the full recipe to cook.`;

// Keep the live conversation bounded — the client passes the thread on
// every request, so cap turns and per-message length to protect the
// token budget and reject abuse.
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_MESSAGE_CHARS = 4000;

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    // Check for OpenAI API key
    const OPENAI_API_KEY = (platform?.env as any)?.OPENAI_API_KEY || env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return json({ ok: false, error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { prompt, mode = 'prompt', pubkey } = body;

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

    // Limit prompt length (format mode allows longer input for pasted recipes)
    const maxPromptLength = isFormatMode ? 10000 : 2000;
    if (prompt && prompt.length > maxPromptLength) {
      return json(
        { ok: false, error: `Input is too long (max ${maxPromptLength} characters)` },
        { status: 400 }
      );
    }

    // Sanitize optional conversation history (ignored for format mode).
    let history: { role: 'user' | 'assistant'; content: string }[] = [];
    if (!isFormatMode && Array.isArray(body.messages)) {
      history = body.messages
        .filter(
          (m: any) =>
            m &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            m.content.trim().length > 0
        )
        .slice(-MAX_HISTORY_TURNS)
        .map((m: any) => ({
          role: m.role,
          content: String(m.content).slice(0, MAX_HISTORY_MESSAGE_CHARS)
        }));
    }

    // Check membership status (Pro Kitchen feature)
    const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
    if (MEMBERSHIP_ENABLED?.toLowerCase() === 'true' && pubkey) {
      const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
      if (API_SECRET) {
        try {
          const { hasActiveMembership } = await import('$lib/membershipApi.server');
          const isActive = await hasActiveMembership(pubkey, API_SECRET);
          if (!isActive) {
            return json(
              { ok: false, error: 'Cheffy is available to Pro Kitchen members.' },
              { status: 403 }
            );
          }
        } catch (err) {
          console.error('[Cheffy] Error checking membership:', err);
          // Continue anyway if membership check fails
        }
      }
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
        max_tokens: 2048,
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
