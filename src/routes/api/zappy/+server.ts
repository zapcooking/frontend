/**
 * Zappy Recipe Generator API
 * 
 * Uses OpenAI gpt-4.1-mini to generate recipes from user prompts.
 * Premium feature for Pro Kitchen members.
 * 
 * POST /api/zappy
 * 
 * Body:
 * {
 *   prompt: string,
 *   mode?: "prompt" | "hungry"
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

// System instruction for consistent recipe formatting
const SYSTEM_INSTRUCTION = `You are Zappy, a friendly and creative recipe generator for Zap Cooking. Generate recipes in a consistent, easy-to-read format.

ALWAYS format your recipes exactly like this:

# [Recipe Title]

[1-2 sentence summary describing the dish]

## Time
- Prep: [time]
- Cook: [time]
- Total: [time]

## Servings
[number] servings

## Ingredients
- [ingredient 1]
- [ingredient 2]
- [ingredient 3]
...

## Steps
1. [Step 1]
2. [Step 2]
3. [Step 3]
...

## Notes (optional)
- [Any helpful tips or variations]

Keep recipes practical, fun, and achievable with common ingredients unless the user specifies otherwise. Be encouraging and add personality to your recipes!`;

// Random recipe prompt for "I'm Hungry" mode
const HUNGRY_PROMPT = `Generate a random Zap Cooking-style recipe that is fun, practical, and uses common ingredients. Surprise me with something delicious! It could be any cuisine, any meal type - breakfast, lunch, dinner, snack, or dessert. Make it interesting but achievable for a home cook.`;

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    // Check for OpenAI API key
    const OPENAI_API_KEY = platform?.env?.OPENAI_API_KEY || env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return json(
        { ok: false, error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }
    
    const body = await request.json();
    const { prompt, mode = 'prompt', pubkey } = body;
    
    // Validate request
    if (mode === 'prompt' && (!prompt || typeof prompt !== 'string')) {
      return json(
        { ok: false, error: 'Prompt is required' },
        { status: 400 }
      );
    }
    
    // Limit prompt length (prevent abuse)
    if (prompt && prompt.length > 2000) {
      return json(
        { ok: false, error: 'Prompt is too long (max 2000 characters)' },
        { status: 400 }
      );
    }
    
    // Check membership status (Pro Kitchen feature)
    const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
    if (MEMBERSHIP_ENABLED?.toLowerCase() === 'true' && pubkey) {
      const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
      if (API_SECRET) {
        try {
          const membersRes = await fetch('https://pantry.zap.cooking/api/members', {
            headers: { 'Authorization': `Bearer ${API_SECRET}` }
          });
          
          if (membersRes.ok) {
            const data = await membersRes.json();
            const member = data.members?.find((m: any) => 
              m.pubkey?.toLowerCase() === pubkey.toLowerCase()
            );
            
            if (!member) {
              return json(
                { ok: false, error: 'Premium membership required for Zappy' },
                { status: 403 }
              );
            }
            
            // Check if membership is still active
            if (member.subscription_end) {
              const endDate = new Date(member.subscription_end);
              if (endDate < new Date()) {
                return json(
                  { ok: false, error: 'Your membership has expired. Please renew to use Zappy.' },
                  { status: 403 }
                );
              }
            }
          }
        } catch (err) {
          console.error('[Zappy] Error checking membership:', err);
          // Continue anyway if membership check fails
        }
      }
    }
    
    // Determine the user prompt based on mode
    const userPrompt = mode === 'hungry' ? HUNGRY_PROMPT : prompt;
    
    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 2048,
        temperature: 0.8
      })
    });
    
    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json().catch(() => ({}));
      console.error('[Zappy] OpenAI API error:', errorData);
      return json(
        { ok: false, error: 'Failed to generate recipe. Please try again.' },
        { status: 500 }
      );
    }
    
    const openaiData = await openaiResponse.json();
    const output = openaiData.choices?.[0]?.message?.content;
    
    if (!output) {
      return json(
        { ok: false, error: 'No response from AI. Please try again.' },
        { status: 500 }
      );
    }
    
    return json({
      ok: true,
      output: output.trim()
    });
    
  } catch (error: any) {
    console.error('[Zappy] Error:', error);
    return json(
      { ok: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    );
  }
};
