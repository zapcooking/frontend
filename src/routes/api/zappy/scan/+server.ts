/**
 * Zappy Fridge Scanner API
 * 
 * Uses OpenAI GPT-4 Vision to analyze fridge/pantry images and detect ingredients.
 * Premium feature for Pro Kitchen members.
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
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

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
    const { image, pubkey } = body;
    
    // Validate request
    if (!image || typeof image !== 'string') {
      return json(
        { ok: false, error: 'Image data is required' },
        { status: 400 }
      );
    }
    
    // Check image size (rough estimate: base64 is ~33% larger than binary)
    // Limit to ~10MB original = ~13MB base64
    if (image.length > 13 * 1024 * 1024) {
      return json(
        { ok: false, error: 'Image too large. Please use a smaller image.' },
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
          console.error('[Zappy Scan] Error checking membership:', err);
          // Continue anyway if membership check fails
        }
      }
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
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
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
      return json(
        { ok: false, error: 'No response from AI. Please try again.' },
        { status: 500 }
      );
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
