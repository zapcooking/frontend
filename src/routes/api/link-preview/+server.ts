import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Server-side Open Graph unfurler for inline link previews.
 *
 * The client used to call api.microlink.io directly, whose free tier is
 * rate-limited (and CORS-restricted), so previews silently fell back to a
 * bare link. This endpoint fetches the target server-side (no CORS, no
 * third-party quota) and extracts OG/meta tags with light regex parsing.
 *
 * Runs on the edge (Cloudflare / Vercel) using global fetch. Because it
 * fetches arbitrary user-supplied URLs, it applies basic SSRF guards:
 * http(s) only, and no localhost / private-range / link-local hosts.
 */

const PRIVATE_HOST = /^(localhost|.*\.local|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?fe80:|\[?fc00:|\[?fd)/i;

function isSafeUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (PRIVATE_HOST.test(u.hostname)) return null;
  return u;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

// Pull a <meta> content value by og:/twitter:/name key, tolerating either
// attribute order (property before content, or content before property).
function metaContent(html: string, keys: string[]): string {
  for (const key of keys) {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${k}["'][^>]*?content=["']([^"']*)["']`,
        'i'
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${k}["']`,
        'i'
      )
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) return decodeEntities(m[1].trim());
    }
  }
  return '';
}

export const GET: RequestHandler = async ({ url, fetch }) => {
  const target = url.searchParams.get('url');
  if (!target) throw error(400, 'Missing url parameter');

  const safe = isSafeUrl(target);
  if (!safe) throw error(400, 'Invalid or disallowed url');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(safe.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Some sites gate OG tags behind a real UA.
        'User-Agent':
          'Mozilla/5.0 (compatible; ZapCookingBot/1.0; +https://zap.cooking)',
        Accept: 'text/html,application/xhtml+xml'
      }
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return json({ error: true }, { headers: cacheHeaders(600) });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return json({ error: true }, { headers: cacheHeaders(3600) });
    }

    // Only read the <head> region — cap the body so a huge page can't blow
    // memory/time. 512 KB is plenty for meta tags.
    const raw = await res.text();
    const html = raw.slice(0, 512 * 1024);

    const rawTitle =
      metaContent(html, ['og:title', 'twitter:title']) ||
      decodeEntities((html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim());
    const description = metaContent(html, [
      'og:description',
      'twitter:description',
      'description'
    ]);
    let image = metaContent(html, ['og:image', 'og:image:url', 'twitter:image']);

    // Resolve a relative image URL against the (possibly redirected) page.
    if (image) {
      try {
        image = new URL(image, res.url || safe.href).href;
      } catch {
        image = '';
      }
    }

    const siteName =
      metaContent(html, ['og:site_name']) || safe.hostname.replace(/^www\./, '');
    const favicon = `https://www.google.com/s2/favicons?domain=${safe.hostname}&sz=64`;

    const meta = { title: rawTitle, description, image, siteName, favicon };
    const empty = !meta.title && !meta.description && !meta.image;

    return json(empty ? { error: true } : meta, {
      headers: cacheHeaders(empty ? 600 : 60 * 60 * 24)
    });
  } catch {
    return json({ error: true }, { headers: cacheHeaders(600) });
  }
};

function cacheHeaders(sMaxAge: number): Record<string, string> {
  return {
    'Cache-Control': `public, max-age=60, s-maxage=${sMaxAge}, stale-while-revalidate=86400`
  };
}
