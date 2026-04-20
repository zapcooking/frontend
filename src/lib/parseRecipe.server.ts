/**
 * Shared recipe-extraction pipeline — used by both
 *   - POST /api/extract-recipe         (authenticated, image/text/url)
 *   - POST /api/extract-recipe/public  (anon, url only)
 *
 * Extracts a normalized recipe from an image (base64), a URL, or raw
 * pasted text by round-tripping through OpenAI (gpt-4o-mini). Callers
 * supply the input via a discriminated `ParseInput` and receive a
 * discriminated `ParseResult`.
 *
 * SSRF hardening lives in `fetchUrlContent` and is non-negotiable for
 * the public endpoint: the URL fetcher rejects non-http(s) schemes,
 * IP-literal hostnames in the private/loopback/link-local ranges, and
 * enforces a 5 MB response cap. Caller-side URL validation (type
 * checks, length limits) is a secondary defense — this function is the
 * last line before an outbound fetch.
 */

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

export interface NormalizedRecipe {
  title: string;
  summary: string;
  chefsnotes: string;
  preptime: string;
  cooktime: string;
  servings: string;
  ingredients: string[];
  directions: string[];
  tags: string[];
  imageUrls: string[];
}

export type ParseInput =
  | { type: 'image'; imageData: string }
  | { type: 'url'; url: string }
  | { type: 'text'; textData: string };

export type ParseResult =
  | { ok: true; recipe: NormalizedRecipe }
  | { ok: false; status: number; error: string };

export const MAX_FETCH_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_PROMPT_CONTENT_CHARS = 15000;
export const MAX_TEXT_INPUT_CHARS = 10000;

// ─── SSRF guard ──────────────────────────────────────────────────────
//
// Cloudflare Workers don't expose DNS resolution, so we can't guard
// against DNS-rebinding attacks. Within that limit we do what we can:
// only http(s), and if the URL hostname is an IP literal, reject known
// private/loopback/link-local ranges plus the AWS instance-metadata IP
// the user called out (169.254.169.254).

function parsePublicUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http(s) URLs are supported' };
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: 'Internal hostnames are not allowed' };
  }
  if (isPrivateIpLiteral(host)) {
    return { ok: false, reason: 'Private/loopback addresses are not allowed' };
  }
  return { ok: true, url };
}

function isPrivateIpLiteral(host: string): boolean {
  // Strip IPv6 brackets if present (URL.hostname yields them unbracketed
  // on WHATWG, but be defensive).
  const h = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  // IPv6 loopback / link-local / unique-local.
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80:') || h.startsWith('fe80::')) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;

  // IPv4-literal check.
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function extractImageUrls(html: string, baseUrl: string): string[] {
  const imageUrls: string[] = [];

  let urlBase: URL;
  try {
    urlBase = new URL(baseUrl);
  } catch {
    return imageUrls;
  }

  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    let src = match[1];
    if (src.includes('1x1') || src.includes('pixel') || src.includes('spacer') || src.includes('icon')) continue;

    try {
      if (src.startsWith('//')) {
        src = urlBase.protocol + src;
      } else if (src.startsWith('/')) {
        src = urlBase.origin + src;
      } else if (!src.startsWith('http')) {
        src = new URL(src, baseUrl).href;
      }

      if (src.match(/\.(jpg|jpeg|png|webp|gif)/i) || src.includes('image')) {
        imageUrls.push(src);
      }
    } catch {
      // skip invalid
    }
  }

  const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (ogImageMatch && ogImageMatch[1]) {
    const ogImage = ogImageMatch[1];
    if (!imageUrls.includes(ogImage)) imageUrls.unshift(ogImage);
  }

  const schemaImageMatch = html.match(/"image"\s*:\s*"([^"]+)"/);
  if (schemaImageMatch && schemaImageMatch[1]) {
    const schemaImage = schemaImageMatch[1];
    if (!imageUrls.includes(schemaImage)) imageUrls.unshift(schemaImage);
  }

  return [...new Set(imageUrls)].slice(0, 5);
}

async function fetchUrlContent(
  rawUrl: string
): Promise<{ text: string; imageUrls: string[]; finalUrl: string }> {
  const parsed = parsePublicUrl(rawUrl);
  if (!parsed.ok) throw new Error(parsed.reason);

  const response = await fetch(parsed.url.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZapCooking/1.0; +https://zap.cooking)' },
    redirect: 'follow'
  });

  if (!response.ok) throw new Error(`Failed to fetch URL: ${response.status}`);

  // Enforce size cap up front when the server advertises Content-Length.
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > MAX_FETCH_BYTES) {
      throw new Error('URL response exceeds 5 MB cap');
    }
  }

  const contentType = response.headers.get('content-type') || '';

  // Stream the body so an unbounded or chunked response can't exhaust
  // Worker memory. Abort as soon as we cross the cap.
  if (!response.body) {
    return { text: '', imageUrls: [], finalUrl: response.url || parsed.url.toString() };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    let finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      if (value) {
        total += value.byteLength;
        if (total > MAX_FETCH_BYTES) {
          try {
            await reader.cancel();
          } catch {
            // Cancel can throw if the stream is already closed — no-op.
          }
          throw new Error('URL response exceeds 5 MB cap');
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // releaseLock throws if the reader is already released — no-op.
    }
  }

  // Concatenate and decode once the body is fully buffered under the cap.
  const full = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    full.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const bodyText = new TextDecoder('utf-8').decode(full);

  if (contentType.includes('text/html')) {
    const imageUrls = extractImageUrls(bodyText, parsed.url.toString());
    const textContent = bodyText
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, MAX_PROMPT_CONTENT_CHARS);
    return { text: textContent, imageUrls, finalUrl: response.url || parsed.url.toString() };
  }

  return { text: bodyText, imageUrls: [], finalUrl: response.url || parsed.url.toString() };
}

function normalizeRecipe(raw: Record<string, unknown>): NormalizedRecipe {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    title: str(raw.title),
    summary: str(raw.summary),
    chefsnotes: str(raw.chefsnotes) || str(raw.chefsNotes) || str(raw.notes),
    preptime: str(raw.preptime) || str(raw.prepTime) || str(raw.prep_time),
    cooktime: str(raw.cooktime) || str(raw.cookTime) || str(raw.cook_time),
    servings: str(raw.servings),
    ingredients: strArr(raw.ingredients),
    directions: Array.isArray(raw.directions)
      ? strArr(raw.directions)
      : strArr(raw.instructions),
    tags: strArr(raw.tags),
    imageUrls: Array.isArray(raw.imageUrls) ? strArr(raw.imageUrls) : strArr(raw.images)
  };
}

type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | {
      role: 'user';
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
    };

async function callOpenAI(
  openAiKey: string,
  messages: ChatMessage[]
): Promise<{ ok: true; content: string } | { ok: false; status: number; error: string }> {
  const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`
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
    console.error('[parseRecipe] OpenAI API error:', errorData);
    return { ok: false, status: 500, error: 'Failed to extract recipe. Please try again.' };
  }

  const data = await openaiResponse.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    return { ok: false, status: 500, error: 'No response from AI. Please try again.' };
  }
  return { ok: true, content };
}

/**
 * Run the full extraction pipeline for a single input. Returns a
 * discriminated result; the HTTP handler maps `status` to the response
 * code directly.
 */
export async function parseRecipe(openAiKey: string, input: ParseInput): Promise<ParseResult> {
  const messages: ChatMessage[] = [{ role: 'system', content: EXTRACTION_PROMPT }];

  if (input.type === 'image') {
    if (!input.imageData) {
      return { ok: false, status: 400, error: 'Image data is required for image extraction' };
    }
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'Extract the recipe information from this image:' },
        {
          type: 'image_url',
          image_url: {
            url: input.imageData.startsWith('data:')
              ? input.imageData
              : `data:image/jpeg;base64,${input.imageData}`
          }
        }
      ]
    });
  } else if (input.type === 'text') {
    const text = (input.textData || '').trim();
    if (text.length === 0) {
      return { ok: false, status: 400, error: 'Recipe text is required' };
    }
    if (text.length > MAX_TEXT_INPUT_CHARS) {
      return { ok: false, status: 400, error: 'Recipe text is too long (max 10,000 characters)' };
    }
    messages.push({ role: 'user', content: `Extract the recipe information from this text:\n\n${text}` });
  } else {
    if (!input.url) {
      return { ok: false, status: 400, error: 'URL is required for URL extraction' };
    }
    let urlContent: { text: string; imageUrls: string[]; finalUrl: string };
    try {
      urlContent = await fetchUrlContent(input.url);
    } catch (err) {
      return {
        ok: false,
        status: 400,
        error: `Failed to fetch URL content: ${err instanceof Error ? err.message : 'Unknown error'}`
      };
    }
    const imageUrlsInfo =
      urlContent.imageUrls.length > 0 ? `\n\nFound image URLs:\n${urlContent.imageUrls.join('\n')}` : '';
    messages.push({
      role: 'user',
      content: `Extract the recipe information from this webpage content:\n\nURL: ${urlContent.finalUrl}\n\nContent:\n${urlContent.text}${imageUrlsInfo}`
    });
  }

  const openaiResult = await callOpenAI(openAiKey, messages);
  if (!openaiResult.ok) return openaiResult;

  let recipe: NormalizedRecipe;
  try {
    const cleanContent = openaiResult.content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    recipe = normalizeRecipe(JSON.parse(cleanContent));
  } catch {
    console.error('[parseRecipe] Failed to parse AI response:', openaiResult.content);
    return { ok: false, status: 500, error: 'Failed to parse recipe data. Please try again.' };
  }

  return { ok: true, recipe };
}
