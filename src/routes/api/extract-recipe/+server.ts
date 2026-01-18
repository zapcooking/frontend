/**
 * Extract Recipe API
 * 
 * Uses OpenAI GPT-4o-mini to extract recipe information from images or URLs.
 * 
 * POST /api/extract-recipe
 * 
 * Body:
 * {
 *   type: 'image' | 'url',
 *   imageData?: string,  // Base64 encoded image data (for type: 'image')
 *   url?: string         // URL to extract recipe from (for type: 'url')
 * }
 * 
 * Returns:
 * {
 *   success: boolean,
 *   recipe?: {
 *     title: string,
 *     summary: string,
 *     chefsnotes: string,
 *     preptime: string,
 *     cooktime: string,
 *     servings: string,
 *     ingredients: string[],
 *     directions: string[],
 *     tags: string[],
 *     imageUrl?: string
 *   },
 *   error?: string
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Recipe extraction prompt for OpenAI
const EXTRACTION_PROMPT = `You are a recipe extraction assistant. Extract recipe information from the provided content and return it in a structured JSON format.

Extract the following fields:
- title: The name of the recipe
- summary: A brief 1-2 sentence description of the dish
- chefsnotes: Any additional notes, tips, or background about the recipe (can be empty)
- preptime: Preparation time (e.g., "20 min", "1 hour")
- cooktime: Cooking time (e.g., "30 min", "1 hour 15 min")
- servings: Number of servings (e.g., "4", "6-8")
- ingredients: Array of ingredients with quantities (e.g., ["2 cups flour", "1 tsp salt"])
- directions: Array of step-by-step instructions
- tags: Array of relevant tags for categorization (e.g., ["Italian", "Pasta", "Quick", "Vegetarian"])
- imageUrls: Array of image URLs found in the content that show the recipe/dish (extract full URLs, prioritize the main recipe photo)

Return ONLY valid JSON with this exact structure:
{
  "title": "string",
  "summary": "string",
  "chefsnotes": "string",
  "preptime": "string",
  "cooktime": "string",
  "servings": "string",
  "ingredients": ["string"],
  "directions": ["string"],
  "tags": ["string"],
  "imageUrls": ["string"]
}

If any field cannot be determined, use an empty string or empty array as appropriate.
Do not include any text outside the JSON object.`;

// Extract image URLs from HTML
function extractImageUrls(html: string, baseUrl: string): string[] {
  const imageUrls: string[] = [];
  
  // Parse base URL for resolving relative URLs
  let urlBase: URL;
  try {
    urlBase = new URL(baseUrl);
  } catch {
    return imageUrls;
  }
  
  // Match img src attributes
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    let src = match[1];
    // Skip tiny images, icons, tracking pixels
    if (src.includes('1x1') || src.includes('pixel') || src.includes('spacer') || src.includes('icon')) continue;
    
    // Resolve relative URLs
    try {
      if (src.startsWith('//')) {
        src = urlBase.protocol + src;
      } else if (src.startsWith('/')) {
        src = urlBase.origin + src;
      } else if (!src.startsWith('http')) {
        src = new URL(src, baseUrl).href;
      }
      
      // Only include valid image URLs
      if (src.match(/\.(jpg|jpeg|png|webp|gif)/i) || src.includes('image')) {
        imageUrls.push(src);
      }
    } catch {
      // Skip invalid URLs
    }
  }
  
  // Also check for og:image meta tag (often the main recipe image)
  const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (ogImageMatch && ogImageMatch[1]) {
    const ogImage = ogImageMatch[1];
    if (!imageUrls.includes(ogImage)) {
      imageUrls.unshift(ogImage); // Add to front as it's usually the main image
    }
  }
  
  // Check for schema.org recipe image
  const schemaImageMatch = html.match(/"image"\s*:\s*"([^"]+)"/);
  if (schemaImageMatch && schemaImageMatch[1]) {
    const schemaImage = schemaImageMatch[1];
    if (!imageUrls.includes(schemaImage)) {
      imageUrls.unshift(schemaImage);
    }
  }
  
  // Deduplicate and limit
  return [...new Set(imageUrls)].slice(0, 5);
}

// Fetch URL content for extraction
async function fetchUrlContent(url: string): Promise<{ text: string; imageUrls: string[] }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ZapCooking/1.0; +https://zap.cooking)'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status}`);
  }
  
  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('text/html')) {
    const html = await response.text();
    
    // Extract image URLs before stripping HTML
    const imageUrls = extractImageUrls(html, url);
    
    // Extract text content from HTML (basic extraction)
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 15000); // Limit content length
    return { text: textContent, imageUrls };
  }
  
  return { text: await response.text(), imageUrls: [] };
}

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    // Check for OpenAI API key
    const OPENAI_API_KEY = platform?.env?.OPENAI_API_KEY || env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return json(
        { success: false, error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }
    
    // Check membership (premium feature)
    const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
    
    const body = await request.json();
    const { type, imageData, url, pubkey } = body;
    
    // Validate request
    if (!type || (type !== 'image' && type !== 'url')) {
      return json(
        { success: false, error: 'Invalid type. Must be "image" or "url"' },
        { status: 400 }
      );
    }
    
    if (type === 'image' && !imageData) {
      return json(
        { success: false, error: 'Image data is required for image extraction' },
        { status: 400 }
      );
    }
    
    if (type === 'url' && !url) {
      return json(
        { success: false, error: 'URL is required for URL extraction' },
        { status: 400 }
      );
    }
    
    // Check membership status if enabled
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
                { success: false, error: 'Premium membership required for AI recipe extraction' },
                { status: 403 }
              );
            }
            
            // Check if membership is still active
            if (member.subscription_end) {
              const endDate = new Date(member.subscription_end);
              if (endDate < new Date()) {
                return json(
                  { success: false, error: 'Your membership has expired. Please renew to use AI features.' },
                  { status: 403 }
                );
              }
            }
          }
        } catch (err) {
          console.error('[Extract Recipe] Error checking membership:', err);
          // Continue anyway if membership check fails
        }
      }
    }
    
    // Build OpenAI request
    let messages: any[] = [
      { role: 'system', content: EXTRACTION_PROMPT }
    ];
    
    if (type === 'image') {
      // For image extraction, use vision capability
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract the recipe information from this image:'
          },
          {
            type: 'image_url',
            image_url: {
              url: imageData.startsWith('data:') ? imageData : `data:image/jpeg;base64,${imageData}`
            }
          }
        ]
      });
    } else {
      // For URL extraction, fetch the content first
      let urlContent: { text: string; imageUrls: string[] };
      try {
        urlContent = await fetchUrlContent(url);
      } catch (err) {
        return json(
          { success: false, error: `Failed to fetch URL content: ${err instanceof Error ? err.message : 'Unknown error'}` },
          { status: 400 }
        );
      }
      
      // Include image URLs in the prompt so AI can prioritize/select the best ones
      const imageUrlsInfo = urlContent.imageUrls.length > 0 
        ? `\n\nFound image URLs:\n${urlContent.imageUrls.join('\n')}`
        : '';
      
      messages.push({
        role: 'user',
        content: `Extract the recipe information from this webpage content:\n\nURL: ${url}\n\nContent:\n${urlContent.text}${imageUrlsInfo}`
      });
    }
    
    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 4096,
        temperature: 0.3
      })
    });
    
    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json().catch(() => ({}));
      console.error('[Extract Recipe] OpenAI API error:', errorData);
      return json(
        { success: false, error: 'Failed to extract recipe. Please try again.' },
        { status: 500 }
      );
    }
    
    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content;
    
    if (!content) {
      return json(
        { success: false, error: 'No response from AI. Please try again.' },
        { status: 500 }
      );
    }
    
    // Parse the JSON response
    let recipe;
    try {
      // Clean up potential markdown code blocks
      const cleanContent = content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      recipe = JSON.parse(cleanContent);
    } catch (err) {
      console.error('[Extract Recipe] Failed to parse AI response:', content);
      return json(
        { success: false, error: 'Failed to parse recipe data. Please try again.' },
        { status: 500 }
      );
    }
    
    // Validate and normalize the response
    const normalizedRecipe = {
      title: recipe.title || '',
      summary: recipe.summary || '',
      chefsnotes: recipe.chefsnotes || recipe.chefsNotes || recipe.notes || '',
      preptime: recipe.preptime || recipe.prepTime || recipe.prep_time || '',
      cooktime: recipe.cooktime || recipe.cookTime || recipe.cook_time || '',
      servings: recipe.servings || '',
      ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
      directions: Array.isArray(recipe.directions) ? recipe.directions : (Array.isArray(recipe.instructions) ? recipe.instructions : []),
      tags: Array.isArray(recipe.tags) ? recipe.tags : [],
      imageUrls: Array.isArray(recipe.imageUrls) ? recipe.imageUrls : (Array.isArray(recipe.images) ? recipe.images : [])
    };
    
    return json({
      success: true,
      recipe: normalizedRecipe
    });
    
  } catch (error: any) {
    console.error('[Extract Recipe] Error:', error);
    return json(
      { success: false, error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    );
  }
};
